use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: String,
}

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
    pub due_at: Option<String>,
    #[serde(default)]
    pub tags: Vec<Tag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: i64,
    pub icon: String,
    pub title: Option<String>,
    pub body: String,
    pub occurred_at: String,
    #[serde(default)]
    pub tags: Vec<Tag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteCard {
    pub id: i64,
    pub title: String,
    pub markdown: String,
    pub sort_order: i64,
    #[serde(default)]
    pub tags: Vec<Tag>,
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
pub struct ExportResult {
    pub markdown_path: String,
    pub assets_directory: Option<String>,
    pub attachment_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub entity_type: String,
    pub entity_id: i64,
    pub day_date: String,
    pub excerpt: String,
    pub tags: Vec<Tag>,
}

/// 検索の絞り込み条件。省略された項目は絞り込みなしを意味する。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFilter {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub tag_id: Option<i64>,
    /// 空なら全種別。`task` / `entry` / `note_card` / `review` / `ai_summary`。
    #[serde(default)]
    pub entity_types: Vec<String>,
    /// "YYYY-MM-DD"。両端を含む。
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

/// 1ページぶんの検索結果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub results: Vec<SearchResult>,
    pub total: i64,
    pub has_more: bool,
}

/// 期間内の1日ぶんの件数。記録がない日も 0 埋めで並ぶ。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayStat {
    pub date: String,
    pub tasks_total: i64,
    pub tasks_completed: i64,
    pub entries: i64,
    pub notes: i64,
    pub has_review: bool,
    pub is_closed: bool,
    pub national_holiday_name: Option<String>,
    pub custom_holiday_name: Option<String>,
}

impl DayStat {
    /// この日に何かしら記録があるか。連続記録日数やヒートマップの判定に使う。
    pub fn has_record(&self) -> bool {
        self.tasks_total > 0 || self.entries > 0 || self.notes > 0 || self.has_review
    }

    pub fn total(&self) -> i64 {
        self.tasks_total + self.entries + self.notes + i64::from(self.has_review)
    }
}

/// 期間の合計。前期間との比較にも同じ型を使う。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodTotals {
    pub days_in_range: i64,
    pub days_recorded: i64,
    pub days_closed: i64,
    pub tasks_total: i64,
    pub tasks_completed: i64,
    pub entries_total: i64,
    pub notes_total: i64,
    pub reviews_written: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub tag: Tag,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IconCount {
    pub icon: String,
    pub count: i64,
}

/// 期間の統計。グラフに出す数値をまとめて返す。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodStats {
    pub start: String,
    pub end: String,
    pub totals: PeriodTotals,
    pub previous: Option<PeriodTotals>,
    pub daily: Vec<DayStat>,
    pub tag_counts: Vec<TagCount>,
    pub icon_counts: Vec<IconCount>,
    /// 0時〜23時それぞれの記録件数。長さ 24。
    pub hour_histogram: Vec<i64>,
    /// 日曜〜土曜それぞれの記録量。長さ 7。
    pub weekday_histogram: Vec<i64>,
    /// 期間内での連続記録日数（最長と、期間末までの現在の連続）。
    pub streak_longest: i64,
    pub streak_current: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayReview {
    pub date: String,
    pub good: String,
    pub bad: String,
    pub carry_over: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenTask {
    pub id: i64,
    pub date: String,
    pub title: String,
    pub due_at: Option<String>,
    pub carried_over: bool,
    pub tags: Vec<Tag>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayLine {
    pub date: String,
    pub one_line: String,
}

/// 期間の読み物。統計より重いので別コマンドに分けている。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodDigest {
    pub reviews: Vec<DayReview>,
    pub open_tasks: Vec<OpenTask>,
    pub ai_one_lines: Vec<DayLine>,
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
