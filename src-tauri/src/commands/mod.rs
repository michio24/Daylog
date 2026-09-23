use crate::{
    ai::AiProcessManager, backup, database::Database, logging, models::*, settings::SettingsStore,
    AppPaths,
};
use chrono::{DateTime, Local, NaiveDate};
use tauri::State;
use tauri_plugin_opener::OpenerExt;

const ENTRY_ICONS: [&str; 25] = [
    "message", "done", "break", "idea", "alert", "work", "meeting", "study", "write", "code",
    "meal", "walk", "exercise", "health", "sleep", "travel", "shopping", "home", "happy", "goal",
    "beer", "music", "movie", "photo", "gift",
];
const ENTRY_COLORS: [&str; 12] = [
    "blue", "teal", "green", "amber", "orange", "rose", "violet", "slate", "cyan", "indigo", "red",
    "brown",
];

fn valid_entry_icon(value: &str) -> bool {
    if value.is_empty() {
        return true;
    }
    match value.split_once(':') {
        Some((icon, color)) => ENTRY_ICONS.contains(&icon) && ENTRY_COLORS.contains(&color),
        None => ENTRY_ICONS.contains(&value),
    }
}

#[tauri::command]
pub fn get_today(db: State<Database>) -> Result<DayData, String> {
    db.get_day(&Local::now().format("%Y-%m-%d").to_string())
}
#[tauri::command]
pub fn get_day(date: String, db: State<Database>) -> Result<DayData, String> {
    db.get_day(&date)
}
#[tauri::command]
pub fn create_task(
    date: String,
    title: String,
    carried_over: bool,
    db: State<Database>,
) -> Result<Task, String> {
    if title.trim().is_empty() {
        return Err("タスク名が空です".into());
    }
    db.create_task(&date, title.trim(), carried_over)
}
#[tauri::command]
pub fn update_task(mut task: Task, db: State<Database>) -> Result<Task, String> {
    task.title = task.title.trim().to_string();
    if task.title.is_empty() {
        return Err("タスク名が空です".into());
    }
    if task
        .due_at
        .as_deref()
        .is_some_and(|due_at| DateTime::parse_from_rfc3339(due_at).is_err())
    {
        return Err("期限の形式が正しくありません".into());
    }
    db.update_task(&task)
}
#[tauri::command]
pub fn delete_task(id: i64, db: State<Database>) -> Result<(), String> {
    db.delete_entity("tasks", id)
}
#[tauri::command]
pub fn reorder_tasks(
    date: String,
    ordered_ids: Vec<i64>,
    db: State<Database>,
) -> Result<Vec<Task>, String> {
    db.reorder_tasks(&date, &ordered_ids)
}
#[tauri::command]
pub fn create_entry(
    date: String,
    body: String,
    icon: String,
    db: State<Database>,
) -> Result<Entry, String> {
    if body.trim().is_empty() {
        return Err("記録が空です".into());
    }
    if !valid_entry_icon(&icon) {
        return Err("記録のアイコンが正しくありません".into());
    }
    db.create_entry(&date, body.trim(), &icon)
}
#[tauri::command]
pub fn update_entry(
    mut entry: Entry,
    target_date: String,
    db: State<Database>,
) -> Result<Entry, String> {
    entry.body = entry.body.trim().to_string();
    if entry.body.is_empty() {
        return Err("記録が空です".into());
    }
    if !valid_entry_icon(&entry.icon) {
        return Err("記録のアイコンが正しくありません".into());
    }
    let occurred_at = DateTime::parse_from_rfc3339(&entry.occurred_at)
        .map_err(|_| "記録日時の形式が正しくありません".to_string())?;
    if NaiveDate::parse_from_str(&target_date, "%Y-%m-%d").is_err()
        || occurred_at.format("%Y-%m-%d").to_string() != target_date
    {
        return Err("記録日が正しくありません".into());
    }
    db.update_entry(&entry, &target_date)
}
#[tauri::command]
pub fn delete_entry(id: i64, db: State<Database>) -> Result<(), String> {
    db.delete_entity("entries", id)
}
#[tauri::command]
pub fn create_note_card(date: String, db: State<Database>) -> Result<NoteCard, String> {
    db.create_note_card(&date)
}
#[tauri::command]
pub fn update_note_card(card: NoteCard, db: State<Database>) -> Result<NoteCard, String> {
    db.update_note_card(&card)
}
#[tauri::command]
pub fn delete_note_card(id: i64, db: State<Database>) -> Result<(), String> {
    db.delete_note_card(id)
}
#[tauri::command]
pub fn reorder_note_cards(
    date: String,
    ordered_ids: Vec<i64>,
    db: State<Database>,
) -> Result<Vec<NoteCard>, String> {
    db.reorder_note_cards(&date, &ordered_ids)
}
#[tauri::command]
pub fn import_attachment_from_path(
    path: String,
    db: State<Database>,
    paths: State<AppPaths>,
) -> Result<Attachment, String> {
    logging::log_err(
        "添付の取り込み",
        crate::attachments::import_path(&path, &db, &paths),
    )
}
#[tauri::command]
pub fn import_attachment_bytes(
    name: String,
    mime_type: String,
    bytes: Vec<u8>,
    db: State<Database>,
    paths: State<AppPaths>,
) -> Result<Attachment, String> {
    logging::log_err(
        "添付の取り込み",
        crate::attachments::import_bytes(&name, &mime_type, &bytes, &db, &paths),
    )
}
#[tauri::command]
pub fn get_attachment(id: String, db: State<Database>) -> Result<Attachment, String> {
    db.attachment_record(&id).map(|(attachment, _)| attachment)
}
#[tauri::command]
pub fn open_attachment(
    id: String,
    app: tauri::AppHandle,
    db: State<Database>,
    paths: State<AppPaths>,
) -> Result<(), String> {
    let (_, stored_name) = db.attachment_record(&id)?;
    let path = paths.attachments.join(stored_name);
    if !path.is_file() {
        return Err("添付ファイルが見つかりません".into());
    }
    logging::log_err(
        "添付を開く",
        app.opener()
            .open_path(path.to_string_lossy(), None::<&str>)
            .map_err(|e| e.to_string()),
    )
}
#[tauri::command]
pub fn save_review(date: String, review: Review, db: State<Database>) -> Result<(), String> {
    db.save_review(&date, &review)
}
#[tauri::command]
pub fn close_day(date: String, db: State<Database>) -> Result<(), String> {
    db.set_closed(&date, true)
}
#[tauri::command]
pub fn reopen_day(date: String, db: State<Database>) -> Result<(), String> {
    db.set_closed(&date, false)
}
#[tauri::command]
pub fn get_calendar(
    year: i32,
    month: u32,
    db: State<Database>,
) -> Result<Vec<CalendarDay>, String> {
    db.calendar(year, month)
}
#[tauri::command]
pub fn set_custom_holiday(
    date: String,
    name: String,
    db: State<Database>,
) -> Result<CustomHoliday, String> {
    db.set_custom_holiday(&date, &name)
}
#[tauri::command]
pub fn delete_custom_holiday(date: String, db: State<Database>) -> Result<(), String> {
    db.delete_custom_holiday(&date)
}
#[tauri::command]
pub async fn update_national_holidays(
    paths: State<'_, AppPaths>,
) -> Result<HolidayUpdateResult, String> {
    let path = paths.holidays.clone();
    logging::log_err(
        "祝日データの更新",
        crate::holidays::download_and_update(&path).await,
    )
}
#[tauri::command]
pub fn search_entries(filter: SearchFilter, db: State<Database>) -> Result<SearchPage, String> {
    for bound in [&filter.from, &filter.to].into_iter().flatten() {
        if NaiveDate::parse_from_str(bound, "%Y-%m-%d").is_err() {
            return Err("期間の日付が不正です".into());
        }
    }
    if let (Some(from), Some(to)) = (&filter.from, &filter.to) {
        if from > to {
            return Err("期間の開始日が終了日より後です".into());
        }
    }
    db.search(&filter)
}

#[tauri::command]
pub fn get_period_stats(
    start: String,
    end: String,
    compare_start: Option<String>,
    compare_end: Option<String>,
    db: State<Database>,
) -> Result<PeriodStats, String> {
    let compare = match (&compare_start, &compare_end) {
        (Some(from), Some(to)) => Some((from.as_str(), to.as_str())),
        _ => None,
    };
    logging::log_err("期間の統計", db.period_stats(&start, &end, compare))
}

#[tauri::command]
pub fn get_period_digest(
    start: String,
    end: String,
    db: State<Database>,
) -> Result<PeriodDigest, String> {
    logging::log_err("期間の読み物", db.period_digest(&start, &end))
}

#[tauri::command]
pub fn export_period_markdown(
    start: String,
    end: String,
    directory: String,
    db: State<Database>,
    paths: State<AppPaths>,
) -> Result<Vec<ExportResult>, String> {
    logging::log_err(
        "期間のエクスポート",
        crate::export::export_period(&start, &end, &directory, &db, &paths),
    )
}

#[tauri::command]
pub fn get_on_this_day(
    date: String,
    years_back: u32,
    db: State<Database>,
) -> Result<Vec<DayData>, String> {
    db.on_this_day(&date, years_back)
}

fn valid_tag(name: &str, color: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("タグ名が空です".into());
    }
    if !ENTRY_COLORS.contains(&color) {
        return Err("タグの色が正しくありません".into());
    }
    Ok(())
}
#[tauri::command]
pub fn list_tags(db: State<Database>) -> Result<Vec<Tag>, String> {
    db.list_tags()
}
#[tauri::command]
pub fn create_tag(name: String, color: String, db: State<Database>) -> Result<Tag, String> {
    valid_tag(&name, &color)?;
    db.create_tag(name.trim(), &color)
}
#[tauri::command]
pub fn update_tag(mut tag: Tag, db: State<Database>) -> Result<Tag, String> {
    valid_tag(&tag.name, &tag.color)?;
    tag.name = tag.name.trim().into();
    db.update_tag(&tag)
}
#[tauri::command]
pub fn delete_tag(id: i64, db: State<Database>) -> Result<(), String> {
    db.delete_tag(id)
}
#[tauri::command]
pub fn set_task_tags(id: i64, tag_ids: Vec<i64>, db: State<Database>) -> Result<Vec<Tag>, String> {
    db.set_task_tags(id, &tag_ids)
}
#[tauri::command]
pub fn set_entry_tags(id: i64, tag_ids: Vec<i64>, db: State<Database>) -> Result<Vec<Tag>, String> {
    db.set_entry_tags(id, &tag_ids)
}
#[tauri::command]
pub fn set_note_card_tags(
    id: i64,
    tag_ids: Vec<i64>,
    db: State<Database>,
) -> Result<Vec<Tag>, String> {
    db.set_note_card_tags(id, &tag_ids)
}
#[tauri::command]
pub fn get_settings(store: State<SettingsStore>) -> Result<Settings, String> {
    store.get()
}
#[tauri::command]
pub fn save_settings(settings: Settings, store: State<SettingsStore>) -> Result<(), String> {
    store.save(settings)
}
#[tauri::command]
pub async fn run_daily_ai(
    date: String,
    db: State<'_, Database>,
    store: State<'_, SettingsStore>,
    ai: State<'_, AiProcessManager>,
) -> Result<AiSummary, String> {
    let db = db.inner().clone();
    let ai = ai.inner().clone();
    let settings = store.get()?;
    logging::log_err(
        "AIまとめの生成",
        tauri::async_runtime::spawn_blocking(move || ai.run(&db, &date, &settings))
            .await
            .map_err(|e| e.to_string())?,
    )
}
#[tauri::command]
pub fn cancel_ai(ai: State<AiProcessManager>) -> Result<(), String> {
    ai.cancel()
}
#[tauri::command]
pub fn create_backup(
    db: State<Database>,
    store: State<SettingsStore>,
    paths: State<AppPaths>,
) -> Result<String, String> {
    logging::log_err(
        "バックアップの作成",
        backup::create(
            &db,
            &paths.backups,
            &paths.attachments,
            &paths.holidays,
            store.get()?.backup_generations,
        )
        .map(|p| p.display().to_string()),
    )
}

#[tauri::command]
pub fn export_day_markdown(
    date: String,
    path: String,
    db: State<Database>,
    paths: State<AppPaths>,
) -> Result<ExportResult, String> {
    logging::log_err(
        "1日分のエクスポート",
        crate::export::export_day(&date, &path, &db, &paths),
    )
}

#[tauri::command]
pub fn export_note_markdown(
    note_id: i64,
    path: String,
    db: State<Database>,
    paths: State<AppPaths>,
) -> Result<ExportResult, String> {
    logging::log_err(
        "メモのエクスポート",
        crate::export::export_note(note_id, &path, &db, &paths),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_legacy_icons_and_every_frontend_icon_color_pair() {
        assert!(valid_entry_icon(""));
        let frontend = include_str!("../../../src/components/EntryIcon.tsx");
        let values = |section: &str| -> Vec<String> {
            section
                .split("value: \"")
                .skip(1)
                .map(|part| part.split('"').next().unwrap().to_string())
                .collect()
        };
        let icons = values(
            frontend
                .split("export const ENTRY_ICONS = [")
                .nth(1)
                .unwrap()
                .split("] as const;")
                .next()
                .unwrap(),
        );
        let colors = values(
            frontend
                .split("export const ENTRY_COLORS = [")
                .nth(1)
                .unwrap()
                .split("] as const;")
                .next()
                .unwrap(),
        );
        assert_eq!(icons, ENTRY_ICONS);
        assert_eq!(colors, ENTRY_COLORS);
        for icon in icons {
            assert!(valid_entry_icon(&icon));
            for color in &colors {
                assert!(valid_entry_icon(&format!("{icon}:{color}")));
            }
        }
    }

    #[test]
    fn rejects_unknown_and_malformed_icon_pairs() {
        for value in [
            "unknown",
            "unknown:blue",
            "done:unknown",
            ":blue",
            "done:",
            "done:blue:rose",
            " done",
            "done: blue",
        ] {
            assert!(!valid_entry_icon(value), "accepted {value}");
        }
    }
}
