export type Screen = "today" | "history" | "search" | "settings";
export type SaveStatus = "saved" | "saving" | "error";
export type AiStatus = "idle" | "starting" | "loading" | "generating" | "completed" | "cancelled" | "error";

export interface Task { id: number; title: string; isCompleted: boolean; sortOrder: number; priority?: number | null; carriedOver: boolean; completedAt?: string | null; dueAt?: string | null; }
export interface Entry { id: number; entryType: string; title?: string | null; body: string; occurredAt: string; }
export interface NoteCard { id: number; title: string; markdown: string; sortOrder: number; }
export interface Attachment { id: string; name: string; mimeType: string; sizeBytes: number; isImage: boolean; }
export interface Review { good: string; bad: string; carryOver: string; }
export interface AiSummary { id: number; summary: string; oneLine: string; achievements: string[]; tomorrowCandidates: string[]; modelName?: string | null; generatedAt: string; }
export interface DayData { id: number; dayDate: string; isClosed: boolean; tasks: Task[]; entries: Entry[]; notes: NoteCard[]; review: Review; aiSummary?: AiSummary | null; nationalHolidayName?: string | null; customHolidayName?: string | null; }
export interface CalendarDay { date: string; count: number; isClosed: boolean; nationalHolidayName?: string | null; customHolidayName?: string | null; }
export interface CustomHoliday { date: string; name: string; }
export interface HolidayUpdateResult { count: number; latestDate: string; }
export interface ExportResult { markdownPath: string; assetsDirectory?: string | null; attachmentCount: number; }
export interface SearchResult { entityType: string; entityId: number; dayDate: string; excerpt: string; }
export interface Settings { aiEnabled: boolean; modelPath: string; backend: "Auto" | "CUDA" | "Vulkan" | "CPU"; contextSize: number | null; generationLength: "短め" | "標準" | "長め"; backupGenerations: number; theme: "light" | "mist" | "fluent" | "sakura" | "dark" | "circuit"; layout: "one" | "two" | "three"; }
