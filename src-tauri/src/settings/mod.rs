use crate::models::Settings;
use std::{fs, path::PathBuf, sync::RwLock};

const MIN_BACKUP_GENERATIONS: usize = 1;
const MAX_BACKUP_GENERATIONS: usize = 365;

fn normalize(mut settings: Settings) -> Settings {
    settings.backup_generations = settings
        .backup_generations
        .clamp(MIN_BACKUP_GENERATIONS, MAX_BACKUP_GENERATIONS);
    settings
}

pub struct SettingsStore {
    path: PathBuf,
    value: RwLock<Settings>,
}
impl SettingsStore {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let value = normalize(if path.exists() {
            serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?)
                .unwrap_or_default()
        } else {
            Settings::default()
        });
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
        if !(MIN_BACKUP_GENERATIONS..=MAX_BACKUP_GENERATIONS)
            .contains(&next.backup_generations)
        {
            return Err("バックアップ世代数は1〜365で指定してください".into());
        }
        let json = serde_json::to_string_pretty(&next).map_err(|e| e.to_string())?;
        fs::write(&self.path, json).map_err(|e| e.to_string())?;
        *self.value.write().map_err(|e| e.to_string())? = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_settings_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "daylog-settings-{label}-{}-{}.json",
            std::process::id(),
            chrono::Local::now().timestamp_nanos_opt().unwrap_or_default()
        ))
    }

    #[test]
    fn normalizes_loaded_backup_generations_and_rejects_invalid_saves() {
        for (stored, expected) in [(0, 1), (366, 365)] {
            let path = temp_settings_path(&stored.to_string());
            let settings = Settings {
                backup_generations: stored,
                ..Settings::default()
            };
            fs::write(&path, serde_json::to_string(&settings).unwrap()).unwrap();

            let store = SettingsStore::open(path.clone()).unwrap();
            assert_eq!(store.get().unwrap().backup_generations, expected);
            let _ = fs::remove_file(path);
        }

        let path = temp_settings_path("save");
        let store = SettingsStore::open(path.clone()).unwrap();
        for invalid in [0, 366] {
            let settings = Settings {
                backup_generations: invalid,
                ..Settings::default()
            };
            assert!(store.save(settings).is_err());
        }
        for valid in [1, 365] {
            let settings = Settings {
                backup_generations: valid,
                ..Settings::default()
            };
            store.save(settings).unwrap();
            assert_eq!(store.get().unwrap().backup_generations, valid);
        }
        let _ = fs::remove_file(path);
    }
}
