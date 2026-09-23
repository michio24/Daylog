pub mod migrations;
mod period;
mod tokenize;

use crate::{holidays::HolidayCalendar, models::*};
use chrono::{Local, LocalResult, NaiveDate, SecondsFormat, TimeZone};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    collections::HashSet,
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

impl Database {
    pub fn open(path: &Path, holidays_path: PathBuf) -> Result<Self, String> {
        let holidays = HolidayCalendar::open(holidays_path)?;
        let mut conn = Connection::open(path).map_err(|e| e.to_string())?;
        migrations::migrate(&mut conn)?;
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

    fn entity_tags(
        conn: &Connection,
        table: &str,
        column: &str,
        id: i64,
    ) -> Result<Vec<Tag>, String> {
        let sql = format!("SELECT t.id,t.name,t.color FROM tags t JOIN {table} x ON x.tag_id=t.id WHERE x.{column}=?1 ORDER BY t.name,t.id");
        let mut query = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let tags = query
            .query_map([id], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(tags)
    }

    fn task_tags(conn: &Connection, id: i64) -> Result<Vec<Tag>, String> {
        Self::entity_tags(conn, "task_tags", "task_id", id)
    }
    fn entry_tags(conn: &Connection, id: i64) -> Result<Vec<Tag>, String> {
        Self::entity_tags(conn, "entry_tags", "entry_id", id)
    }
    fn note_tags(conn: &Connection, id: i64) -> Result<Vec<Tag>, String> {
        Self::entity_tags(conn, "note_card_tags", "note_card_id", id)
    }

    pub fn list_tags(&self) -> Result<Vec<Tag>, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let mut query = conn
            .prepare("SELECT id,name,color FROM tags ORDER BY name,id")
            .map_err(|e| e.to_string())?;
        let tags = query
            .query_map([], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(tags)
    }
    pub fn create_tag(&self, name: &str, color: &str) -> Result<Tag, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO tags(name,color,created_at,updated_at) VALUES(?1,?2,?3,?3)",
            params![name, color, now()],
        )
        .map_err(|e| e.to_string())?;
        Ok(Tag {
            id: conn.last_insert_rowid(),
            name: name.into(),
            color: color.into(),
        })
    }
    pub fn update_tag(&self, tag: &Tag) -> Result<Tag, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let changed = conn
            .execute(
                "UPDATE tags SET name=?2,color=?3,updated_at=?4 WHERE id=?1",
                params![tag.id, tag.name, tag.color, now()],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("タグが見つかりません".into());
        }
        Ok(tag.clone())
    }
    pub fn delete_tag(&self, id: i64) -> Result<(), String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let changed = conn
            .execute("DELETE FROM tags WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("タグが見つかりません".into());
        }
        Ok(())
    }
    fn set_entity_tags(
        &self,
        id: i64,
        ids: &[i64],
        table: &str,
        entity_table: &str,
        column: &str,
    ) -> Result<Vec<Tag>, String> {
        let mut conn = self.0.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let exists: bool = tx
            .query_row(
                &format!("SELECT EXISTS(SELECT 1 FROM {entity_table} WHERE id=?1)"),
                [id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !exists {
            return Err("項目が見つかりません".into());
        }
        let unique: HashSet<i64> = ids.iter().copied().collect();
        for tag_id in &unique {
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM tags WHERE id=?1)",
                    [tag_id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if !exists {
                return Err("タグが見つかりません".into());
            }
        }
        tx.execute(&format!("DELETE FROM {table} WHERE {column}=?1"), [id])
            .map_err(|e| e.to_string())?;
        for tag_id in unique {
            tx.execute(
                &format!("INSERT INTO {table}({column},tag_id) VALUES(?1,?2)"),
                params![id, tag_id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Self::entity_tags(&conn, table, column, id)
    }
    pub fn set_task_tags(&self, id: i64, ids: &[i64]) -> Result<Vec<Tag>, String> {
        self.set_entity_tags(id, ids, "task_tags", "tasks", "task_id")
    }
    pub fn set_entry_tags(&self, id: i64, ids: &[i64]) -> Result<Vec<Tag>, String> {
        self.set_entity_tags(id, ids, "entry_tags", "entries", "entry_id")
    }
    pub fn set_note_card_tags(&self, id: i64, ids: &[i64]) -> Result<Vec<Tag>, String> {
        self.set_entity_tags(id, ids, "note_card_tags", "note_cards", "note_card_id")
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
        let mut tasks = q
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
                    tags: vec![],
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        for task in &mut tasks {
            task.tags = Self::task_tags(&conn, task.id)?;
        }
        let mut q=conn.prepare("SELECT id,icon,title,body,occurred_at FROM entries WHERE day_id=?1 ORDER BY occurred_at,id").map_err(|e|e.to_string())?;
        let mut entries = q
            .query_map([id], |r| {
                Ok(Entry {
                    id: r.get(0)?,
                    icon: r.get(1)?,
                    title: r.get(2)?,
                    body: r.get(3)?,
                    occurred_at: r.get(4)?,
                    tags: vec![],
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        for entry in &mut entries {
            entry.tags = Self::entry_tags(&conn, entry.id)?;
        }
        let mut q = conn
            .prepare("SELECT id,title,markdown,sort_order FROM note_cards WHERE day_id=?1 ORDER BY sort_order,id")
            .map_err(|e| e.to_string())?;
        let mut notes = q
            .query_map([id], |r| {
                Ok(NoteCard {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    markdown: r.get(2)?,
                    sort_order: r.get(3)?,
                    tags: vec![],
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        for note in &mut notes {
            note.tags = Self::note_tags(&conn, note.id)?;
        }
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
            tags: vec![],
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
            tags: Self::task_tags(&conn, t.id)?,
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
        let mut tasks = query
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
                    tags: vec![],
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        for task in &mut tasks {
            task.tags = Self::task_tags(&conn, task.id)?;
        }
        Ok(tasks)
    }
    pub fn create_entry(&self, date: &str, body: &str, icon: &str) -> Result<Entry, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let selected_date = NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|_| "日付が不正です".to_string())?;
        let day = Self::day_id(&conn, date)?;
        let local_date_time = selected_date.and_time(Local::now().time());
        let stamp = match Local.from_local_datetime(&local_date_time) {
            LocalResult::Single(value) => value,
            LocalResult::Ambiguous(earlier, _) => earlier,
            LocalResult::None => return Err("指定日の現在時刻を作成できません".into()),
        }
        .to_rfc3339_opts(SecondsFormat::Millis, false);
        conn.execute("INSERT INTO entries(day_id,icon,body,occurred_at,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?5)",params![day,icon,body,stamp,now()]).map_err(|e|e.to_string())?;
        let id = conn.last_insert_rowid();
        self.index(&conn, "entry", id, day, body)?;
        Ok(Entry {
            id,
            icon: icon.into(),
            title: None,
            body: body.into(),
            occurred_at: stamp,
            tags: vec![],
        })
    }
    pub fn update_entry(&self, e: &Entry, target_date: &str) -> Result<Entry, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let day = Self::day_id(&conn, target_date)?;
        conn.execute("UPDATE entries SET day_id=?2,icon=?3,title=?4,body=?5,occurred_at=?6,updated_at=?7 WHERE id=?1",params![e.id,day,e.icon,e.title,e.body,e.occurred_at,now()]).map_err(|x|x.to_string())?;
        self.index(
            &conn,
            "entry",
            e.id,
            day,
            &format!("{} {}", e.title.as_deref().unwrap_or(""), e.body),
        )?;
        Ok(Entry {
            tags: Self::entry_tags(&conn, e.id)?,
            ..e.clone()
        })
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
            tags: vec![],
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
                    tags: vec![],
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "メモが見つかりません".into())
        .and_then(|mut card| {
            card.tags = Self::note_tags(&conn, card.id)?;
            Ok(card)
        })
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
        Ok(NoteCard {
            tags: Self::note_tags(&conn, card.id)?,
            ..card.clone()
        })
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
        let mut cards = query
            .query_map([day], |r| {
                Ok(NoteCard {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    markdown: r.get(2)?,
                    sort_order: r.get(3)?,
                    tags: vec![],
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        for card in &mut cards {
            card.tags = Self::note_tags(&conn, card.id)?;
        }
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
        // AIまとめは再実行のたびに新しい id で行が増えるため、entity_id だけで
        // 消すと同じ日の古いまとめが索引に残り続ける。日単位でも消しておく。
        if kind == "ai_summary" {
            conn.execute(
                "DELETE FROM search_index WHERE entity_type='ai_summary' AND day_id=?1",
                [day],
            )
            .map_err(|e| e.to_string())?;
        }
        if text.trim().is_empty() {
            return Ok(());
        }
        let day_date: String = conn
            .query_row("SELECT day_date FROM days WHERE id=?1", [day], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO search_index(entity_type,entity_id,day_id,day_date,content,tokens) VALUES(?1,?2,?3,?4,?5,?6)",
            params![kind, entity, day, day_date, text, tokenize::bigramize(text)],
        )
        .map_err(|e| e.to_string())?;
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
    /// 月次カレンダー。件数の数え方は `daily_stats` に一本化している。
    pub fn calendar(&self, year: i32, month: u32) -> Result<Vec<CalendarDay>, String> {
        let first = NaiveDate::from_ymd_opt(year, month, 1).ok_or("年月が不正です")?;
        // 翌月の0日目 = 当月の末日。
        let last = NaiveDate::from_ymd_opt(year, month + 1, 1)
            .or_else(|| NaiveDate::from_ymd_opt(year + 1, 1, 1))
            .and_then(|next| next.pred_opt())
            .ok_or("年月が不正です")?;
        let rows = self.daily_stats(
            &first.format("%Y-%m-%d").to_string(),
            &last.format("%Y-%m-%d").to_string(),
        )?;
        Ok(rows
            .into_iter()
            .map(|stat| CalendarDay {
                count: stat.total(),
                date: stat.date,
                is_closed: stat.is_closed,
                national_holiday_name: stat.national_holiday_name,
                custom_holiday_name: stat.custom_holiday_name,
            })
            .collect())
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
    /// 全文検索。本文は FTS5 の bigram 索引、タグ・期間・種別は索引上の
    /// UNINDEXED 列で絞る（`days` との JOIN が要らない）。
    pub fn search(&self, filter: &SearchFilter) -> Result<SearchPage, String> {
        let expression = tokenize::build_match_expression(&filter.query);
        // 検索語もタグも期間も指定がなければ、全件を返さず空にする。
        if expression.is_none()
            && filter.tag_id.is_none()
            && filter.from.is_none()
            && filter.to.is_none()
        {
            return Ok(SearchPage {
                results: vec![],
                total: 0,
                has_more: false,
            });
        }
        let limit = filter.limit.unwrap_or(50).clamp(1, 200);
        let offset = filter.offset.unwrap_or(0).max(0);
        let conn = self.0.lock().map_err(|e| e.to_string())?;

        let mut conditions: Vec<String> = Vec::new();
        let mut binds: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(expression) = &expression {
            conditions.push("s.tokens MATCH ?".into());
            binds.push(Box::new(expression.clone()));
        }
        if let Some(from) = &filter.from {
            conditions.push("s.day_date >= ?".into());
            binds.push(Box::new(from.clone()));
        }
        if let Some(to) = &filter.to {
            conditions.push("s.day_date <= ?".into());
            binds.push(Box::new(to.clone()));
        }
        let kinds = Self::allowed_entity_types(&filter.entity_types);
        if !kinds.is_empty() {
            // 値は許可リストと突き合わせ済みなので、この連結に外部入力は入らない。
            let placeholders = vec!["?"; kinds.len()].join(",");
            conditions.push(format!("s.entity_type IN ({placeholders})"));
            for kind in &kinds {
                binds.push(Box::new(kind.clone()));
            }
        }
        if let Some(tag_id) = filter.tag_id {
            // 振り返りとAIまとめはタグを持たないので、タグ指定時は自動的に外れる。
            conditions.push(
                "((s.entity_type='task' AND EXISTS(SELECT 1 FROM task_tags x WHERE x.task_id=s.entity_id AND x.tag_id=?))
               OR (s.entity_type='entry' AND EXISTS(SELECT 1 FROM entry_tags x WHERE x.entry_id=s.entity_id AND x.tag_id=?))
               OR (s.entity_type='note_card' AND EXISTS(SELECT 1 FROM note_card_tags x WHERE x.note_card_id=s.entity_id AND x.tag_id=?)))"
                    .into(),
            );
            for _ in 0..3 {
                binds.push(Box::new(tag_id));
            }
        }
        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };
        // 検索語があるときは関連度順（bm25 は小さいほど良い）、
        // なければ新しい日付順。同点は日付の新しい順で安定させる。
        let order = if expression.is_some() {
            "ORDER BY bm25(search_index) ASC, s.day_date DESC, s.entity_id DESC"
        } else {
            "ORDER BY s.day_date DESC, s.entity_id DESC"
        };

        let params: Vec<&dyn rusqlite::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
        let total: i64 = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM search_index s {where_clause}"),
                params.as_slice(),
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        let sql = format!(
            "SELECT s.entity_type,s.entity_id,s.day_date,s.content FROM search_index s {where_clause} {order} LIMIT {limit} OFFSET {offset}"
        );
        let mut query = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let mut cursor = query.query(params.as_slice()).map_err(|e| e.to_string())?;
        let needles = Self::excerpt_needles(&filter.query);
        let mut results = vec![];
        while let Some(row) = cursor.next().map_err(|e| e.to_string())? {
            let content: String = row.get(3).map_err(|e| e.to_string())?;
            results.push(SearchResult {
                entity_type: row.get(0).map_err(|e| e.to_string())?,
                entity_id: row.get(1).map_err(|e| e.to_string())?,
                day_date: row.get(2).map_err(|e| e.to_string())?,
                excerpt: tokenize::excerpt(content.trim(), &needles, 40),
                tags: vec![],
            });
        }
        for row in &mut results {
            row.tags = match row.entity_type.as_str() {
                "task" => Self::task_tags(&conn, row.entity_id)?,
                "entry" => Self::entry_tags(&conn, row.entity_id)?,
                "note_card" => Self::note_tags(&conn, row.entity_id)?,
                _ => vec![],
            };
        }
        Ok(SearchPage {
            has_more: offset + (results.len() as i64) < total,
            total,
            results,
        })
    }

    /// 索引に入りうる種別だけを通す。未知の値は黙って捨てる。
    fn allowed_entity_types(requested: &[String]) -> Vec<String> {
        const KNOWN: [&str; 5] = ["task", "entry", "note_card", "review", "ai_summary"];
        let kinds: Vec<String> = requested
            .iter()
            .filter(|kind| KNOWN.contains(&kind.as_str()))
            .cloned()
            .collect();
        // 全種別を選んだ状態は絞り込みなしと同じなので、条件を足さない。
        if kinds.len() == KNOWN.len() {
            vec![]
        } else {
            kinds
        }
    }

    /// 抜粋の中心を決めるための検索語。演算子と記号は落とす。
    fn excerpt_needles(query: &str) -> Vec<String> {
        query
            // is_whitespace() は全角スペース(U+3000)も含む。
            .split(|c: char| c.is_whitespace() || c == '"')
            .map(|term| term.trim_start_matches('-'))
            .filter(|term| !term.is_empty() && !term.eq_ignore_ascii_case("or"))
            .map(str::to_string)
            .collect()
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
        let value = serde_json::json!({"date":d.day_date,"tasks":d.tasks.iter().map(|t|serde_json::json!({"title":t.title,"completed":t.is_completed})).collect::<Vec<_>>(),"entries":d.entries.iter().map(|e|serde_json::json!({"time":e.occurred_at,"icon":e.icon,"title":e.title,"body":e.body})).collect::<Vec<_>>(),"note_markdown":note_markdown,"review":{"good":d.review.good,"bad":d.review.bad,"carry_over":d.review.carry_over}});
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

    /// テストから検索を呼ぶための短縮形。絞り込みは検索語とタグだけ。
    fn search(
        db: &Database,
        query: &str,
        tag_id: Option<i64>,
    ) -> Result<Vec<SearchResult>, String> {
        db.search(&SearchFilter {
            query: query.into(),
            tag_id,
            ..SearchFilter::default()
        })
        .map(|page| page.results)
    }

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
    fn tags_migrate_and_filter_tasks_and_note_cards() {
        let path = std::env::temp_dir().join(format!(
            "daylog-tag-test-{}-{}.db",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch("CREATE TABLE days(id INTEGER PRIMARY KEY AUTOINCREMENT,day_date TEXT NOT NULL UNIQUE,is_closed INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
                CREATE TABLE tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,day_id INTEGER NOT NULL,title TEXT NOT NULL,is_completed INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0,priority INTEGER,carried_over INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,completed_at TEXT,due_at TEXT);
                INSERT INTO days(id,day_date,created_at,updated_at) VALUES(1,'2026-09-05','now','now');
                INSERT INTO tasks(id,day_id,title,created_at) VALUES(1,1,'既存タスク','now');").unwrap();
        }
        let db = open_test_database(&path);
        assert!(db.get_day("2026-09-05").unwrap().tasks[0].tags.is_empty());
        let work = db.create_tag("仕事", "blue").unwrap();
        let idea = db.create_tag("発想", "rose").unwrap();
        assert!(db.create_tag("仕事", "green").is_err());
        let task = db.create_task("2026-09-05", "朝会", false).unwrap();
        let note = db.create_note_card("2026-09-05").unwrap();
        db.update_note_card(&NoteCard {
            title: "会議メモ".into(),
            markdown: "確認事項".into(),
            ..note.clone()
        })
        .unwrap();
        assert_eq!(
            db.set_task_tags(task.id, &[work.id, idea.id, work.id])
                .unwrap()
                .len(),
            2
        );
        db.set_note_card_tags(note.id, &[work.id]).unwrap();
        assert!(db.set_task_tags(task.id, &[9999]).is_err());
        assert_eq!(
            db.get_day("2026-09-05")
                .unwrap()
                .tasks
                .iter()
                .find(|item| item.id == task.id)
                .unwrap()
                .tags
                .len(),
            2
        );
        assert_eq!(search(&db, "", Some(work.id)).unwrap().len(), 2);
        assert_eq!(search(&db, "朝会", Some(work.id)).unwrap().len(), 1);
        assert!(search(&db, "確認事項", Some(idea.id)).unwrap().is_empty());
        db.update_tag(&Tag {
            name: "業務".into(),
            color: "teal".into(),
            ..work.clone()
        })
        .unwrap();
        assert_eq!(
            search(&db, "", Some(work.id)).unwrap()[0]
                .tags
                .iter()
                .find(|tag| tag.id == work.id)
                .unwrap()
                .color,
            "teal"
        );
        db.delete_tag(work.id).unwrap();
        assert_eq!(db.get_day("2026-09-05").unwrap().notes[0].tags.len(), 0);
        assert_eq!(
            db.get_day("2026-09-05")
                .unwrap()
                .tasks
                .iter()
                .find(|item| item.id == task.id)
                .unwrap()
                .tags
                .len(),
            1
        );
        db.delete_entity("tasks", task.id).unwrap();
        db.delete_note_card(note.id).unwrap();
        assert!(search(&db, "", Some(idea.id)).unwrap().is_empty());
        drop(db);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn entry_tags_survive_updates_and_filter_search() {
        let path = std::env::temp_dir().join(format!(
            "daylog-entry-tag-test-{}-{}.db",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let db = open_test_database(&path);
        let entry = db.create_entry("2026-09-05", "朝の散歩", "").unwrap();
        drop(db);
        let db = open_test_database(&path);
        assert!(db.get_day("2026-09-05").unwrap().entries[0].tags.is_empty());
        let walk = db.create_tag("散歩", "green").unwrap();
        let health = db.create_tag("健康", "blue").unwrap();
        assert_eq!(
            db.set_entry_tags(entry.id, &[walk.id, health.id, walk.id])
                .unwrap()
                .len(),
            2
        );
        assert!(db.set_entry_tags(entry.id, &[9999]).is_err());
        assert_eq!(search(&db, "", Some(walk.id)).unwrap().len(), 1);
        assert_eq!(search(&db, "朝", Some(walk.id)).unwrap().len(), 1);
        assert!(search(&db, "夜", Some(walk.id)).unwrap().is_empty());
        let updated = db
            .update_entry(
                &Entry {
                    body: "夕方の散歩".into(),
                    ..entry.clone()
                },
                "2026-09-05",
            )
            .unwrap();
        assert_eq!(updated.tags.len(), 2);
        db.update_tag(&Tag {
            name: "ウォーキング".into(),
            color: "teal".into(),
            ..walk.clone()
        })
        .unwrap();
        assert_eq!(
            db.get_day("2026-09-05").unwrap().entries[0]
                .tags
                .iter()
                .find(|tag| tag.id == walk.id)
                .unwrap()
                .color,
            "teal"
        );
        db.delete_tag(walk.id).unwrap();
        assert_eq!(db.get_day("2026-09-05").unwrap().entries[0].tags.len(), 1);
        assert_eq!(search(&db, "", Some(health.id)).unwrap().len(), 1);
        db.delete_entity("entries", entry.id).unwrap();
        assert!(search(&db, "", Some(health.id)).unwrap().is_empty());
        drop(db);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
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
    fn migrates_legacy_columns_and_reorders_tasks_safely() {
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
                CREATE TABLE entries(id INTEGER PRIMARY KEY AUTOINCREMENT,day_id INTEGER NOT NULL,entry_type TEXT NOT NULL DEFAULT 'memo',title TEXT,body TEXT NOT NULL,occurred_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(day_id) REFERENCES days(id) ON DELETE CASCADE);
                INSERT INTO days(id,day_date,created_at,updated_at) VALUES(1,'2026-09-06','now','now');
                INSERT INTO tasks(id,day_id,title,sort_order,created_at) VALUES(1,1,'既存タスク',0,'now');
                INSERT INTO entries(id,day_id,entry_type,body,occurred_at,created_at,updated_at) VALUES(1,1,'気づき','既存の記録','2026-09-06T09:00:00+09:00','now','now');").unwrap();
        }
        let db = open_test_database(&path);
        let existing = db.get_day("2026-09-06").unwrap().tasks.remove(0);
        assert_eq!(existing.title, "既存タスク");
        assert!(existing.due_at.is_none());
        assert_eq!(db.get_day("2026-09-06").unwrap().entries[0].icon, "idea");

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

    /// テスト用の一時データベースのパスを作る。
    fn temp_database_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "daylog-{label}-{}-{}.db",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ))
    }

    fn remove_database(path: &Path) {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn finds_japanese_text_from_two_characters() {
        let path = temp_database_path("fts-japanese");
        let db = open_test_database(&path);
        db.create_entry("2026-09-03", "今日は会議室で打ち合わせをした", "")
            .unwrap();

        // 2文字（trigram では引けない長さ）で引ける。
        assert_eq!(search(&db, "会議", None).unwrap().len(), 1);
        // 語の途中にまたがる部分文字列でも引ける（bigram の利点）。
        assert_eq!(search(&db, "議室で打", None).unwrap().len(), 1);
        assert_eq!(search(&db, "会議室", None).unwrap().len(), 1);
        // 1文字は前方一致で拾う。
        assert_eq!(search(&db, "会", None).unwrap().len(), 1);
        assert!(search(&db, "存在しない語", None).unwrap().is_empty());

        drop(db);
        remove_database(&path);
    }

    #[test]
    fn combines_terms_with_and_or_and_exclusion() {
        let path = temp_database_path("fts-operators");
        let db = open_test_database(&path);
        db.create_task("2026-09-03", "会議の資料をまとめる", false)
            .unwrap();
        db.create_task("2026-09-03", "会議の議事録を書く", false)
            .unwrap();
        db.create_task("2026-09-03", "経費の精算", false).unwrap();

        assert_eq!(search(&db, "会議", None).unwrap().len(), 2);
        // 空白区切りは AND。
        assert_eq!(search(&db, "会議 資料", None).unwrap().len(), 1);
        // OR で広げる。
        assert_eq!(search(&db, "資料 OR 精算", None).unwrap().len(), 2);
        // 先頭の - で除外。
        assert_eq!(search(&db, "会議 -資料", None).unwrap().len(), 1);

        drop(db);
        remove_database(&path);
    }

    #[test]
    fn filters_by_period_and_entity_type_and_pages_results() {
        let path = temp_database_path("fts-filters");
        let db = open_test_database(&path);
        for date in ["2026-09-01", "2026-09-05", "2026-09-10"] {
            db.create_task(date, "共通キーワード のタスク", false)
                .unwrap();
            db.create_entry(date, "共通キーワード の記録", "").unwrap();
        }

        let all = db
            .search(&SearchFilter {
                query: "共通キーワード".into(),
                ..SearchFilter::default()
            })
            .unwrap();
        assert_eq!(all.total, 6);
        assert!(!all.has_more);

        // 期間で絞る（両端を含む）。
        let ranged = db
            .search(&SearchFilter {
                query: "共通キーワード".into(),
                from: Some("2026-09-05".into()),
                to: Some("2026-09-10".into()),
                ..SearchFilter::default()
            })
            .unwrap();
        assert_eq!(ranged.total, 4);

        // 種別で絞る。
        let tasks_only = db
            .search(&SearchFilter {
                query: "共通キーワード".into(),
                entity_types: vec!["task".into()],
                ..SearchFilter::default()
            })
            .unwrap();
        assert_eq!(tasks_only.total, 3);
        assert!(tasks_only.results.iter().all(|r| r.entity_type == "task"));

        // ページング。重複せず、最後のページで has_more が下りる。
        let first = db
            .search(&SearchFilter {
                query: "共通キーワード".into(),
                limit: Some(4),
                ..SearchFilter::default()
            })
            .unwrap();
        assert_eq!(first.results.len(), 4);
        assert!(first.has_more);
        let second = db
            .search(&SearchFilter {
                query: "共通キーワード".into(),
                limit: Some(4),
                offset: Some(4),
                ..SearchFilter::default()
            })
            .unwrap();
        assert_eq!(second.results.len(), 2);
        assert!(!second.has_more);
        let seen: HashSet<(String, i64)> = first
            .results
            .iter()
            .chain(second.results.iter())
            .map(|r| (r.entity_type.clone(), r.entity_id))
            .collect();
        assert_eq!(seen.len(), 6, "ページ間で重複しています");

        drop(db);
        remove_database(&path);
    }

    #[test]
    fn searches_reviews_as_well() {
        let path = temp_database_path("fts-review");
        let db = open_test_database(&path);
        db.save_review(
            "2026-09-03",
            &Review {
                good: "設計の見通しが立った".into(),
                bad: "見積もりが甘かった".into(),
                carry_over: "検証の続き".into(),
            },
        )
        .unwrap();
        let results = search(&db, "見積もり", None).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].entity_type, "review");
        assert_eq!(results[0].day_date, "2026-09-03");

        drop(db);
        remove_database(&path);
    }

    #[test]
    fn returns_nothing_without_any_filter() {
        let path = temp_database_path("fts-empty");
        let db = open_test_database(&path);
        db.create_task("2026-09-03", "何かのタスク", false).unwrap();
        let page = db.search(&SearchFilter::default()).unwrap();
        assert!(page.results.is_empty());
        assert_eq!(page.total, 0);

        drop(db);
        remove_database(&path);
    }

    #[test]
    fn period_stats_cover_every_day_and_match_the_calendar() {
        let path = temp_database_path("period-stats");
        let db = open_test_database(&path);
        // 2026-09-01(火) と 2026-09-03(木) に記録、9/02 は空ける。
        db.create_task("2026-09-01", "設計する", false).unwrap();
        let done = db.create_task("2026-09-01", "片付ける", false).unwrap();
        db.update_task(&Task {
            is_completed: true,
            ..done
        })
        .unwrap();
        db.create_entry("2026-09-01", "朝の記録", "idea:blue")
            .unwrap();
        db.create_entry("2026-09-03", "夕方の記録", "idea").unwrap();
        db.create_note_card("2026-09-03").unwrap();
        db.save_review(
            "2026-09-03",
            &Review {
                good: "進んだ".into(),
                bad: String::new(),
                carry_over: String::new(),
            },
        )
        .unwrap();

        let stats = db.period_stats("2026-09-01", "2026-09-05", None).unwrap();
        // 記録の有無にかかわらず期間の全日が並ぶ。
        assert_eq!(stats.daily.len(), 5);
        assert_eq!(stats.daily[0].date, "2026-09-01");
        assert_eq!(stats.daily[4].date, "2026-09-05");
        assert!(!stats.daily[1].has_record(), "9/02 は空のはず");

        assert_eq!(stats.totals.days_in_range, 5);
        assert_eq!(stats.totals.days_recorded, 2);
        assert_eq!(stats.totals.tasks_total, 2);
        assert_eq!(stats.totals.tasks_completed, 1);
        assert_eq!(stats.totals.entries_total, 2);
        assert_eq!(stats.totals.notes_total, 1);
        assert_eq!(stats.totals.reviews_written, 1);
        // 連続は最長1日、期間末は空なので現在の連続は0。
        assert_eq!((stats.streak_longest, stats.streak_current), (1, 0));

        // アイコンは色を外した名前でまとまる。
        assert_eq!(stats.icon_counts.len(), 1);
        assert_eq!(stats.icon_counts[0].icon, "idea");
        assert_eq!(stats.icon_counts[0].count, 2);

        // 時間帯は24個、曜日は7個。合計は記録の総数と釣り合う。
        assert_eq!(stats.hour_histogram.len(), 24);
        assert_eq!(stats.hour_histogram.iter().sum::<i64>(), 2);
        assert_eq!(stats.weekday_histogram.len(), 7);
        assert_eq!(stats.weekday_histogram.iter().sum::<i64>(), 6);

        // カレンダーの件数バッジと数え方が一致している。
        let calendar = db.calendar(2026, 9).unwrap();
        assert_eq!(calendar.len(), 30);
        assert_eq!(calendar[0].count, stats.daily[0].total());
        assert_eq!(calendar[2].count, stats.daily[2].total());

        // 前期間を渡すと比較が付く。
        let compared = db
            .period_stats(
                "2026-09-01",
                "2026-09-05",
                Some(("2026-08-27", "2026-08-31")),
            )
            .unwrap();
        assert_eq!(compared.previous.unwrap().days_recorded, 0);

        drop(db);
        remove_database(&path);
    }

    #[test]
    fn period_digest_collects_reviews_open_tasks_and_ai_lines() {
        let path = temp_database_path("period-digest");
        let db = open_test_database(&path);
        db.save_review(
            "2026-09-02",
            &Review {
                good: "よかった点".into(),
                bad: String::new(),
                carry_over: String::new(),
            },
        )
        .unwrap();
        // 空の振り返りは読み物に出さない。
        db.save_review(
            "2026-09-03",
            &Review {
                good: "  ".into(),
                bad: String::new(),
                carry_over: String::new(),
            },
        )
        .unwrap();
        db.create_task("2026-09-02", "未完了のまま", false).unwrap();
        let finished = db.create_task("2026-09-02", "終わった", false).unwrap();
        db.update_task(&Task {
            is_completed: true,
            ..finished
        })
        .unwrap();
        // 期間外に作られたが期限が期間内にあるタスクも拾う。
        let due = db.create_task("2026-08-20", "期限が期間内", false).unwrap();
        db.update_task(&Task {
            due_at: Some("2026-09-02T10:00:00+09:00".into()),
            ..due
        })
        .unwrap();

        let digest = db.period_digest("2026-09-01", "2026-09-05").unwrap();
        assert_eq!(digest.reviews.len(), 1);
        assert_eq!(digest.reviews[0].date, "2026-09-02");
        let titles: Vec<&str> = digest.open_tasks.iter().map(|t| t.title.as_str()).collect();
        assert!(titles.contains(&"未完了のまま"));
        assert!(titles.contains(&"期限が期間内"));
        assert!(!titles.contains(&"終わった"), "完了済みが混ざっています");
        assert!(digest.ai_one_lines.is_empty());

        drop(db);
        remove_database(&path);
    }

    #[test]
    fn on_this_day_returns_only_years_with_records() {
        let path = temp_database_path("on-this-day");
        let db = open_test_database(&path);
        db.create_entry("2025-09-23", "1年前の記録", "").unwrap();
        // 行だけ作られて中身がない年は返さない。
        db.get_day("2024-09-23").unwrap();

        let days = db.on_this_day("2026-09-23", 3).unwrap();
        assert_eq!(days.len(), 1);
        assert_eq!(days[0].day_date, "2025-09-23");

        // 該当なしでも空配列。
        assert!(db.on_this_day("2026-05-05", 3).unwrap().is_empty());
        // 存在しない日付は弾く。
        assert!(db.on_this_day("2026-02-30", 1).is_err());

        drop(db);
        remove_database(&path);
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
        db.create_entry("2026-09-03", "朝会で進捗を確認", "done")
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
        assert!(search(&db, "シンプル", None)
            .unwrap()
            .iter()
            .any(|r| r.entity_type == "note_card"));
        assert!(!search(&db, "朝会", None).unwrap().is_empty());
        drop(db);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn creates_entries_on_the_selected_date_and_keeps_them_there_when_updated() {
        let path = std::env::temp_dir().join(format!(
            "daylog-entry-date-test-{}-{}.db",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let db = open_test_database(&path);

        for date in ["2000-01-02", "2099-12-30"] {
            let entry = db.create_entry(date, "選択日の記録", "").unwrap();
            assert!(entry.occurred_at.starts_with(&format!("{date}T")));

            let updated = db
                .update_entry(
                    &Entry {
                        body: "編集後の記録".into(),
                        ..entry
                    },
                    date,
                )
                .unwrap();
            assert!(updated.occurred_at.starts_with(&format!("{date}T")));
            assert_eq!(db.get_day(date).unwrap().entries.len(), 1);
        }
        assert!(db.create_entry("2000-02-30", "不正な日付", "").is_err());

        drop(db);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    /// 記号だけの検索語がワイルドカードとして働いたり、MATCH の構文エラーに
    /// なったりしないこと。FTS5 では記号はトークンにならないので 0 件になる。
    fn special_characters_never_act_as_wildcards() {
        let path = std::env::temp_dir().join(format!(
            "daylog-literal-search-test-{}-{}.db",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let db = open_test_database(&path);
        let literal = db
            .create_task("2026-09-03", r"進捗100%_done\path", false)
            .unwrap();
        let ordinary = db.create_task("2026-09-03", "通常のタスク", false).unwrap();
        let tag = db.create_tag("検索", "blue").unwrap();
        db.set_task_tags(literal.id, &[tag.id]).unwrap();
        db.set_task_tags(ordinary.id, &[tag.id]).unwrap();

        // 記号やFTS5の演算子だけを入れても、全件が返ったりエラーになったりしない。
        for query in ["%", r"\", "*", "(", "\"", "^", ":", "NEAR"] {
            let results = search(&db, query, None).unwrap();
            assert!(results.is_empty(), "query: {query} → {} 件", results.len());
        }
        // 記号を含むタスクも、語として成立する部分では引ける。
        let by_word = search(&db, "進捗", None).unwrap();
        assert_eq!(by_word.len(), 1);
        assert_eq!(by_word[0].entity_id, literal.id);
        let tagged = search(&db, "進捗", Some(tag.id)).unwrap();
        assert_eq!(tagged.len(), 1);
        assert_eq!(tagged[0].entity_id, literal.id);
        // タグだけの絞り込みでは両方出る。
        assert_eq!(search(&db, "", Some(tag.id)).unwrap().len(), 2);

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
            .create_entry("2026-09-05", "変更前の内容", "done")
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
        assert!(search(&db, "変更前", None).unwrap().is_empty());
        assert_eq!(
            search(&db, "変更後", None).unwrap()[0].day_date,
            "2026-09-07"
        );

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
        assert_eq!(
            search(&db, "本文を保持", None).unwrap()[0].entity_type,
            "note_card"
        );
        assert!(search(&db, "古い検索", None).unwrap().is_empty());
        drop(db);
        let db = open_test_database(&path);
        assert_eq!(db.get_day("2026-09-04").unwrap().notes.len(), 1);
        drop(db);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }
}
