use crate::{holidays::HolidayCalendar, models::*};
use chrono::{Datelike, Local, NaiveDate, SecondsFormat};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub struct Database(pub Arc<Mutex<Connection>>, HolidayCalendar);

fn now() -> String {
    Local::now().to_rfc3339_opts(SecondsFormat::Millis, false)
}
fn bool_i(v: bool) -> i64 {
    if v {
        1
    } else {
        0
    }
}

fn legacy_note_title(markdown: &str) -> String {
    markdown
        .lines()
        .find_map(|line| {
            let trimmed = line.trim();
            let heading = trimmed.strip_prefix('#')?.trim_start_matches('#').trim();
            (!heading.is_empty()).then(|| heading.to_string())
        })
        .unwrap_or_else(|| "以前のメモ".into())
}

impl Database {
    pub fn open(path: &Path, holidays_path: PathBuf) -> Result<Self, String> {
        let holidays = HolidayCalendar::open(holidays_path)?;
        let mut conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS days(id INTEGER PRIMARY KEY AUTOINCREMENT,day_date TEXT NOT NULL UNIQUE,is_closed INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,day_id INTEGER NOT NULL,title TEXT NOT NULL,is_completed INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0,priority INTEGER,carried_over INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,completed_at TEXT,due_at TEXT,FOREIGN KEY(day_id) REFERENCES days(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS entries(id INTEGER PRIMARY KEY AUTOINCREMENT,day_id INTEGER NOT NULL,entry_type TEXT NOT NULL DEFAULT 'memo',title TEXT,body TEXT NOT NULL,occurred_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(day_id) REFERENCES days(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS daily_notes(id INTEGER PRIMARY KEY AUTOINCREMENT,day_id INTEGER NOT NULL UNIQUE,markdown TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(day_id) REFERENCES days(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS note_cards(id INTEGER PRIMARY KEY AUTOINCREMENT,day_id INTEGER NOT NULL,title TEXT NOT NULL DEFAULT '',markdown TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(day_id) REFERENCES days(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,original_name TEXT NOT NULL,stored_name TEXT NOT NULL UNIQUE,mime_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,is_image INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,orphaned_at TEXT);
      CREATE TABLE IF NOT EXISTS note_attachments(note_card_id INTEGER NOT NULL,attachment_id TEXT NOT NULL,PRIMARY KEY(note_card_id,attachment_id),FOREIGN KEY(note_card_id) REFERENCES note_cards(id) ON DELETE CASCADE,FOREIGN KEY(attachment_id) REFERENCES attachments(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY AUTOINCREMENT,day_id INTEGER NOT NULL UNIQUE,good TEXT NOT NULL DEFAULT '',bad TEXT NOT NULL DEFAULT '',carry_over TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(day_id) REFERENCES days(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS ai_summaries(id INTEGER PRIMARY KEY AUTOINCREMENT,day_id INTEGER NOT NULL,summary TEXT,one_line TEXT,achievements_json TEXT,tomorrow_candidates_json TEXT,model_name TEXT,source_hash TEXT,generated_at TEXT NOT NULL,FOREIGN KEY(day_id) REFERENCES days(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS ai_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT NOT NULL UNIQUE,day_id INTEGER NOT NULL,status TEXT NOT NULL,model_name TEXT,backend TEXT,started_at TEXT,finished_at TEXT,elapsed_ms INTEGER,error_message TEXT,FOREIGN KEY(day_id) REFERENCES days(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS custom_holidays(date TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(entity_type UNINDEXED,entity_id UNINDEXED,day_id UNINDEXED,content,tokenize='unicode61');
      CREATE INDEX IF NOT EXISTS idx_tasks_day ON tasks(day_id); CREATE INDEX IF NOT EXISTS idx_entries_day_time ON entries(day_id,occurred_at); CREATE INDEX IF NOT EXISTS idx_note_cards_day_order ON note_cards(day_id,sort_order,id);")
      .map_err(|e| e.to_string())?;
        let has_due_at = {
            let mut query = conn
                .prepare("PRAGMA table_info(tasks)")
                .map_err(|e| e.to_string())?;
            let columns = query
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            columns.iter().any(|name| name == "due_at")
        };
        if !has_due_at {
            conn.execute("ALTER TABLE tasks ADD COLUMN due_at TEXT", [])
                .map_err(|e| e.to_string())?;
        }
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let legacy = {
            let mut query = tx
                .prepare("SELECT day_id,markdown,created_at,updated_at FROM daily_notes WHERE TRIM(markdown)<>'' AND NOT EXISTS(SELECT 1 FROM note_cards c WHERE c.day_id=daily_notes.day_id)")
                .map_err(|e| e.to_string())?;
            let rows = query
                .query_map([], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        };
        for (day_id, markdown, created_at, updated_at) in legacy {
            let title = legacy_note_title(&markdown);
            tx.execute(
                "INSERT INTO note_cards(day_id,title,markdown,sort_order,created_at,updated_at) VALUES(?1,?2,?3,0,?4,?5)",
                params![day_id, title, markdown, created_at, updated_at],
            )
            .map_err(|e| e.to_string())?;
            let card_id = tx.last_insert_rowid();
            tx.execute(
                "DELETE FROM search_index WHERE entity_type='note' AND entity_id=?1",
                [day_id],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO search_index(entity_type,entity_id,day_id,content) VALUES('note_card',?1,?2,?3)",
                params![card_id, day_id, format!("{title} {markdown}")],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute("DELETE FROM search_index WHERE entity_type='note'", [])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM daily_notes", [])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(Self(Arc::new(Mutex::new(conn)), holidays))
    }

    fn day_id(conn: &Connection, date: &str) -> Result<i64, String> {
        let stamp = now();
        conn.execute("INSERT INTO days(day_date,created_at,updated_at) VALUES(?1,?2,?2) ON CONFLICT(day_date) DO NOTHING", params![date,stamp]).map_err(|e|e.to_string())?;
        conn.query_row("SELECT id FROM days WHERE day_date=?1", [date], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())
    }

    pub fn get_day(&self, date: &str) -> Result<DayData, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let id = Self::day_id(&conn, date)?;
        let closed = conn
            .query_row("SELECT is_closed FROM days WHERE id=?1", [id], |r| {
                r.get::<_, i64>(0)
            })
            .map_err(|e| e.to_string())?
            != 0;
        let mut q=conn.prepare("SELECT id,title,is_completed,sort_order,priority,carried_over,completed_at,due_at FROM tasks WHERE day_id=?1 ORDER BY sort_order,id").map_err(|e|e.to_string())?;
        let tasks = q
            .query_map([id], |r| {
                Ok(Task {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    is_completed: r.get::<_, i64>(2)? != 0,
                    sort_order: r.get(3)?,
                    priority: r.get(4)?,
                    carried_over: r.get::<_, i64>(5)? != 0,
                    completed_at: r.get(6)?,
                    due_at: r.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let mut q=conn.prepare("SELECT id,entry_type,title,body,occurred_at FROM entries WHERE day_id=?1 ORDER BY occurred_at,id").map_err(|e|e.to_string())?;
        let entries = q
            .query_map([id], |r| {
                Ok(Entry {
                    id: r.get(0)?,
                    entry_type: r.get(1)?,
                    title: r.get(2)?,
                    body: r.get(3)?,
                    occurred_at: r.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let mut q = conn
            .prepare("SELECT id,title,markdown,sort_order FROM note_cards WHERE day_id=?1 ORDER BY sort_order,id")
            .map_err(|e| e.to_string())?;
        let notes = q
            .query_map([id], |r| {
                Ok(NoteCard {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    markdown: r.get(2)?,
                    sort_order: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let review = conn
            .query_row(
                "SELECT good,bad,carry_over FROM reviews WHERE day_id=?1",
                [id],
                |r| {
                    Ok(Review {
                        good: r.get(0)?,
                        bad: r.get(1)?,
                        carry_over: r.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or_default();
        let ai_summary=conn.query_row("SELECT id,summary,one_line,achievements_json,tomorrow_candidates_json,model_name,generated_at FROM ai_summaries WHERE day_id=?1 ORDER BY generated_at DESC LIMIT 1",[id],|r|Ok(AiSummary{id:r.get(0)?,summary:r.get::<_,Option<String>>(1)?.unwrap_or_default(),one_line:r.get::<_,Option<String>>(2)?.unwrap_or_default(),achievements:serde_json::from_str(&r.get::<_,Option<String>>(3)?.unwrap_or_else(||"[]".into())).unwrap_or_default(),tomorrow_candidates:serde_json::from_str(&r.get::<_,Option<String>>(4)?.unwrap_or_else(||"[]".into())).unwrap_or_default(),model_name:r.get(5)?,generated_at:r.get(6)?})).optional().map_err(|e|e.to_string())?;
        let custom_holiday_name = conn
            .query_row(
                "SELECT name FROM custom_holidays WHERE date=?1",
                [date],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(DayData {
            id,
            day_date: date.into(),
            is_closed: closed,
            tasks,
            entries,
            notes,
            review,
            ai_summary,
            national_holiday_name: self.1.national_holiday_name(date)?,
            custom_holiday_name,
        })
    }

    pub fn create_task(&self, date: &str, title: &str, carried: bool) -> Result<Task, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let day = Self::day_id(&conn, date)?;
        let order: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order),-1)+1 FROM tasks WHERE day_id=?1",
                [day],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        conn.execute("INSERT INTO tasks(day_id,title,sort_order,carried_over,created_at) VALUES(?1,?2,?3,?4,?5)",params![day,title,order,bool_i(carried),now()]).map_err(|e|e.to_string())?;
        let id = conn.last_insert_rowid();
        self.index(&conn, "task", id, day, title)?;
        Ok(Task {
            id,
            title: title.into(),
            is_completed: false,
            sort_order: order,
            priority: None,
            carried_over: carried,
            completed_at: None,
            due_at: None,
        })
    }
    pub fn update_task(&self, t: &Task) -> Result<Task, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let completed = if t.is_completed {
            t.completed_at.clone().or_else(|| Some(now()))
        } else {
            None
        };
        conn.execute("UPDATE tasks SET title=?2,is_completed=?3,sort_order=?4,priority=?5,carried_over=?6,completed_at=?7,due_at=?8 WHERE id=?1",params![t.id,t.title,bool_i(t.is_completed),t.sort_order,t.priority,bool_i(t.carried_over),completed,t.due_at]).map_err(|e|e.to_string())?;
        let day: i64 = conn
            .query_row("SELECT day_id FROM tasks WHERE id=?1", [t.id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        self.index(&conn, "task", t.id, day, &t.title)?;
        Ok(Task {
            completed_at: completed,
            ..t.clone()
        })
    }
    pub fn delete_entity(&self, table: &str, id: i64) -> Result<(), String> {
        if !["tasks", "entries"].contains(&table) {
            return Err("invalid table".into());
        }
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let kind = if table == "tasks" { "task" } else { "entry" };
        conn.execute(&format!("DELETE FROM {table} WHERE id=?1"), [id])
            .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM search_index WHERE entity_type=?1 AND entity_id=?2",
            params![kind, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn reorder_tasks(&self, date: &str, ordered_ids: &[i64]) -> Result<Vec<Task>, String> {
        let mut conn = self.0.lock().map_err(|e| e.to_string())?;
        let day = Self::day_id(&conn, date)?;
        let actual = {
            let mut query = conn
                .prepare("SELECT id FROM tasks WHERE day_id=?1")
                .map_err(|e| e.to_string())?;
            let ids = query
                .query_map([day], |row| row.get::<_, i64>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<HashSet<_>, _>>()
                .map_err(|e| e.to_string())?;
            ids
        };
        let requested: HashSet<_> = ordered_ids.iter().copied().collect();
        if actual != requested || requested.len() != ordered_ids.len() {
            return Err("タスクの並び順が正しくありません".into());
        }
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for (sort_order, id) in ordered_ids.iter().enumerate() {
            tx.execute(
                "UPDATE tasks SET sort_order=?2 WHERE id=?1 AND day_id=?3",
                params![id, sort_order as i64, day],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        let mut query = conn
            .prepare("SELECT id,title,is_completed,sort_order,priority,carried_over,completed_at,due_at FROM tasks WHERE day_id=?1 ORDER BY sort_order,id")
            .map_err(|e| e.to_string())?;
        let tasks = query
            .query_map([day], |row| {
                Ok(Task {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    is_completed: row.get::<_, i64>(2)? != 0,
                    sort_order: row.get(3)?,
                    priority: row.get(4)?,
                    carried_over: row.get::<_, i64>(5)? != 0,
                    completed_at: row.get(6)?,
                    due_at: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(tasks)
    }
    pub fn create_entry(&self, date: &str, body: &str, kind: &str) -> Result<Entry, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let day = Self::day_id(&conn, date)?;
        let stamp = now();
        conn.execute("INSERT INTO entries(day_id,entry_type,body,occurred_at,created_at,updated_at) VALUES(?1,?2,?3,?4,?4,?4)",params![day,kind,body,stamp]).map_err(|e|e.to_string())?;
        let id = conn.last_insert_rowid();
        self.index(&conn, "entry", id, day, body)?;
        Ok(Entry {
            id,
            entry_type: kind.into(),
            title: None,
            body: body.into(),
            occurred_at: stamp,
        })
    }
    pub fn update_entry(&self, e: &Entry, target_date: &str) -> Result<Entry, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let day = Self::day_id(&conn, target_date)?;
        conn.execute("UPDATE entries SET day_id=?2,entry_type=?3,title=?4,body=?5,occurred_at=?6,updated_at=?7 WHERE id=?1",params![e.id,day,e.entry_type,e.title,e.body,e.occurred_at,now()]).map_err(|x|x.to_string())?;
        self.index(
            &conn,
            "entry",
            e.id,
            day,
            &format!("{} {}", e.title.as_deref().unwrap_or(""), e.body),
        )?;
        Ok(e.clone())
    }
    pub fn create_note_card(&self, date: &str) -> Result<NoteCard, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let day = Self::day_id(&conn, date)?;
        let stamp = now();
        let order = conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order),-1)+1 FROM note_cards WHERE day_id=?1",
                [day],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO note_cards(day_id,title,markdown,sort_order,created_at,updated_at) VALUES(?1,'','',?2,?3,?3)",
            params![day, order, stamp],
        )
        .map_err(|e| e.to_string())?;
        Ok(NoteCard {
            id: conn.last_insert_rowid(),
            title: String::new(),
            markdown: String::new(),
            sort_order: order,
        })
    }
    pub fn get_note_card(&self, id: i64) -> Result<NoteCard, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id,title,markdown,sort_order FROM note_cards WHERE id=?1",
            [id],
            |row| {
                Ok(NoteCard {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    markdown: row.get(2)?,
                    sort_order: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "メモが見つかりません".into())
    }
    pub fn update_note_card(&self, card: &NoteCard) -> Result<NoteCard, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let changed = conn
            .execute(
                "UPDATE note_cards SET title=?2,markdown=?3,updated_at=?4 WHERE id=?1",
                params![card.id, card.title, card.markdown, now()],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("メモが見つかりません".into());
        }
        let day = conn
            .query_row(
                "SELECT day_id FROM note_cards WHERE id=?1",
                [card.id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        self.index(
            &conn,
            "note_card",
            card.id,
            day,
            &format!("{} {}", card.title, card.markdown),
        )?;
        Self::sync_note_attachments(&conn, card.id, &card.markdown)?;
        Ok(card.clone())
    }
    pub fn delete_note_card(&self, id: i64) -> Result<(), String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM note_cards WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM search_index WHERE entity_type='note_card' AND entity_id=?1",
            [id],
        )
        .map_err(|e| e.to_string())?;
        Self::mark_orphaned_attachments(&conn)?;
        Ok(())
    }

    fn markdown_attachment_ids(markdown: &str) -> HashSet<String> {
        markdown
            .match_indices("daylog-attachment:")
            .filter_map(|(start, _)| {
                let value = &markdown[start + "daylog-attachment:".len()..];
                let id = value
                    .chars()
                    .take_while(|c| c.is_ascii_hexdigit() || *c == '-')
                    .take(36)
                    .collect::<String>();
                uuid::Uuid::parse_str(&id).ok().map(|_| id.to_lowercase())
            })
            .collect()
    }

    fn sync_note_attachments(
        conn: &Connection,
        note_id: i64,
        markdown: &str,
    ) -> Result<(), String> {
        let ids = Self::markdown_attachment_ids(markdown);
        conn.execute(
            "DELETE FROM note_attachments WHERE note_card_id=?1",
            [note_id],
        )
        .map_err(|e| e.to_string())?;
        for id in ids {
            conn.execute("INSERT OR IGNORE INTO note_attachments(note_card_id,attachment_id) SELECT ?1,?2 WHERE EXISTS(SELECT 1 FROM attachments WHERE id=?2)", params![note_id,id]).map_err(|e|e.to_string())?;
            conn.execute("UPDATE attachments SET orphaned_at=NULL WHERE id=?1", [id])
                .map_err(|e| e.to_string())?;
        }
        Self::mark_orphaned_attachments(conn)
    }

    fn mark_orphaned_attachments(conn: &Connection) -> Result<(), String> {
        conn.execute("UPDATE attachments SET orphaned_at=?1 WHERE orphaned_at IS NULL AND NOT EXISTS(SELECT 1 FROM note_attachments n WHERE n.attachment_id=attachments.id)", [now()]).map_err(|e|e.to_string())?;
        Ok(())
    }

    pub fn register_attachment(
        &self,
        attachment: &Attachment,
        stored_name: &str,
    ) -> Result<(), String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        conn.execute("INSERT INTO attachments(id,original_name,stored_name,mime_type,size_bytes,is_image,created_at,orphaned_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)", params![attachment.id,attachment.name,stored_name,attachment.mime_type,attachment.size_bytes as i64,bool_i(attachment.is_image),now()]).map_err(|e|e.to_string())?;
        Ok(())
    }

    pub fn attachment_record(&self, id: &str) -> Result<(Attachment, String), String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        conn.query_row("SELECT id,original_name,mime_type,size_bytes,is_image,stored_name FROM attachments WHERE id=?1", [id], |row| Ok((Attachment{id:row.get(0)?,name:row.get(1)?,mime_type:row.get(2)?,size_bytes:row.get::<_,i64>(3)? as u64,is_image:row.get::<_,i64>(4)?!=0},row.get(5)?))).map_err(|_| "添付ファイルが見つかりません".into())
    }

    pub fn take_expired_attachments(&self, cutoff: &str) -> Result<Vec<String>, String> {
        let mut conn = self.0.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let names = {
            let mut query = tx.prepare("SELECT stored_name FROM attachments WHERE orphaned_at IS NOT NULL AND orphaned_at<?1 AND NOT EXISTS(SELECT 1 FROM note_attachments n WHERE n.attachment_id=attachments.id)").map_err(|e|e.to_string())?;
            let rows = query
                .query_map([cutoff], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<String>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        };
        tx.execute("DELETE FROM attachments WHERE orphaned_at IS NOT NULL AND orphaned_at<?1 AND NOT EXISTS(SELECT 1 FROM note_attachments n WHERE n.attachment_id=attachments.id)", [cutoff]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(names)
    }
    pub fn reorder_note_cards(
        &self,
        date: &str,
        ordered_ids: &[i64],
    ) -> Result<Vec<NoteCard>, String> {
        let mut conn = self.0.lock().map_err(|e| e.to_string())?;
        let day = Self::day_id(&conn, date)?;
        let actual = {
            let mut query = conn
                .prepare("SELECT id FROM note_cards WHERE day_id=?1")
                .map_err(|e| e.to_string())?;
            let ids = query
                .query_map([day], |r| r.get::<_, i64>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<HashSet<_>, _>>()
                .map_err(|e| e.to_string())?;
            ids
        };
        let requested: HashSet<_> = ordered_ids.iter().copied().collect();
        if actual != requested || requested.len() != ordered_ids.len() {
            return Err("メモの並び順が正しくありません".into());
        }
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for (sort_order, id) in ordered_ids.iter().enumerate() {
            tx.execute(
                "UPDATE note_cards SET sort_order=?2,updated_at=?3 WHERE id=?1 AND day_id=?4",
                params![id, sort_order as i64, now(), day],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        let mut query = conn
            .prepare("SELECT id,title,markdown,sort_order FROM note_cards WHERE day_id=?1 ORDER BY sort_order,id")
            .map_err(|e| e.to_string())?;
        let cards = query
            .query_map([day], |r| {
                Ok(NoteCard {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    markdown: r.get(2)?,
                    sort_order: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(cards)
    }
    pub fn save_review(&self, date: &str, r: &Review) -> Result<(), String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let day = Self::day_id(&conn, date)?;
        let stamp = now();
        conn.execute("INSERT INTO reviews(day_id,good,bad,carry_over,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?5) ON CONFLICT(day_id) DO UPDATE SET good=excluded.good,bad=excluded.bad,carry_over=excluded.carry_over,updated_at=excluded.updated_at",params![day,r.good,r.bad,r.carry_over,stamp]).map_err(|e|e.to_string())?;
        self.index(
            &conn,
            "review",
            day,
            day,
            &format!("{} {} {}", r.good, r.bad, r.carry_over),
        )
    }
    fn index(
        &self,
        conn: &Connection,
        kind: &str,
        entity: i64,
        day: i64,
        text: &str,
    ) -> Result<(), String> {
        conn.execute(
            "DELETE FROM search_index WHERE entity_type=?1 AND entity_id=?2",
            params![kind, entity],
        )
        .map_err(|e| e.to_string())?;
        if !text.trim().is_empty() {
            conn.execute("INSERT INTO search_index(entity_type,entity_id,day_id,content) VALUES(?1,?2,?3,?4)",params![kind,entity,day,text]).map_err(|e|e.to_string())?;
        }
        Ok(())
    }
    pub fn set_closed(&self, date: &str, value: bool) -> Result<(), String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let id = Self::day_id(&conn, date)?;
        conn.execute(
            "UPDATE days SET is_closed=?2,updated_at=?3 WHERE id=?1",
            params![id, bool_i(value), now()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn calendar(&self, year: i32, month: u32) -> Result<Vec<CalendarDay>, String> {
        let first = NaiveDate::from_ymd_opt(year, month, 1).ok_or("年月が不正です")?;
        let national_holidays = self.1.load()?;
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let prefix = format!("{year:04}-{month:02}-%");
        let mut q=conn.prepare("SELECT d.day_date,d.is_closed,(SELECT COUNT(*) FROM tasks t WHERE t.day_id=d.id)+(SELECT COUNT(*) FROM entries e WHERE e.day_id=d.id)+(SELECT COUNT(*) FROM note_cards n WHERE n.day_id=d.id)+CASE WHEN COALESCE(r.good,'')<>'' OR COALESCE(r.bad,'')<>'' OR COALESCE(r.carry_over,'')<>'' THEN 1 ELSE 0 END FROM days d LEFT JOIN reviews r ON r.day_id=d.id WHERE d.day_date LIKE ?1 ORDER BY d.day_date").map_err(|e|e.to_string())?;
        let recorded = q
            .query_map([prefix], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    (r.get::<_, i64>(2)?, r.get::<_, i64>(1)? != 0),
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<HashMap<_, _>, _>>()
            .map_err(|e| e.to_string())?;
        let mut q = conn
            .prepare("SELECT date,name FROM custom_holidays WHERE date LIKE ?1")
            .map_err(|e| e.to_string())?;
        let custom = q
            .query_map([format!("{year:04}-{month:02}-%")], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<HashMap<_, _>, _>>()
            .map_err(|e| e.to_string())?;
        let mut rows = Vec::new();
        let mut date = first;
        while date.month() == month {
            let key = date.format("%Y-%m-%d").to_string();
            let (count, is_closed) = recorded.get(&key).copied().unwrap_or((0, false));
            rows.push(CalendarDay {
                date: key.clone(),
                count,
                is_closed,
                national_holiday_name: national_holidays.get(&key).cloned(),
                custom_holiday_name: custom.get(&key).cloned(),
            });
            date = date.succ_opt().ok_or("日付を進められませんでした")?;
        }
        Ok(rows)
    }

    pub fn set_custom_holiday(&self, date: &str, name: &str) -> Result<CustomHoliday, String> {
        NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| "日付が不正です".to_string())?;
        let name = name.trim();
        if name.is_empty() {
            return Err("休日名を入力してください".into());
        }
        if name.chars().count() > 80 {
            return Err("休日名は80文字以内で入力してください".into());
        }
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let stamp = now();
        conn.execute("INSERT INTO custom_holidays(date,name,created_at,updated_at) VALUES(?1,?2,?3,?3) ON CONFLICT(date) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at", params![date, name, stamp]).map_err(|e| e.to_string())?;
        Ok(CustomHoliday {
            date: date.into(),
            name: name.into(),
        })
    }

    pub fn delete_custom_holiday(&self, date: &str) -> Result<(), String> {
        NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| "日付が不正です".to_string())?;
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .execute("DELETE FROM custom_holidays WHERE date=?1", [date])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn search(&self, query: &str) -> Result<Vec<SearchResult>, String> {
        if query.trim().is_empty() {
            return Ok(vec![]);
        }
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let pattern = format!("%{}%", query.trim());
        let mut q=conn.prepare("SELECT s.entity_type,s.entity_id,d.day_date,s.content FROM search_index s JOIN days d ON d.id=s.day_id WHERE s.content LIKE ?1 ORDER BY d.day_date DESC LIMIT 100").map_err(|e|e.to_string())?;
        let rows = q
            .query_map([pattern], |r| {
                Ok(SearchResult {
                    entity_type: r.get(0)?,
                    entity_id: r.get(1)?,
                    day_date: r.get(2)?,
                    excerpt: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }
    pub fn snapshot_json(&self, date: &str) -> Result<(i64, serde_json::Value), String> {
        let d = self.get_day(date)?;
        let note_markdown = d
            .notes
            .iter()
            .filter(|note| !note.title.trim().is_empty() || !note.markdown.trim().is_empty())
            .map(|note| {
                let title = if note.title.trim().is_empty() {
                    "無題のメモ"
                } else {
                    note.title.trim()
                };
                if note.markdown.trim().is_empty() {
                    format!("## {title}")
                } else {
                    format!("## {title}\n\n{}", note.markdown)
                }
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        let value = serde_json::json!({"date":d.day_date,"tasks":d.tasks.iter().map(|t|serde_json::json!({"title":t.title,"completed":t.is_completed})).collect::<Vec<_>>(),"entries":d.entries.iter().map(|e|serde_json::json!({"time":e.occurred_at,"type":e.entry_type,"title":e.title,"body":e.body})).collect::<Vec<_>>(),"note_markdown":note_markdown,"review":{"good":d.review.good,"bad":d.review.bad,"carry_over":d.review.carry_over}});
        Ok((d.id, value))
    }
    pub fn start_ai_run(
        &self,
        request: &str,
        day: i64,
        model: &str,
        backend: &str,
    ) -> Result<(), String> {
        self.0.lock().map_err(|e|e.to_string())?.execute("INSERT INTO ai_runs(request_id,day_id,status,model_name,backend,started_at) VALUES(?1,?2,'starting',?3,?4,?5)",params![request,day,model,backend,now()]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn finish_ai(
        &self,
        request: &str,
        day: i64,
        result: &serde_json::Value,
        model: &str,
        hash: &str,
        elapsed: i64,
    ) -> Result<AiSummary, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let stamp = now();
        let summary = result
            .get("summary")
            .and_then(|v| v.as_str())
            .ok_or("AI response: summary is missing")?;
        let line = result
            .get("one_line")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let achievements = result
            .get("achievements")
            .cloned()
            .unwrap_or_else(|| serde_json::json!([]));
        let candidates = result
            .get("tomorrow_candidates")
            .cloned()
            .unwrap_or_else(|| serde_json::json!([]));
        conn.execute("INSERT INTO ai_summaries(day_id,summary,one_line,achievements_json,tomorrow_candidates_json,model_name,source_hash,generated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![day,summary,line,achievements.to_string(),candidates.to_string(),model,hash,stamp]).map_err(|e|e.to_string())?;
        let id = conn.last_insert_rowid();
        conn.execute("UPDATE ai_runs SET status='completed',finished_at=?2,elapsed_ms=?3 WHERE request_id=?1",params![request,stamp,elapsed]).map_err(|e|e.to_string())?;
        self.index(&conn, "ai_summary", id, day, &format!("{summary} {line}"))?;
        Ok(AiSummary {
            id,
            summary: summary.into(),
            one_line: line.into(),
            achievements: serde_json::from_value(achievements).unwrap_or_default(),
            tomorrow_candidates: serde_json::from_value(candidates).unwrap_or_default(),
            model_name: Some(model.into()),
            generated_at: stamp,
        })
    }
    pub fn fail_ai(&self, request: &str, status: &str, message: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .execute(
                "UPDATE ai_runs SET status=?2,finished_at=?3,error_message=?4 WHERE request_id=?1",
                params![request, status, now(), message],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_test_database(path: &Path) -> Database {
        Database::open(
            path,
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("japanese_holidays.csv"),
        )
        .unwrap()
    }

    #[test]
    fn combines_official_and_custom_holidays_for_every_calendar_day() {
        let path = std::env::temp_dir().join(format!(
            "daylog-holiday-test-{}-{}.db",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let db = open_test_database(&path);
        let initial = db.calendar(2026, 9).unwrap();
        assert_eq!(initial.len(), 30);
        assert_eq!(initial[21].national_holiday_name.as_deref(), Some("休日"));
        assert_eq!(initial[21].count, 0);

        let saved = db.set_custom_holiday("2026-09-22", " 会社休業日 ").unwrap();
        assert_eq!(saved.name, "会社休業日");
        let day = db.get_day("2026-09-22").unwrap();
        assert_eq!(day.national_holiday_name.as_deref(), Some("休日"));
        assert_eq!(day.custom_holiday_name.as_deref(), Some("会社休業日"));
        let combined = db.calendar(2026, 9).unwrap();
        assert_eq!(
            combined[21].custom_holiday_name.as_deref(),
            Some("会社休業日")
        );

        assert!(db.set_custom_holiday("2026-02-30", "休み").is_err());
        assert!(db.set_custom_holiday("2026-09-22", " ").is_err());
        assert!(db
            .set_custom_holiday("2026-09-22", &"休".repeat(81))
            .is_err());
        db.delete_custom_holiday("2026-09-22").unwrap();
        db.delete_custom_holiday("2026-09-22").unwrap();
        assert!(db
            .get_day("2026-09-22")
            .unwrap()
            .custom_holiday_name
            .is_none());
        drop(db);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn migrates_task_deadlines_and_reorders_tasks_safely() {
        let path = std::env::temp_dir().join(format!(
            "daylog-task-migration-test-{}-{}.db",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch("PRAGMA foreign_keys=ON;
                CREATE TABLE days(id INTEGER PRIMARY KEY AUTOINCREMENT,day_date TEXT NOT NULL UNIQUE,is_closed INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
                CREATE TABLE tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,day_id INTEGER NOT NULL,title TEXT NOT NULL,is_completed INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0,priority INTEGER,carried_over INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,completed_at TEXT,FOREIGN KEY(day_id) REFERENCES days(id) ON DELETE CASCADE);
                INSERT INTO days(id,day_date,created_at,updated_at) VALUES(1,'2026-09-06','now','now');
                INSERT INTO tasks(id,day_id,title,sort_order,created_at) VALUES(1,1,'既存タスク',0,'now');").unwrap();
        }
        let db = open_test_database(&path);
        let existing = db.get_day("2026-09-06").unwrap().tasks.remove(0);
        assert_eq!(existing.title, "既存タスク");
        assert!(existing.due_at.is_none());

        let mut first = existing;
        first.due_at = Some("2026-09-06T18:30:00+09:00".into());
        db.update_task(&first).unwrap();
        let second = db.create_task("2026-09-06", "追加タスク", false).unwrap();
        let other = db.create_task("2026-09-07", "別日のタスク", false).unwrap();

        let reordered = db
            .reorder_tasks("2026-09-06", &[second.id, first.id])
            .unwrap();
        assert_eq!(
            reordered.iter().map(|task| task.id).collect::<Vec<_>>(),
            vec![second.id, first.id]
        );
        assert_eq!(
            reordered[1].due_at.as_deref(),
            Some("2026-09-06T18:30:00+09:00")
        );
        assert!(db
            .reorder_tasks("2026-09-06", &[first.id, first.id])
            .is_err());
        assert!(db.reorder_tasks("2026-09-06", &[first.id]).is_err());
        assert!(db
            .reorder_tasks("2026-09-06", &[first.id, other.id])
            .is_err());

        drop(db);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn journal_round_trip_and_search() {
        let path = std::env::temp_dir().join(format!("daylog-test-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = open_test_database(&path);
        let task = db
            .create_task("2026-09-03", "仕様を確認する", false)
            .unwrap();
        assert!(!task.is_completed);
        db.create_entry("2026-09-03", "朝会で進捗を確認", "仕事")
            .unwrap();
        let mut note = db.create_note_card("2026-09-03").unwrap();
        note.title = "気づき".into();
        note.markdown = "シンプルにする".into();
        db.update_note_card(&note).unwrap();
        db.save_review(
            "2026-09-03",
            &Review {
                good: "完了".into(),
                bad: String::new(),
                carry_over: "レビュー".into(),
            },
        )
        .unwrap();
        let day = db.get_day("2026-09-03").unwrap();
        assert_eq!(day.tasks.len(), 1);
        assert_eq!(day.entries.len(), 1);
        assert_eq!(day.notes[0].title, "気づき");
        assert!(db
            .search("シンプル")
            .unwrap()
            .iter()
            .any(|r| r.entity_type == "note_card"));
        assert!(!db.search("朝会").unwrap().is_empty());
        drop(db);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn updates_entry_content_and_moves_it_to_the_target_day() {
        let path = std::env::temp_dir().join(format!(
            "daylog-entry-move-test-{}-{}.db",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let db = open_test_database(&path);
        let mut entry = db
            .create_entry("2026-09-05", "変更前の内容", "仕事")
            .unwrap();
        entry.title = None;
        entry.body = "変更後の内容".into();
        entry.occurred_at = "2026-09-07T23:59:00+09:00".into();

        let updated = db.update_entry(&entry, "2026-09-07").unwrap();

        assert_eq!(updated.body, "変更後の内容");
        assert!(db.get_day("2026-09-05").unwrap().entries.is_empty());
        let target = db.get_day("2026-09-07").unwrap();
        assert_eq!(target.entries.len(), 1);
        assert_eq!(target.entries[0].occurred_at, "2026-09-07T23:59:00+09:00");
        assert!(db.search("変更前").unwrap().is_empty());
        assert_eq!(db.search("変更後").unwrap()[0].day_date, "2026-09-07");

        drop(db);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn tracks_shared_attachment_references_until_the_last_note_releases_them() {
        let path = std::env::temp_dir().join(format!(
            "daylog-attachment-test-{}-{}.db",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let db = open_test_database(&path);
        let attachment = Attachment {
            id: uuid::Uuid::new_v4().to_string(),
            name: "photo.png".into(),
            mime_type: "image/png".into(),
            size_bytes: 10,
            is_image: true,
        };
        db.register_attachment(&attachment, "stored.png").unwrap();
        let mut first = db.create_note_card("2026-09-03").unwrap();
        let mut second = db.create_note_card("2026-09-03").unwrap();
        first.markdown = format!("![photo](daylog-attachment:{})", attachment.id);
        second.markdown = format!("[file](daylog-attachment:{})", attachment.id);
        db.update_note_card(&first).unwrap();
        db.update_note_card(&second).unwrap();
        first.markdown.clear();
        db.update_note_card(&first).unwrap();
        let orphaned: Option<String> =
            db.0.lock()
                .unwrap()
                .query_row(
                    "SELECT orphaned_at FROM attachments WHERE id=?1",
                    [&attachment.id],
                    |row| row.get(0),
                )
                .unwrap();
        assert!(orphaned.is_none());
        second.markdown.clear();
        db.update_note_card(&second).unwrap();
        let orphaned: Option<String> =
            db.0.lock()
                .unwrap()
                .query_row(
                    "SELECT orphaned_at FROM attachments WHERE id=?1",
                    [&attachment.id],
                    |row| row.get(0),
                )
                .unwrap();
        assert!(orphaned.is_some());
        assert_eq!(
            db.take_expired_attachments("9999-01-01T00:00:00.000+00:00")
                .unwrap(),
            vec!["stored.png"]
        );
        drop(db);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn migrates_legacy_note_once_and_rebuilds_search() {
        let path = std::env::temp_dir().join(format!(
            "daylog-migration-test-{}-{}.db",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch("PRAGMA foreign_keys=ON;
                CREATE TABLE days(id INTEGER PRIMARY KEY AUTOINCREMENT,day_date TEXT NOT NULL UNIQUE,is_closed INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
                CREATE TABLE daily_notes(id INTEGER PRIMARY KEY AUTOINCREMENT,day_id INTEGER NOT NULL UNIQUE,markdown TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
                CREATE VIRTUAL TABLE search_index USING fts5(entity_type UNINDEXED,entity_id UNINDEXED,day_id UNINDEXED,content,tokenize='unicode61');
                INSERT INTO days(id,day_date,created_at,updated_at) VALUES(1,'2026-09-04','now','now');
                INSERT INTO daily_notes(day_id,markdown,created_at,updated_at) VALUES(1,'# 移行タイトル\n本文を保持','now','now');
                INSERT INTO search_index(entity_type,entity_id,day_id,content) VALUES('note',1,1,'古い検索');").unwrap();
        }
        let db = open_test_database(&path);
        let day = db.get_day("2026-09-04").unwrap();
        assert_eq!(day.notes.len(), 1);
        assert_eq!(day.notes[0].title, "移行タイトル");
        assert!(day.notes[0].markdown.contains("本文を保持"));
        assert_eq!(db.search("本文を保持").unwrap()[0].entity_type, "note_card");
        assert!(db.search("古い検索").unwrap().is_empty());
        drop(db);
        let db = open_test_database(&path);
        assert_eq!(db.get_day("2026-09-04").unwrap().notes.len(), 1);
        drop(db);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }
}
