use crate::{
    ai::AiProcessManager, backup, database::Database, models::*, settings::SettingsStore, AppPaths,
};
use chrono::{DateTime, Local};
use tauri::State;
use tauri_plugin_opener::OpenerExt;

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
    entry_type: String,
    db: State<Database>,
) -> Result<Entry, String> {
    if body.trim().is_empty() {
        return Err("記録が空です".into());
    }
    db.create_entry(&date, body.trim(), &entry_type)
}
#[tauri::command]
pub fn update_entry(entry: Entry, db: State<Database>) -> Result<Entry, String> {
    db.update_entry(&entry)
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
    crate::attachments::import_path(&path, &db, &paths)
}
#[tauri::command]
pub fn import_attachment_bytes(
    name: String,
    mime_type: String,
    bytes: Vec<u8>,
    db: State<Database>,
    paths: State<AppPaths>,
) -> Result<Attachment, String> {
    crate::attachments::import_bytes(&name, &mime_type, &bytes, &db, &paths)
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
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
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
    crate::holidays::download_and_update(&path).await
}
#[tauri::command]
pub fn search_entries(query: String, db: State<Database>) -> Result<Vec<SearchResult>, String> {
    db.search(&query)
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
    tauri::async_runtime::spawn_blocking(move || ai.run(&db, &date, &settings))
        .await
        .map_err(|e| e.to_string())?
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
    backup::create(
        &db,
        &paths.backups,
        &paths.attachments,
        &paths.holidays,
        store.get()?.backup_generations,
    )
    .map(|p| p.display().to_string())
}

#[tauri::command]
pub fn export_day_markdown(
    date: String,
    path: String,
    db: State<Database>,
    paths: State<AppPaths>,
) -> Result<ExportResult, String> {
    crate::export::export_day(&date, &path, &db, &paths)
}

#[tauri::command]
pub fn export_note_markdown(
    note_id: i64,
    path: String,
    db: State<Database>,
    paths: State<AppPaths>,
) -> Result<ExportResult, String> {
    crate::export::export_note(note_id, &path, &db, &paths)
}
