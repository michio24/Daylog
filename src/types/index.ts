export type Screen = "today" | "history" | "review" | "search" | "tags" | "settings";
export type SaveStatus = "saved" | "saving" | "error";
export type AiStatus = "idle" | "starting" | "loading" | "generating" | "completed" | "cancelled" | "error";

export interface Tag { id: number; name: string; color: string; }
export interface Task { id: number; title: string; isCompleted: boolean; sortOrder: number; priority?: number | null; carriedOver: boolean; completedAt?: string | null; dueAt?: string | null; tags: Tag[]; }
export interface Entry { id: number; icon: string; title?: string | null; body: string; occurredAt: string; tags?: Tag[]; }
export interface NoteCard { id: number; title: string; markdown: string; sortOrder: number; tags: Tag[]; }
export interface Attachment { id: string; name: string; mimeType: string; sizeBytes: number; isImage: boolean; }
export interface Review { good: string; bad: string; carryOver: string; }
export interface AiSummary { id: number; summary: string; oneLine: string; achievements: string[]; tomorrowCandidates: string[]; modelName?: string | null; generatedAt: string; }
export interface DayData { id: number; dayDate: string; isClosed: boolean; tasks: Task[]; entries: Entry[]; notes: NoteCard[]; review: Review; aiSummary?: AiSummary | null; nationalHolidayName?: string | null; customHolidayName?: string | null; }
export interface CalendarDay { date: string; count: number; isClosed: boolean; nationalHolidayName?: string | null; customHolidayName?: string | null; }
export interface CustomHoliday { date: string; name: string; }
export interface HolidayUpdateResult { count: number; latestDate: string; }
export interface ExportResult { markdownPath: string; assetsDirectory?: string | null; attachmentCount: number; }
export interface SearchResult { entityType: string; entityId: number; dayDate: string; excerpt: string; tags: Tag[]; }
export type SearchKind = "task" | "entry" | "note_card" | "review" | "ai_summary";
/** 検索の絞り込み条件。省略した項目は絞り込みなし。 */
export interface SearchFilter { query: string; tagId?: number | null; entityTypes?: SearchKind[]; from?: string | null; to?: string | null; limit?: number; offset?: number; }
export interface SearchPage { results: SearchResult[]; total: number; hasMore: boolean; }

export type PeriodKind = "week" | "month";
export interface DayStat { date: string; tasksTotal: number; tasksCompleted: number; entries: number; notes: number; hasReview: boolean; isClosed: boolean; nationalHolidayName?: string | null; customHolidayName?: string | null; }
export interface PeriodTotals { daysInRange: number; daysRecorded: number; daysClosed: number; tasksTotal: number; tasksCompleted: number; entriesTotal: number; notesTotal: number; reviewsWritten: number; }
export interface TagCount { tag: Tag; count: number; }
export interface IconCount { icon: string; count: number; }
export interface PeriodStats { start: string; end: string; totals: PeriodTotals; previous?: PeriodTotals | null; daily: DayStat[]; tagCounts: TagCount[]; iconCounts: IconCount[]; hourHistogram: number[]; weekdayHistogram: number[]; streakLongest: number; streakCurrent: number; }
export interface DayReview { date: string; good: string; bad: string; carryOver: string; }
export interface OpenTask { id: number; date: string; title: string; dueAt?: string | null; carriedOver: boolean; tags: Tag[]; }
export interface DayLine { date: string; oneLine: string; }
export interface PeriodDigest { reviews: DayReview[]; openTasks: OpenTask[]; aiOneLines: DayLine[]; }
export interface Settings { aiEnabled: boolean; modelPath: string; backend: "Auto" | "CUDA" | "Vulkan" | "CPU"; contextSize: number | null; generationLength: "短め" | "標準" | "長め"; backupGenerations: number; theme: "light" | "mist" | "fluent" | "sakura" | "dark" | "circuit" | "retro"; layout: "one" | "two" | "three"; }
