mod ai;
mod attachments;
mod backup;
mod commands;
mod database;
mod export;
mod holidays;
mod models;
mod settings;
use ai::AiProcessManager;
use database::Database;
use settings::SettingsStore;
use std::{fs, path::PathBuf};
use tauri_plugin_window_state::StateFlags;

pub struct AppPaths {
    pub root: PathBuf,
    pub backups: PathBuf,
    pub attachments: PathBuf,
    pub holidays: PathBuf,
}
fn app_root() -> PathBuf {
    if cfg!(debug_assertions) {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    } else {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let root = app_root();
    let data = root.join("data");
    let backups = root.join("backups");
    let logs = root.join("logs");
    let models = root.join("models");
    let attachments_dir = data.join("attachments");
    let holidays_path = data.join("japanese_holidays.csv");
    for dir in [&data, &backups, &logs, &models, &attachments_dir] {
        fs::create_dir_all(dir).expect("Daylog directory creation failed");
    }
    let db = Database::open(&data.join("daylog.db"), holidays_path.clone())
        .expect("database initialization failed");
    let settings =
        SettingsStore::open(root.join("settings.json")).expect("settings initialization failed");
    let generations = settings.get().map(|s| s.backup_generations).unwrap_or(30);
    let paths = AppPaths {
        root: root.clone(),
        backups,
        attachments: attachments_dir,
        holidays: holidays_path,
    };
    let _ = attachments::cleanup(&db, &paths);
    let _ = backup::create_daily_if_needed(
        &db,
        &paths.backups,
        &paths.attachments,
        &paths.holidays,
        generations,
    );
    let ai_executable = root.join("ai").join(if cfg!(windows) {
        "daylog-ai.exe"
    } else {
        "daylog-ai"
    });
    let protocol_db = db.clone();
    let protocol_dir = paths.attachments.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .register_uri_scheme_protocol("daylog-attachment", move |_context, request| {
            let id = request
                .uri()
                .path()
                .trim_start_matches('/')
                .split('/')
                .next()
                .unwrap_or("");
            let response =
                protocol_db
                    .attachment_record(id)
                    .ok()
                    .and_then(|(attachment, stored_name)| {
                        if !attachment.is_image {
                            return None;
                        }
                        fs::read(protocol_dir.join(stored_name))
                            .ok()
                            .map(|bytes| (attachment.mime_type, bytes))
                    });
            match response {
                Some((mime_type, bytes)) => tauri::http::Response::builder()
                    .header("Content-Type", mime_type)
                    .header("X-Content-Type-Options", "nosniff")
                    .header("Cache-Control", "private, max-age=3600")
                    .body(bytes)
                    .unwrap(),
                None => tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap(),
            }
        })
        .manage(db)
        .manage(settings)
        .manage(AiProcessManager::new(ai_executable))
        .manage(paths)
        .invoke_handler(tauri::generate_handler![
            commands::get_today,
            commands::get_day,
            commands::create_task,
            commands::update_task,
            commands::delete_task,
            commands::reorder_tasks,
            commands::create_entry,
            commands::update_entry,
            commands::delete_entry,
            commands::create_note_card,
            commands::update_note_card,
            commands::delete_note_card,
            commands::reorder_note_cards,
            commands::import_attachment_from_path,
            commands::import_attachment_bytes,
            commands::get_attachment,
            commands::open_attachment,
            commands::save_review,
            commands::close_day,
            commands::reopen_day,
            commands::get_calendar,
            commands::set_custom_holiday,
            commands::delete_custom_holiday,
            commands::update_national_holidays,
            commands::search_entries,
            commands::get_settings,
            commands::save_settings,
            commands::run_daily_ai,
            commands::cancel_ai,
            commands::create_backup,
            commands::export_day_markdown,
            commands::export_note_markdown
        ])
        .run(tauri::generate_context!())
        .expect("error while running Daylog");
}
