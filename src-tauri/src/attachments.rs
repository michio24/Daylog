use crate::{database::Database, models::Attachment, AppPaths};
use chrono::{Duration, Local, SecondsFormat};
use std::{fs, path::Path};
use uuid::Uuid;

const IMAGE_LIMIT: u64 = 20 * 1024 * 1024;
const FILE_LIMIT: u64 = 100 * 1024 * 1024;
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp"];

fn store(
    name: &str,
    _mime_hint: &str,
    bytes: &[u8],
    db: &Database,
    paths: &AppPaths,
) -> Result<Attachment, String> {
    let safe_name = Path::new(name)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("attachment")
        .chars()
        .take(255)
        .collect::<String>();
    let original_extension = Path::new(&safe_name)
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("bin")
        .to_ascii_lowercase();
    let original_extension = if original_extension
        .chars()
        .all(|c| c.is_ascii_alphanumeric())
        && original_extension.len() <= 10
    {
        original_extension
    } else {
        "bin".into()
    };
    let detected = infer::get(bytes);
    let detected_extension = detected
        .as_ref()
        .map(|kind| kind.extension().to_ascii_lowercase());
    let is_image = detected
        .as_ref()
        .is_some_and(|kind| IMAGE_EXTENSIONS.contains(&kind.extension()));
    let extension = if is_image {
        detected_extension.unwrap_or(original_extension)
    } else {
        original_extension
    };
    let limit = if is_image { IMAGE_LIMIT } else { FILE_LIMIT };
    if bytes.len() as u64 > limit {
        return Err(format!(
            "ファイルサイズが上限（{}MB）を超えています",
            limit / 1024 / 1024
        ));
    }
    if bytes.is_empty() {
        return Err("空のファイルは添付できません".into());
    }
    let id = Uuid::new_v4().to_string();
    let stored_name = format!("{id}.{extension}");
    let target = paths.attachments.join(&stored_name);
    let temporary = paths.attachments.join(format!(".{id}.tmp"));
    fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
    fs::rename(&temporary, &target).map_err(|e| e.to_string())?;
    let mime_type = detected
        .as_ref()
        .map(|kind| kind.mime_type().to_string())
        .unwrap_or_else(|| {
            mime_guess::from_path(&safe_name)
                .first_or_octet_stream()
                .essence_str()
                .to_string()
        });
    let attachment = Attachment {
        id,
        name: safe_name,
        mime_type,
        size_bytes: bytes.len() as u64,
        is_image,
    };
    if let Err(error) = db.register_attachment(&attachment, &stored_name) {
        let _ = fs::remove_file(target);
        return Err(error);
    }
    Ok(attachment)
}

pub fn import_path(path: &str, db: &Database, paths: &AppPaths) -> Result<Attachment, String> {
    let source = Path::new(path);
    let metadata = fs::metadata(source).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > FILE_LIMIT {
        return Err("選択したファイルを添付できません".into());
    }
    let bytes = fs::read(source).map_err(|e| e.to_string())?;
    let name = source
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("attachment");
    store(name, "", &bytes, db, paths)
}

pub fn import_bytes(
    name: &str,
    mime_type: &str,
    bytes: &[u8],
    db: &Database,
    paths: &AppPaths,
) -> Result<Attachment, String> {
    store(name, mime_type, bytes, db, paths)
}

pub fn cleanup(db: &Database, paths: &AppPaths) -> Result<(), String> {
    let cutoff = (Local::now() - Duration::days(30)).to_rfc3339_opts(SecondsFormat::Millis, false);
    for name in db.take_expired_attachments(&cutoff)? {
        let _ = fs::remove_file(paths.attachments.join(name));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn test_context() -> (PathBuf, Database, AppPaths) {
        let root = std::env::temp_dir().join(format!(
            "daylog-attachment-import-test-{}-{}",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let attachments = root.join("attachments");
        fs::create_dir_all(&attachments).unwrap();
        let holidays = root.join("japanese_holidays.csv");
        let db = Database::open(&root.join("daylog.db"), holidays.clone()).unwrap();
        let paths = AppPaths {
            root: root.clone(),
            backups: root.join("backups"),
            attachments,
            holidays,
        };
        (root, db, paths)
    }

    #[test]
    fn stores_same_named_files_separately_and_treats_svg_as_attachment() {
        let (root, db, paths) = test_context();
        let first =
            import_bytes("diagram.svg", "image/svg+xml", b"<svg></svg>", &db, &paths).unwrap();
        let second =
            import_bytes("diagram.svg", "image/svg+xml", b"<svg></svg>", &db, &paths).unwrap();
        assert_ne!(first.id, second.id);
        assert!(!first.is_image);
        assert_eq!(fs::read_dir(&paths.attachments).unwrap().count(), 2);
        drop(db);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_an_image_larger_than_twenty_megabytes() {
        let (root, db, paths) = test_context();
        let mut bytes = vec![0; IMAGE_LIMIT as usize + 1];
        bytes[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        let error = import_bytes("large.png", "image/png", &bytes, &db, &paths).unwrap_err();
        assert!(error.contains("20MB"));
        assert_eq!(fs::read_dir(&paths.attachments).unwrap().count(), 0);
        drop(db);
        let _ = fs::remove_dir_all(root);
    }
}
