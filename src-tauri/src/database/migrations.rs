//! スキーマのバージョン管理。
//!
//! `PRAGMA user_version` に適用済みバージョンを持たせる。バージョン管理を
//! 導入する前に作られた既存データベースは user_version が既定値の 0 なので、
//! 「v1 未適用」として自然に扱える。
//!
//! 各バージョンの処理は必ず冪等に書くこと。v1 は旧バージョンの Daylog が
//! 起動時に手続き的に行っていた移行をそのまま引き継いでおり、すでに移行済みの
//! 既存データベースに対してもう一度走っても安全である必要がある。

use rusqlite::{params, Connection, OpenFlags, Transaction};
use std::path::Path;

/// このバイナリが扱えるスキーマの最新バージョン。
pub const LATEST_VERSION: u32 = 2;

/// 既存データベースに未適用のマイグレーションがあるか。
///
/// 起動時に「移行が走る前のデータベースを退避する」かどうかの判断に使う。
/// まだファイルが無い（初回起動）場合や読めない場合は false を返し、
/// 判断がつかないときに無駄な退避をしない。
pub fn has_pending(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .and_then(|conn| conn.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0)))
        .map(|current| current < LATEST_VERSION)
        .unwrap_or(false)
}

type Step = fn(&Transaction) -> Result<(), String>;

const MIGRATIONS: &[(u32, Step)] = &[(1, v1_baseline), (2, v2_search_bigram)];

/// 未適用のマイグレーションを順に適用する。
pub fn migrate(conn: &mut Connection) -> Result<(), String> {
    conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")
        .map_err(|e| e.to_string())?;
    let current: u32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if current > LATEST_VERSION {
        // 新しい Daylog で作られたデータを古いバイナリで開くと壊しかねないので止める。
        return Err(format!(
            "このデータは新しいバージョンの Daylog（スキーマ v{current}）で作られています。Daylog を更新してください。"
        ));
    }
    for (version, step) in MIGRATIONS {
        if *version <= current {
            continue;
        }
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        step(&tx)?;
        // PRAGMA はプレースホルダを受け付けないが、version は定数なので直接埋めて安全。
        tx.pragma_update(None, "user_version", *version)
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        crate::logging::info(&format!("スキーマを v{version} に移行しました"));
    }
    Ok(())
}

/// v1: バージョン管理導入時点のスキーマ一式と、それ以前の手続き的移行。
fn v1_baseline(tx: &Transaction) -> Result<(), String> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS days(id INTEGER PRIMARY KEY AUTOINCREMENT,day_date TEXT NOT NULL UNIQUE,is_closed INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,day_id INTEGER NOT NULL,title TEXT NOT NULL,is_completed INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0,priority INTEGER,carried_over INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,completed_at TEXT,due_at TEXT,FOREIGN KEY(day_id) REFERENCES days(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS entries(id INTEGER PRIMARY KEY AUTOINCREMENT,day_id INTEGER NOT NULL,icon TEXT NOT NULL DEFAULT '',title TEXT,body TEXT NOT NULL,occurred_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(day_id) REFERENCES days(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS daily_notes(id INTEGER PRIMARY KEY AUTOINCREMENT,day_id INTEGER NOT NULL UNIQUE,markdown TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(day_id) REFERENCES days(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS note_cards(id INTEGER PRIMARY KEY AUTOINCREMENT,day_id INTEGER NOT NULL,title TEXT NOT NULL DEFAULT '',markdown TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(day_id) REFERENCES days(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,original_name TEXT NOT NULL,stored_name TEXT NOT NULL UNIQUE,mime_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,is_image INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,orphaned_at TEXT);
      CREATE TABLE IF NOT EXISTS note_attachments(note_card_id INTEGER NOT NULL,attachment_id TEXT NOT NULL,PRIMARY KEY(note_card_id,attachment_id),FOREIGN KEY(note_card_id) REFERENCES note_cards(id) ON DELETE CASCADE,FOREIGN KEY(attachment_id) REFERENCES attachments(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY AUTOINCREMENT,day_id INTEGER NOT NULL UNIQUE,good TEXT NOT NULL DEFAULT '',bad TEXT NOT NULL DEFAULT '',carry_over TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(day_id) REFERENCES days(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS ai_summaries(id INTEGER PRIMARY KEY AUTOINCREMENT,day_id INTEGER NOT NULL,summary TEXT,one_line TEXT,achievements_json TEXT,tomorrow_candidates_json TEXT,model_name TEXT,source_hash TEXT,generated_at TEXT NOT NULL,FOREIGN KEY(day_id) REFERENCES days(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS ai_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT NOT NULL UNIQUE,day_id INTEGER NOT NULL,status TEXT NOT NULL,model_name TEXT,backend TEXT,started_at TEXT,finished_at TEXT,elapsed_ms INTEGER,error_message TEXT,FOREIGN KEY(day_id) REFERENCES days(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS custom_holidays(date TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tags(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE COLLATE NOCASE,color TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task_tags(task_id INTEGER NOT NULL,tag_id INTEGER NOT NULL,PRIMARY KEY(task_id,tag_id),FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS entry_tags(entry_id INTEGER NOT NULL,tag_id INTEGER NOT NULL,PRIMARY KEY(entry_id,tag_id),FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE,FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS note_card_tags(note_card_id INTEGER NOT NULL,tag_id INTEGER NOT NULL,PRIMARY KEY(note_card_id,tag_id),FOREIGN KEY(note_card_id) REFERENCES note_cards(id) ON DELETE CASCADE,FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE);
      CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(entity_type UNINDEXED,entity_id UNINDEXED,day_id UNINDEXED,content,tokenize='unicode61');
      CREATE INDEX IF NOT EXISTS idx_tasks_day ON tasks(day_id); CREATE INDEX IF NOT EXISTS idx_entries_day_time ON entries(day_id,occurred_at); CREATE INDEX IF NOT EXISTS idx_note_cards_day_order ON note_cards(day_id,sort_order,id);",
    )
    .map_err(|e| e.to_string())?;

    // 期限つきタスクの導入前に作られたデータベースには due_at 列がない。
    if !has_column(tx, "tasks", "due_at")? {
        tx.execute("ALTER TABLE tasks ADD COLUMN due_at TEXT", [])
            .map_err(|e| e.to_string())?;
    }

    // 記録の分類が「entry_type の文字列」から「アイコン名」に変わったときの移行。
    if !has_column(tx, "entries", "icon")? {
        tx.execute(
            "ALTER TABLE entries ADD COLUMN icon TEXT NOT NULL DEFAULT ''",
            [],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE entries SET icon=CASE entry_type WHEN '仕事' THEN 'done' WHEN '気づき' THEN 'idea' WHEN '出来事' THEN 'message' WHEN '体調' THEN 'break' WHEN 'アイデア' THEN 'idea' ELSE '' END",
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    // 絵文字で保存していた時期のアイコンをアイコン名へ。該当がなければ 0 行更新。
    tx.execute(
        "UPDATE entries SET icon=CASE icon WHEN '💼' THEN 'done' WHEN '💡' THEN 'idea' WHEN '📌' THEN 'message' WHEN '🌿' THEN 'break' WHEN '✨' THEN 'idea' ELSE icon END",
        [],
    )
    .map_err(|e| e.to_string())?;

    migrate_daily_notes(tx)?;
    Ok(())
}

/// v2: 検索索引を bigram 方式へ作り直す。
///
/// 旧 `search_index` は原文をそのまま `unicode61` に食わせていたため、日本語が
/// 分かち書きされず MATCH がまったく効かなかった（検索は LIKE の全走査だった）。
/// bigram 化したトークン列を別列に持たせ、原文は抜粋用に UNINDEXED で残す。
/// 期間での絞り込みを JOIN なしで効かせるため `day_date` も持たせる。
fn v2_search_bigram(tx: &Transaction) -> Result<(), String> {
    tx.execute_batch(
        "DROP TABLE IF EXISTS search_index;
         CREATE VIRTUAL TABLE search_index USING fts5(
           entity_type UNINDEXED, entity_id UNINDEXED, day_id UNINDEXED,
           day_date UNINDEXED, content UNINDEXED, tokens,
           tokenize='unicode61');",
    )
    .map_err(|e| e.to_string())?;
    let indexed = reindex_all(tx)?;
    crate::logging::info(&format!("検索索引を作り直しました: {indexed}件"));
    Ok(())
}

/// 全エンティティから検索索引を作り直し、投入件数を返す。
///
/// 本文の組み立て方は `Database` 側の各 CRUD が `index()` に渡す文字列と
/// 揃えること。ずれると再構築の前後で検索結果が変わる。
pub(super) fn reindex_all(tx: &Transaction) -> Result<i64, String> {
    // (種別, 「id, day_id, day_date, 本文」を返すSQL)
    let sources: [(&str, &str); 5] = [
        (
            "task",
            "SELECT t.id,t.day_id,d.day_date,t.title FROM tasks t JOIN days d ON d.id=t.day_id",
        ),
        (
            "entry",
            "SELECT e.id,e.day_id,d.day_date,COALESCE(e.title,'')||' '||e.body FROM entries e JOIN days d ON d.id=e.day_id",
        ),
        (
            "note_card",
            "SELECT n.id,n.day_id,d.day_date,n.title||' '||n.markdown FROM note_cards n JOIN days d ON d.id=n.day_id",
        ),
        // 振り返りは1日1件なので entity_id に day_id をそのまま使う。
        (
            "review",
            "SELECT r.day_id,r.day_id,d.day_date,r.good||' '||r.bad||' '||r.carry_over FROM reviews r JOIN days d ON d.id=r.day_id",
        ),
        // AIまとめは再実行のたびに行が増えるので、日ごとの最新1件だけを索引する。
        (
            "ai_summary",
            "SELECT a.id,a.day_id,d.day_date,COALESCE(a.summary,'')||' '||COALESCE(a.one_line,'') FROM ai_summaries a JOIN days d ON d.id=a.day_id WHERE a.id=(SELECT MAX(a2.id) FROM ai_summaries a2 WHERE a2.day_id=a.day_id)",
        ),
    ];
    let mut total = 0;
    for (kind, sql) in sources {
        let rows = {
            let mut query = tx.prepare(sql).map_err(|e| e.to_string())?;
            let rows = query
                .query_map([], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        };
        for (id, day_id, day_date, content) in rows {
            if content.trim().is_empty() {
                continue;
            }
            tx.execute(
                "INSERT INTO search_index(entity_type,entity_id,day_id,day_date,content,tokens) VALUES(?1,?2,?3,?4,?5,?6)",
                params![kind, id, day_id, day_date, content, super::tokenize::bigramize(&content)],
            )
            .map_err(|e| e.to_string())?;
            total += 1;
        }
    }
    Ok(total)
}

/// 1日1枚だった `daily_notes` を複数枚の `note_cards` へ移す。
fn migrate_daily_notes(tx: &Transaction) -> Result<(), String> {
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
    Ok(())
}

/// 旧メモの最初の見出しをカードのタイトルに流用する。
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

fn has_column(tx: &Transaction, table: &str, column: &str) -> Result<bool, String> {
    let mut query = tx
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let columns = query
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(columns.iter().any(|name| name == column))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user_version(conn: &Connection) -> u32 {
        conn.query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap()
    }

    fn table_exists(conn: &Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name=?1",
            [name],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
            > 0
    }

    #[test]
    fn applies_every_migration_to_a_fresh_database() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        assert_eq!(user_version(&conn), LATEST_VERSION);
        for table in [
            "days",
            "tasks",
            "entries",
            "note_cards",
            "attachments",
            "reviews",
            "ai_summaries",
            "ai_runs",
            "tags",
            "search_index",
        ] {
            assert!(table_exists(&conn, table), "{table} が作られていません");
        }
    }

    #[test]
    fn running_migrate_twice_is_a_no_op() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO days(day_date,created_at,updated_at) VALUES('2026-01-01','t','t')",
            [],
        )
        .unwrap();
        migrate(&mut conn).unwrap();
        let days: i64 = conn
            .query_row("SELECT COUNT(*) FROM days", [], |row| row.get(0))
            .unwrap();
        assert_eq!(days, 1);
        assert_eq!(user_version(&conn), LATEST_VERSION);
    }

    #[test]
    fn upgrades_a_pre_versioning_schema() {
        let mut conn = Connection::open_in_memory().unwrap();
        // due_at と icon がなく、daily_notes に本文が残っている時代のデータベース。
        conn.execute_batch(
            "CREATE TABLE days(id INTEGER PRIMARY KEY AUTOINCREMENT,day_date TEXT NOT NULL UNIQUE,is_closed INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
             CREATE TABLE tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,day_id INTEGER NOT NULL,title TEXT NOT NULL,is_completed INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0,priority INTEGER,carried_over INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,completed_at TEXT);
             CREATE TABLE entries(id INTEGER PRIMARY KEY AUTOINCREMENT,day_id INTEGER NOT NULL,entry_type TEXT NOT NULL DEFAULT '',title TEXT,body TEXT NOT NULL,occurred_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
             CREATE TABLE daily_notes(id INTEGER PRIMARY KEY AUTOINCREMENT,day_id INTEGER NOT NULL UNIQUE,markdown TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
             INSERT INTO days(id,day_date,created_at,updated_at) VALUES(1,'2026-01-01','t','t');
             INSERT INTO entries(day_id,entry_type,body,occurred_at,created_at,updated_at) VALUES(1,'気づき','ひらめき','2026-01-01T10:00:00+09:00','t','t');
             INSERT INTO daily_notes(day_id,markdown,created_at,updated_at) VALUES(1,'# 旧メモ\n本文','t','t');",
        )
        .unwrap();
        assert_eq!(user_version(&conn), 0);

        migrate(&mut conn).unwrap();

        assert_eq!(user_version(&conn), LATEST_VERSION);
        assert!(has_column_conn(&conn, "tasks", "due_at"));
        let icon: String = conn
            .query_row("SELECT icon FROM entries", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            icon, "idea",
            "entry_type からアイコン名へ移行されていません"
        );
        let (title, markdown): (String, String) = conn
            .query_row("SELECT title,markdown FROM note_cards", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(title, "旧メモ");
        assert!(markdown.contains("本文"));
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM daily_notes", [], |row| row.get(0))
            .unwrap();
        assert_eq!(remaining, 0, "daily_notes が空になっていません");
    }

    #[test]
    fn converts_emoji_icons_to_icon_names() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO days(id,day_date,created_at,updated_at) VALUES(1,'2026-01-01','t','t');
             INSERT INTO entries(day_id,icon,body,occurred_at,created_at,updated_at) VALUES(1,'💡','x','2026-01-01T10:00:00+09:00','t','t');",
        )
        .unwrap();
        // 移行済みデータベースなので v1 は再実行されない＝絵文字はそのまま残る。
        migrate(&mut conn).unwrap();
        let icon: String = conn
            .query_row("SELECT icon FROM entries", [], |row| row.get(0))
            .unwrap();
        assert_eq!(icon, "💡");

        // user_version を 0 に戻すと v1 が再適用され、変換される。
        conn.pragma_update(None, "user_version", 0u32).unwrap();
        migrate(&mut conn).unwrap();
        let icon: String = conn
            .query_row("SELECT icon FROM entries", [], |row| row.get(0))
            .unwrap();
        assert_eq!(icon, "idea");
    }

    #[test]
    fn v2_rebuilds_the_index_so_japanese_becomes_searchable() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO days(id,day_date,created_at,updated_at) VALUES(1,'2026-01-01','t','t');
             INSERT INTO tasks(day_id,title,created_at) VALUES(1,'会議室を予約する','t');
             INSERT INTO reviews(day_id,good,bad,carry_over,created_at,updated_at) VALUES(1,'順調','','','t','t');",
        )
        .unwrap();

        // v1 時点の索引（原文をそのまま unicode61 に食わせていた）に戻す。
        conn.execute_batch(
            "DROP TABLE search_index;
             CREATE VIRTUAL TABLE search_index USING fts5(entity_type UNINDEXED,entity_id UNINDEXED,day_id UNINDEXED,content,tokenize='unicode61');
             INSERT INTO search_index(entity_type,entity_id,day_id,content) VALUES('task',1,1,'会議室を予約する');",
        )
        .unwrap();
        conn.pragma_update(None, "user_version", 1u32).unwrap();

        migrate(&mut conn).unwrap();

        assert_eq!(user_version(&conn), LATEST_VERSION);
        // タスクと振り返りの両方が bigram つきで入り直している。
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM search_index", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 2);
        let hits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM search_index WHERE tokens MATCH '\"会議\"*'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1, "2文字の日本語で引けていません");
        let day_date: String = conn
            .query_row(
                "SELECT day_date FROM search_index WHERE entity_type='task'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(day_date, "2026-01-01");
    }

    #[test]
    fn rejects_a_future_schema_version() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        conn.pragma_update(None, "user_version", LATEST_VERSION + 1)
            .unwrap();
        let error = migrate(&mut conn).unwrap_err();
        assert!(
            error.contains("新しいバージョン"),
            "想定外のエラー: {error}"
        );
    }

    fn has_column_conn(conn: &Connection, table: &str, column: &str) -> bool {
        let mut query = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .unwrap();
        let columns: Vec<String> = query
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        columns.iter().any(|name| name == column)
    }
}

#[cfg(test)]
mod real_database_check {
    use super::*;

    /// 実際のデータベースに対して移行を試すための確認用テスト。
    /// `DAYLOG_MIGRATION_CHECK_DB` にコピーしたファイルのパスを渡して
    /// `cargo test -- --ignored real_database` で実行する。
    #[test]
    #[ignore]
    fn real_database_migrates_and_becomes_searchable() {
        let path = std::env::var("DAYLOG_MIGRATION_CHECK_DB")
            .expect("DAYLOG_MIGRATION_CHECK_DB を設定してください");
        let mut conn = Connection::open(&path).unwrap();
        let before: u32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        migrate(&mut conn).unwrap();
        let after: u32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        let indexed: i64 = conn
            .query_row("SELECT COUNT(*) FROM search_index", [], |row| row.get(0))
            .unwrap();
        let days: i64 = conn
            .query_row("SELECT COUNT(*) FROM days", [], |row| row.get(0))
            .unwrap();
        println!("user_version {before} -> {after} / days={days} / search_index={indexed}");
        assert_eq!(after, LATEST_VERSION);

        // 2回目は何も起きない。
        migrate(&mut conn).unwrap();
        let again: i64 = conn
            .query_row("SELECT COUNT(*) FROM search_index", [], |row| row.get(0))
            .unwrap();
        assert_eq!(again, indexed, "再実行で索引が変わりました");

        // 索引に入っている語で実際に引けること。
        if let Ok(sample) = conn.query_row(
            "SELECT content FROM search_index WHERE length(content)>4 LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        ) {
            let word: String = sample.chars().take(2).collect();
            if let Some(expression) = super::super::tokenize::build_match_expression(&word) {
                let hits: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM search_index WHERE tokens MATCH ?1",
                        [&expression],
                        |row| row.get(0),
                    )
                    .unwrap();
                println!("「{word}」({expression}) で {hits} 件");
                assert!(hits > 0, "「{word}」が引けませんでした");
            }
        }
    }
}
