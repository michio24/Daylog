mod job_object;
use crate::{
    database::Database,
    models::{AiSummary, Settings},
};
use job_object::JobObject;
use serde_json::Value;
use sha2::{Digest, Sha256};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
use uuid::Uuid;
#[cfg(windows)]
use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

fn snapshot_has_meaningful_content(snapshot: &Value) -> bool {
    let non_empty = |value: Option<&Value>| {
        value
            .and_then(Value::as_str)
            .is_some_and(|text| !text.trim().is_empty())
    };
    snapshot
        .get("tasks")
        .and_then(Value::as_array)
        .is_some_and(|tasks| tasks.iter().any(|task| non_empty(task.get("title"))))
        || snapshot
            .get("entries")
            .and_then(Value::as_array)
            .is_some_and(|entries| {
                entries
                    .iter()
                    .any(|entry| non_empty(entry.get("title")) || non_empty(entry.get("body")))
            })
        || non_empty(snapshot.get("note_markdown"))
        || snapshot.get("review").is_some_and(|review| {
            ["good", "bad", "carry_over"]
                .iter()
                .any(|key| non_empty(review.get(key)))
        })
}

#[derive(Clone)]
pub struct AiProcessManager {
    executable: PathBuf,
    job: Arc<Mutex<Option<JobObject>>>,
    cancelled: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
}
struct RunningGuard<'a>(&'a AtomicBool);
impl Drop for RunningGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
impl AiProcessManager {
    pub fn new(executable: PathBuf) -> Self {
        Self {
            executable,
            job: Arc::new(Mutex::new(None)),
            cancelled: Arc::new(AtomicBool::new(false)),
            running: Arc::new(AtomicBool::new(false)),
        }
    }
    pub fn cancel(&self) -> Result<(), String> {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Some(job) = self.job.lock().map_err(|e| e.to_string())?.as_ref() {
            job.terminate();
        }
        Ok(())
    }
    fn resolve_model_path(&self, configured_path: &str) -> PathBuf {
        let path = PathBuf::from(configured_path);
        if path.is_absolute() {
            return path;
        }
        self.executable
            .parent()
            .and_then(|ai_dir| ai_dir.parent())
            .unwrap_or_else(|| std::path::Path::new("."))
            .join(path)
    }
    pub fn run(&self, db: &Database, date: &str, settings: &Settings) -> Result<AiSummary, String> {
        if !settings.ai_enabled {
            return Err("AI機能が無効です".into());
        }
        let (day_id, snapshot) = db.snapshot_json(date)?;
        if !snapshot_has_meaningful_content(&snapshot) {
            return Err("AIでまとめる記録がまだありません".into());
        }
        if self.running.swap(true, Ordering::SeqCst) {
            return Err("AI処理は既に実行中です".into());
        }
        let _running = RunningGuard(&self.running);
        if settings.model_path.trim().is_empty() {
            return Err("モデルファイルが設定されていません".into());
        }
        let model_path = self.resolve_model_path(settings.model_path.trim());
        if !model_path.is_file() {
            return Err("モデルファイルが見つかりません".into());
        }
        if !self.executable.exists() {
            return Err(format!(
                "AI実行ファイルが見つかりません: {}",
                self.executable.display()
            ));
        }
        self.cancelled.store(false, Ordering::SeqCst);
        let request_id = Uuid::new_v4().to_string();
        let prompt_path = std::env::temp_dir().join(format!("daylog_prompt_{request_id}.txt"));
        let model_path = model_path.to_string_lossy().into_owned();
        db.start_ai_run(&request_id, day_id, &model_path, &settings.backend)?;
        let request = serde_json::json!({"schema_version":1,"request_id":request_id,"operation":"daily_review","locale":"ja-JP","model_path":model_path,"backend":settings.backend,"context_size":settings.context_size,"generation_length":settings.generation_length,"day":snapshot});
        let bytes = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
        let hash = hex::encode(Sha256::digest(&bytes));
        let started = Instant::now();
        let result = (|| {
            let mut command = Command::new(&self.executable);
            #[cfg(windows)]
            command.creation_flags(CREATE_NO_WINDOW);
            let mut child = command
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| e.to_string())?;
            let job = match JobObject::assign(child.id()) {
                Ok(job) => job,
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
            };
            *self.job.lock().map_err(|e| e.to_string())? = Some(job);
            if self.cancelled.load(Ordering::SeqCst) {
                if let Some(job) = self.job.lock().map_err(|e| e.to_string())?.as_ref() {
                    job.terminate();
                }
            }
            child
                .stdin
                .take()
                .ok_or("AI stdin unavailable")?
                .write_all(&bytes)
                .map_err(|e| e.to_string())?;
            let output = child.wait_with_output().map_err(|e| e.to_string())?;
            self.job.lock().map_err(|e| e.to_string())?.take();
            if self.cancelled.load(Ordering::SeqCst) {
                return Err("cancelled".into());
            }
            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
            }
            let response: Value = serde_json::from_slice(&output.stdout)
                .map_err(|e| format!("AI response JSON is invalid: {e}"))?;
            if response.get("request_id").and_then(Value::as_str) != Some(&request_id) {
                return Err("AI response request_id mismatch".into());
            }
            if response.get("status").and_then(Value::as_str) != Some("ok") {
                return Err("AI returned an error".into());
            }
            let model = response
                .pointer("/runtime/model")
                .and_then(Value::as_str)
                .unwrap_or(&model_path);
            let result = response
                .get("result")
                .ok_or("AI response result is missing")?;
            db.finish_ai(
                &request_id,
                day_id,
                result,
                model,
                &hash,
                started.elapsed().as_millis() as i64,
            )
        })();
        let _ = std::fs::remove_file(&prompt_path);
        self.job.lock().map_err(|e| e.to_string())?.take();
        if let Err(ref message) = result {
            let status = if message == "cancelled" {
                "cancelled"
            } else {
                "failed"
            };
            let _ = db.fail_ai(&request_id, status, message);
        }
        result
    }
}
impl Drop for AiProcessManager {
    fn drop(&mut self) {
        if let Ok(guard) = self.job.lock() {
            if let Some(job) = guard.as_ref() {
                job.terminate();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{snapshot_has_meaningful_content, AiProcessManager};
    use std::path::PathBuf;

    #[test]
    fn rejects_an_empty_daily_snapshot() {
        let empty = serde_json::json!({
            "tasks": [],
            "entries": [],
            "note_markdown": "  ",
            "review": { "good": "", "bad": "", "carry_over": "" }
        });
        assert!(!snapshot_has_meaningful_content(&empty));
    }

    #[test]
    fn resolves_a_relative_model_from_the_portable_root() {
        let manager =
            AiProcessManager::new(PathBuf::from("portable").join("ai").join("daylog-ai.exe"));
        assert_eq!(
            manager.resolve_model_path("models/model.gguf"),
            PathBuf::from("portable").join("models").join("model.gguf")
        );
    }

    #[test]
    fn accepts_each_kind_of_recorded_content() {
        let task = serde_json::json!({ "tasks": [{ "title": "資料を読む" }] });
        let entry = serde_json::json!({ "entries": [{ "body": "散歩した" }] });
        let note = serde_json::json!({ "note_markdown": "気づいたこと" });
        let review = serde_json::json!({ "review": { "good": "早く起きた" } });
        assert!(snapshot_has_meaningful_content(&task));
        assert!(snapshot_has_meaningful_content(&entry));
        assert!(snapshot_has_meaningful_content(&note));
        assert!(snapshot_has_meaningful_content(&review));
    }
}
