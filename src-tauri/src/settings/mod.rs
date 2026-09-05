use crate::models::Settings;
use std::{fs, path::PathBuf, sync::RwLock};

pub struct SettingsStore {
    path: PathBuf,
    value: RwLock<Settings>,
}
impl SettingsStore {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let value = if path.exists() {
            serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?)
                .unwrap_or_default()
        } else {
            Settings::default()
        };
        Ok(Self {
            path,
            value: RwLock::new(value),
        })
    }
    pub fn get(&self) -> Result<Settings, String> {
        self.value
            .read()
            .map(|v| v.clone())
            .map_err(|e| e.to_string())
    }
    pub fn save(&self, next: Settings) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&next).map_err(|e| e.to_string())?;
        fs::write(&self.path, json).map_err(|e| e.to_string())?;
        *self.value.write().map_err(|e| e.to_string())? = next;
        Ok(())
    }
}
