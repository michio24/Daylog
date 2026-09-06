import { invoke } from "@tauri-apps/api/core";
import type { CalendarDay, CustomHoliday, DayData, ExportResult, HolidayUpdateResult, SearchResult, Settings, Task, Entry, NoteCard, Review, AiSummary, Attachment } from "../types";

const call = <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args);

export const api = {
  getToday: () => call<DayData>("get_today"),
  getDay: (date: string) => call<DayData>("get_day", { date }),
  createTask: (date: string, title: string, carriedOver = false) => call<Task>("create_task", { date, title, carriedOver }),
  updateTask: (task: Task) => call<Task>("update_task", { task }),
  deleteTask: (id: number) => call<void>("delete_task", { id }),
  reorderTasks: (date: string, orderedIds: number[]) => call<Task[]>("reorder_tasks", { date, orderedIds }),
  createEntry: (date: string, body: string, entryType: string) => call<Entry>("create_entry", { date, body, entryType }),
  updateEntry: (entry: Entry) => call<Entry>("update_entry", { entry }),
  deleteEntry: (id: number) => call<void>("delete_entry", { id }),
  createNoteCard: (date: string) => call<NoteCard>("create_note_card", { date }),
  updateNoteCard: (card: NoteCard) => call<NoteCard>("update_note_card", { card }),
  deleteNoteCard: (id: number) => call<void>("delete_note_card", { id }),
  reorderNoteCards: (date: string, orderedIds: number[]) => call<NoteCard[]>("reorder_note_cards", { date, orderedIds }),
  importAttachmentFromPath: (path: string) => call<Attachment>("import_attachment_from_path", { path }),
  importAttachmentBytes: (name: string, mimeType: string, bytes: number[]) => call<Attachment>("import_attachment_bytes", { name, mimeType, bytes }),
  getAttachment: (id: string) => call<Attachment>("get_attachment", { id }),
  openAttachment: (id: string) => call<void>("open_attachment", { id }),
  saveReview: (date: string, review: Review) => call<void>("save_review", { date, review }),
  closeDay: (date: string) => call<void>("close_day", { date }),
  reopenDay: (date: string) => call<void>("reopen_day", { date }),
  calendar: (year: number, month: number) => call<CalendarDay[]>("get_calendar", { year, month }),
  setCustomHoliday: (date: string, name: string) => call<CustomHoliday>("set_custom_holiday", { date, name }),
  deleteCustomHoliday: (date: string) => call<void>("delete_custom_holiday", { date }),
  updateNationalHolidays: () => call<HolidayUpdateResult>("update_national_holidays"),
  search: (query: string) => call<SearchResult[]>("search_entries", { query }),
  getSettings: () => call<Settings>("get_settings"),
  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),
  runAi: (date: string) => call<AiSummary>("run_daily_ai", { date }),
  cancelAi: () => call<void>("cancel_ai"),
  createBackup: () => call<string>("create_backup"),
  exportDayMarkdown: (date: string, path: string) => call<ExportResult>("export_day_markdown", { date, path }),
  exportNoteMarkdown: (noteId: number, path: string) => call<ExportResult>("export_note_markdown", { noteId, path })
};
