use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub is_completed: bool,
    pub sort_order: i64,
    pub priority: Option<i64>,
    pub carried_over: bool,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: i64,
    pub entry_type: String,
    pub title: Option<String>,
    pub body: String,
    pub occurred_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteCard {
    pub id: i64,
    pub title: String,
    pub markdown: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub is_image: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub good: String,
    pub bad: String,
    pub carry_over: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSummary {
    pub id: i64,
    pub summary: String,
    pub one_line: String,
    pub achievements: Vec<String>,
    pub tomorrow_candidates: Vec<String>,
    pub model_name: Option<String>,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayData {
    pub id: i64,
    pub day_date: String,
    pub is_closed: bool,
    pub tasks: Vec<Task>,
    pub entries: Vec<Entry>,
    pub notes: Vec<NoteCard>,
    pub review: Review,
    pub ai_summary: Option<AiSummary>,
    pub national_holiday_name: Option<String>,
    pub custom_holiday_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarDay {
    pub date: String,
    pub count: i64,
    pub is_closed: bool,
    pub national_holiday_name: Option<String>,
    pub custom_holiday_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomHoliday {
    pub date: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HolidayUpdateResult {
    pub count: usize,
    pub latest_date: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub entity_type: String,
    pub entity_id: i64,
    pub day_date: String,
    pub excerpt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub ai_enabled: bool,
    pub model_path: String,
    pub backend: String,
    pub context_size: Option<u32>,
    pub generation_length: String,
    pub backup_generations: usize,
    pub theme: String,
    pub layout: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            ai_enabled: false,
            model_path: String::new(),
            backend: "Auto".into(),
            context_size: None,
            generation_length: "標準".into(),
            backup_generations: 30,
            theme: "light".into(),
            layout: "one".into(),
        }
    }
}
