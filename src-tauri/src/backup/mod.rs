use crate::database::Database;
use chrono::Local;
use rusqlite::{backup::Backup, Connection};
use std::{
    fs,
    fs::File,
    io,
    path::{Path, PathBuf},
    time::Duration,
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

pub fn create(
    db: &Database,
    dir: &Path,
    attachments: &Path,
    holidays: &Path,
    generations: usize,
) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let stamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let temp_db = dir.join(format!(".daylog_{stamp}.tmp.db"));
    let path = dir.join(format!("daylog_{stamp}.zip"));
    {
        let source = db.0.lock().map_err(|e| e.to_string())?;
        let mut target = Connection::open(&temp_db).map_err(|e| e.to_string())?;
        let backup = Backup::new(&source, &mut target).map_err(|e| e.to_string())?;
        backup
            .run_to_completion(16, Duration::from_millis(10), None)
            .map_err(|e| e.to_string())?;
    }
    let result = (|| -> Result<(), String> {
        let output = File::create(&path).map_err(|e| e.to_string())?;
        let mut archive = ZipWriter::new(output);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        archive
            .start_file("daylog.db", options)
            .map_err(|e| e.to_string())?;
        io::copy(
            &mut File::open(&temp_db).map_err(|e| e.to_string())?,
            &mut archive,
        )
        .map_err(|e| e.to_string())?;
        if attachments.is_dir() {
            for entry in fs::read_dir(attachments)
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
            {
                let source = entry.path();
                if !source.is_file() {
                    continue;
                }
                let name = entry
                    .file_name()
                    .to_string_lossy()
                    .replace(['/', '\\'], "_");
                archive
                    .start_file(format!("attachments/{name}"), options)
                    .map_err(|e| e.to_string())?;
                io::copy(
                    &mut File::open(source).map_err(|e| e.to_string())?,
                    &mut archive,
                )
                .map_err(|e| e.to_string())?;
            }
        }
        if holidays.is_file() {
            archive
                .start_file("japanese_holidays.csv", options)
                .map_err(|e| e.to_string())?;
            io::copy(
                &mut File::open(holidays).map_err(|e| e.to_string())?,
                &mut archive,
            )
            .map_err(|e| e.to_string())?;
        }
        archive.finish().map_err(|e| e.to_string())?;
        Ok(())
    })();
    let _ = fs::remove_file(&temp_db);
    if let Err(error) = result {
        let _ = fs::remove_file(&path);
        return Err(error);
    }
    rotate(dir, generations)?;
    Ok(path)
}

fn rotate(dir: &Path, generations: usize) -> Result<(), String> {
    let mut files = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|path| {
            path.file_name()
                .and_then(|v| v.to_str())
                .is_some_and(|name| name.starts_with("daylog_"))
                && matches!(
                    path.extension().and_then(|v| v.to_str()),
                    Some("db" | "zip")
                )
        })
        .collect::<Vec<_>>();
    files.sort();
    let excess = files.len().saturating_sub(generations.max(1));
    for old in files.into_iter().take(excess) {
        let _ = fs::remove_file(old);
    }
    Ok(())
}

pub fn create_daily_if_needed(
    db: &Database,
    dir: &Path,
    attachments: &Path,
    holidays: &Path,
    generations: usize,
) -> Result<Option<PathBuf>, String> {
    let today = Local::now().format("daylog_%Y%m%d_").to_string();
    let exists = dir.exists()
        && fs::read_dir(dir)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .any(|e| e.file_name().to_string_lossy().starts_with(&today));
    if exists {
        Ok(None)
    } else {
        create(db, dir, attachments, holidays, generations).map(Some)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn zip_contains_database_attachments_and_holidays() {
        let root = std::env::temp_dir().join(format!(
            "daylog-backup-test-{}-{}",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let attachment_dir = root.join("attachments");
        let backup_dir = root.join("backups");
        fs::create_dir_all(&attachment_dir).unwrap();
        fs::write(attachment_dir.join("sample.txt"), b"attachment").unwrap();
        let holidays = root.join("japanese_holidays.csv");
        let db = Database::open(&root.join("daylog.db"), holidays.clone()).unwrap();
        let path = create(&db, &backup_dir, &attachment_dir, &holidays, 3).unwrap();
        let file = File::open(path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        assert!(archive.by_name("daylog.db").is_ok());
        assert!(archive.by_name("attachments/sample.txt").is_ok());
        assert!(archive.by_name("japanese_holidays.csv").is_ok());
        drop(db);
        let _ = fs::remove_dir_all(root);
    }
}
