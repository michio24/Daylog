use chrono::NaiveDate;
use encoding_rs::SHIFT_JIS;
use std::{
    collections::HashMap,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use crate::models::HolidayUpdateResult;

// Source: Cabinet Office of Japan, downloaded 2026-09-05 and normalized from
// Shift_JIS with slash-separated dates to UTF-8 with ISO dates. This copy is
// used only to initialize the user-editable external CSV on first launch.
// https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv
const DEFAULT_JAPANESE_HOLIDAYS: &str = include_str!("../resources/japanese_holidays.csv");
const JAPANESE_HOLIDAYS_URL: &str = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv";
const MAX_DOWNLOAD_BYTES: usize = 1024 * 1024;

#[derive(Clone)]
pub struct HolidayCalendar {
    path: PathBuf,
}

impl HolidayCalendar {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let previous = sidecar_path(&path, ".previous");
        if !path.exists() && previous.is_file() {
            fs::rename(&previous, &path).map_err(|error| {
                format!(
                    "祝日CSVを復旧できませんでした ({}): {error}",
                    path.display()
                )
            })?;
        }
        if !path.exists() {
            fs::write(&path, DEFAULT_JAPANESE_HOLIDAYS).map_err(|error| {
                format!(
                    "祝日CSVを初期化できませんでした ({}): {error}",
                    path.display()
                )
            })?;
        }
        Ok(Self { path })
    }

    pub fn load(&self) -> Result<HashMap<String, String>, String> {
        let content = fs::read_to_string(&self.path).map_err(|error| {
            format!(
                "祝日CSVを読み込めませんでした ({}): {error}",
                self.path.display()
            )
        })?;
        parse(&content)
    }

    pub fn national_holiday_name(&self, date: &str) -> Result<Option<String>, String> {
        Ok(self.load()?.remove(date))
    }
}

pub async fn download_and_update(path: &Path) -> Result<HolidayUpdateResult, String> {
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("Daylog/1.0 holiday updater")
        .build()
        .map_err(|error| format!("祝日データの通信を準備できませんでした: {error}"))?
        .get(JAPANESE_HOLIDAYS_URL)
        .send()
        .await
        .map_err(|error| format!("祝日データをダウンロードできませんでした: {error}"))?
        .error_for_status()
        .map_err(|error| format!("祝日データの取得に失敗しました: {error}"))?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_DOWNLOAD_BYTES as u64)
    {
        return Err("祝日データが大きすぎます".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("祝日データを受信できませんでした: {error}"))?;
    if bytes.len() > MAX_DOWNLOAD_BYTES {
        return Err("祝日データが大きすぎます".into());
    }
    let (normalized, result) = normalize_download(&bytes)?;
    replace_file(path, normalized.as_bytes())?;
    Ok(result)
}

fn normalize_download(bytes: &[u8]) -> Result<(String, HolidayUpdateResult), String> {
    let decoded = match std::str::from_utf8(bytes) {
        Ok(value) => value.to_string(),
        Err(_) => {
            let (value, _, had_errors) = SHIFT_JIS.decode(bytes);
            if had_errors {
                return Err("祝日データの文字コードを変換できませんでした".into());
            }
            value.into_owned()
        }
    };
    let holidays = parse(&decoded)?;
    if holidays.len() < 100 || holidays.get("1955-01-01").map(String::as_str) != Some("元日") {
        return Err("取得したファイルを内閣府の祝日データとして確認できませんでした".into());
    }
    let mut rows = holidays.into_iter().collect::<Vec<_>>();
    rows.sort_by(|left, right| left.0.cmp(&right.0));
    let latest_date = rows
        .last()
        .map(|(date, _)| date.clone())
        .ok_or("取得した祝日データが空です")?;
    let normalized = rows
        .iter()
        .map(|(date, name)| format!("{date},{name}"))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    Ok((
        normalized,
        HolidayUpdateResult {
            count: rows.len(),
            latest_date,
        },
    ))
}

fn sidecar_path(path: &Path, suffix: &str) -> PathBuf {
    let mut value = OsString::from(path.as_os_str());
    value.push(suffix);
    PathBuf::from(value)
}

fn replace_file(path: &Path, content: &[u8]) -> Result<(), String> {
    let download = sidecar_path(path, ".download");
    let previous = sidecar_path(path, ".previous");
    let _ = fs::remove_file(&download);
    let _ = fs::remove_file(&previous);
    fs::write(&download, content)
        .map_err(|error| format!("更新した祝日CSVを保存できませんでした: {error}"))?;
    if path.exists() {
        fs::rename(path, &previous).map_err(|error| {
            let _ = fs::remove_file(&download);
            format!("現在の祝日CSVを更新できませんでした: {error}")
        })?;
    }
    if let Err(error) = fs::rename(&download, path) {
        let _ = fs::rename(&previous, path);
        let _ = fs::remove_file(&download);
        return Err(format!("更新した祝日CSVを反映できませんでした: {error}"));
    }
    let _ = fs::remove_file(previous);
    Ok(())
}

fn parse(content: &str) -> Result<HashMap<String, String>, String> {
    let mut holidays = HashMap::new();
    for (index, raw_line) in content.lines().enumerate() {
        let line_number = index + 1;
        let line = raw_line.trim().trim_start_matches('\u{feff}');
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((raw_date, raw_name)) = line.split_once(',') else {
            return Err(format!(
                "祝日CSVの{line_number}行目が不正です。日付,名称の形式で入力してください"
            ));
        };
        let raw_date = raw_date.trim();
        if index == 0 && matches!(raw_date, "date" | "日付" | "国民の祝日・休日月日") {
            continue;
        }
        let date = NaiveDate::parse_from_str(raw_date, "%Y-%m-%d")
            .or_else(|_| NaiveDate::parse_from_str(raw_date, "%Y/%m/%d"))
            .map_err(|_| format!("祝日CSVの{line_number}行目の日付が不正です: {raw_date}"))?;
        let name = raw_name.trim();
        if name.is_empty() {
            return Err(format!("祝日CSVの{line_number}行目の名称が空です"));
        }
        if name.chars().count() > 80 {
            return Err(format!(
                "祝日CSVの{line_number}行目の名称は80文字以内にしてください"
            ));
        }
        holidays.insert(date.format("%Y-%m-%d").to_string(), name.to_string());
    }
    Ok(holidays)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "daylog-{name}-{}-{}",
            std::process::id(),
            chrono::Local::now()
                .timestamp_nanos_opt()
                .unwrap_or_default()
        ))
    }

    #[test]
    fn initializes_external_csv_and_reloads_user_updates() {
        let root = test_directory("holiday-file");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("japanese_holidays.csv");
        let calendar = HolidayCalendar::open(path.clone()).unwrap();
        assert!(path.is_file());
        assert_eq!(
            calendar.national_holiday_name("2026-09-22").unwrap(),
            Some("休日".into())
        );
        assert_eq!(calendar.national_holiday_name("2028-01-01").unwrap(), None);

        fs::write(
            &path,
            "date,name\n2028/1/1,ユーザー更新の祝日\n2028-02-11,建国記念の日\n",
        )
        .unwrap();
        assert_eq!(
            calendar.national_holiday_name("2028-01-01").unwrap(),
            Some("ユーザー更新の祝日".into())
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reports_invalid_rows_with_the_line_number() {
        let error = parse("2028-01-01,元日\ninvalid-row").unwrap_err();
        assert!(error.contains("2行目"));
    }

    #[test]
    fn normalizes_shift_jis_downloads_after_validation() {
        let mut source = DEFAULT_JAPANESE_HOLIDAYS.replace(
            "2027-11-23,勤労感謝の日",
            "2027-11-23,更新された勤労感謝の日",
        );
        source.push_str("2028/1/1,元日\n");
        let (encoded, _, _) = SHIFT_JIS.encode(&source);
        let (normalized, result) = normalize_download(&encoded).unwrap();
        assert_eq!(result.latest_date, "2028-01-01");
        assert!(result.count > 100);
        assert!(normalized.contains("2028-01-01,元日"));
        assert!(!normalized.contains("2028/1/1"));
    }

    #[test]
    fn rejects_an_unrelated_download() {
        let error = normalize_download(b"date,name\n2028-01-01,New Year\n").unwrap_err();
        assert!(error.contains("内閣府"));
    }
}
