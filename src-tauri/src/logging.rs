//! `logs/daylog.log` への追記ロガー。
//!
//! **日誌の本文は絶対にログへ書かないこと。** Daylog は完全ローカルで動く
//! 個人の日記であり、ログファイルはバックアップZIPにも入らない場所に平文で
//! 残る。記録してよいのは操作名・件数・エラー文字列など、内容を復元できない
//! 情報だけに限る。
//!
//! 単一プロセスかつ書き込み頻度が低いので、`tracing` などを導入せず
//! `Mutex<File>` への追記で足りる（ポータブル配布のバイナリを太らせない）。

use chrono::{Local, SecondsFormat};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::Path,
    sync::{Mutex, OnceLock},
};

/// これを超えていたら起動時に1世代だけ退避する。
const MAX_BYTES: u64 = 5 * 1024 * 1024;

static LOG: OnceLock<Mutex<File>> = OnceLock::new();

/// `<root>/logs/daylog.log` を開く。失敗してもアプリは動かすので Result は返さない。
pub fn init(root: &Path) {
    let dir = root.join("logs");
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("daylog.log");
    rotate_if_large(&path, &dir);
    if let Ok(file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = LOG.set(Mutex::new(file));
    }
    info(&format!(
        "Daylog {} を起動しました",
        env!("CARGO_PKG_VERSION")
    ));
}

pub fn info(message: &str) {
    write_line("INFO", message);
}

pub fn error(message: &str) {
    write_line("ERROR", message);
}

/// `Err` をログに残しつつそのまま返す。コマンドの戻り値を包んで使う。
pub fn log_err<T>(context: &str, result: Result<T, String>) -> Result<T, String> {
    if let Err(reason) = &result {
        error(&format!("{context}: {reason}"));
    }
    result
}

fn write_line(level: &str, message: &str) {
    // init 前（テストなど）は黙って捨てる。
    let Some(lock) = LOG.get() else { return };
    let Ok(mut file) = lock.lock() else { return };
    let stamp = Local::now().to_rfc3339_opts(SecondsFormat::Secs, false);
    let _ = writeln!(file, "{stamp} [{level}] {message}");
    let _ = file.flush();
}

fn rotate_if_large(path: &Path, dir: &Path) {
    let too_large = fs::metadata(path)
        .map(|m| m.len() > MAX_BYTES)
        .unwrap_or(false);
    if too_large {
        let _ = fs::rename(path, dir.join("daylog.log.1"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logging_before_init_is_silently_ignored() {
        // init していないプロセスでも panic しないこと。
        info("これは捨てられる");
        error("これも捨てられる");
    }

    #[test]
    fn log_err_passes_the_result_through() {
        let ok: Result<i32, String> = log_err("文脈", Ok(7));
        assert_eq!(ok, Ok(7));
        let failed: Result<i32, String> = log_err("文脈", Err("失敗".into()));
        assert_eq!(failed, Err("失敗".into()));
    }
}
