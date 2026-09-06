import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { save as saveFile } from "@tauri-apps/plugin-dialog";
import { api } from "../services/api";
import { useDebouncedSave } from "../hooks/useDebouncedSave";
import type { AiStatus, DayData, Review, SaveStatus, Settings } from "../types";
import { addDaysToDateKey, formatExportFileName, formatHolidayNames, formatLongDate, localDateKey } from "../utils/date";
import { TaskSection } from "../components/TaskSection";
import { TimelineSection } from "../components/TimelineSection";
import { DailyNoteSection, type DailyNoteSectionHandle } from "../components/DailyNoteSection";
import { ReviewSection } from "../components/ReviewSection";
import { CalendarPanel } from "../components/CalendarPanel";

interface Props { day: DayData; settings: Settings; onDay: Dispatch<SetStateAction<DayData | null>>; onOpenDate: (date: string) => Promise<void>; onError: (message: string) => void; }
export interface TodayPageHandle { flush: () => Promise<void>; }
export const TodayPage = forwardRef<TodayPageHandle, Props>(function TodayPage({ day, settings, onDay, onOpenDate, onError }, ref) {
  const [review, setReview] = useState<Review>(day.review);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [aiStatus, setAiStatus] = useState<AiStatus>("idle");
  const [dateNavigationPending, setDateNavigationPending] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const noteSection = useRef<DailyNoteSectionHandle>(null);
  const aiTimers = useRef<number[]>([]);
  const aiCancelled = useRef(false);
  useEffect(() => { setReview(day.review); setSaveStatus("saved"); setExportMessage(""); }, [day.dayDate]);
  useEffect(() => () => aiTimers.current.forEach(window.clearTimeout), []);

  const saveReview = useCallback(async (value: Review) => { setSaveStatus("saving"); try { await api.saveReview(day.dayDate, value); setSaveStatus("saved"); } catch { setSaveStatus("error"); throw new Error("review save failed"); } }, [day.dayDate]);
  const flushReview = useDebouncedSave(review, saveReview);
  const flushAll = useCallback(async () => { await Promise.all([noteSection.current?.flush(), flushReview()]); }, [flushReview]);
  useImperativeHandle(ref, () => ({ flush: flushAll }), [flushAll]);
  const guarded = async (work: () => Promise<void>) => { try { await work(); } catch (error) { onError(String(error)); } };
  const required = async (work: () => Promise<void>) => { try { await work(); } catch (error) { onError(String(error)); throw error; } };
  const updateCurrentDay = (change: (current: DayData) => DayData) => onDay((current) => current?.dayDate === day.dayDate ? change(current) : current);
  const updateReview = (value: Review) => { setReview(value); updateCurrentDay((current) => ({ ...current, review: value })); };
  const navigateToDate = async (date: string) => {
    if (dateNavigationPending || date === day.dayDate) return;
    setDateNavigationPending(true);
    try {
      await flushAll();
      await onOpenDate(date);
    } catch (error) {
      onError(String(error));
    } finally {
      setDateNavigationPending(false);
    }
  };
  const navigateDay = (offset: number) => navigateToDate(addDaysToDateKey(day.dayDate, offset));
  const tomorrow = addDaysToDateKey(day.dayDate, 1);
  const canRunAi = day.tasks.length > 0
    || day.entries.length > 0
    || day.notes.some((note) => note.title.trim() || note.markdown.trim())
    || Boolean(review.good.trim() || review.bad.trim() || review.carryOver.trim());
  const today = localDateKey();
  const hour = new Date().getHours();
  const greeting = day.dayDate < today
    ? "この日はどうでしたか"
    : day.dayDate > today
      ? "この日はどう過ごしますか"
      : hour < 11 ? "おはようございます" : hour < 18 ? "今日はどうですか" : "おつかれさまでした";
  const entryLabel = day.dayDate > today ? "この日の予定・記録" : day.dayDate < today ? "この日の記録" : "今日の記録";
  const holidayNames = formatHolidayNames(day.nationalHolidayName, day.customHolidayName);
  const clearAiTimers = () => { aiTimers.current.forEach(window.clearTimeout); aiTimers.current = []; };
  const runAi = async () => {
    aiCancelled.current = false;
    setAiStatus("starting");
    clearAiTimers();
    aiTimers.current = [window.setTimeout(() => setAiStatus("loading"), 250), window.setTimeout(() => setAiStatus("generating"), 700)];
    try {
      await flushAll();
      const aiSummary = await api.runAi(day.dayDate);
      updateCurrentDay((current) => ({ ...current, aiSummary }));
      if (!aiCancelled.current) setAiStatus("completed");
    } catch (error) {
      if (!aiCancelled.current) { setAiStatus("error"); onError(String(error)); }
    } finally {
      clearAiTimers();
    }
  };
  const cancelAi = async () => {
    aiCancelled.current = true;
    clearAiTimers();
    try { await api.cancelAi(); setAiStatus("cancelled"); }
    catch (error) { setAiStatus("error"); onError(String(error)); }
  };
  const exportMarkdown = async () => {
    if (exporting) return;
    setExporting(true); setExportMessage("");
    try {
      await flushAll();
      const path = await saveFile({ defaultPath: formatExportFileName(day.dayDate), filters: [{ name: "Markdown", extensions: ["md"] }] });
      if (!path) return;
      const result = await api.exportDayMarkdown(day.dayDate, path);
      const attachments = result.attachmentCount ? `（添付 ${result.attachmentCount} 件）` : "";
      setExportMessage(`保存しました: ${result.markdownPath}${attachments}`);
    } catch (error) {
      onError(`Markdownを保存できませんでした: ${String(error)}`);
    } finally {
      setExporting(false);
    }
  };

  return <main className="page today-page">
    <div className={`page-inner ${settings.layout === "two" ? "wide" : settings.layout === "three" ? "three-wide" : ""}`}>
      <div className="page-title"><div className="date-navigation"><button disabled={dateNavigationPending} aria-label="前の日" title="前の日" onClick={() => void navigateDay(-1)}>‹</button><span>{formatLongDate(day.dayDate)}</span>{holidayNames && <em className="holiday-name">{holidayNames}</em>}<button disabled={dateNavigationPending} aria-label="次の日" title="次の日" onClick={() => void navigateDay(1)}>›</button></div>{day.isClosed && <div className="closed-banner"><span>この日は完了済みです。</span><button onClick={() => void guarded(async () => { await api.reopenDay(day.dayDate); updateCurrentDay((current) => ({ ...current, isClosed: false })); })}>再編集</button></div>}<h1>{greeting}</h1><p>{entryLabel} {day.entries.length} 件</p></div>
      <div className={`today-grid ${settings.layout}`}>
        {settings.layout === "three" && <div className="calendar-column"><CalendarPanel compact selectedDate={day.dayDate} disabled={dateNavigationPending} allowFutureMonths onSelectDate={navigateToDate} onHolidayChange={(date, customHolidayName) => { if (date === day.dayDate) updateCurrentDay((current) => ({ ...current, customHolidayName })); }} onError={onError}/></div>}
        <div className="column primary-column">
          <TaskSection tasks={day.tasks} dayDate={day.dayDate} disabled={day.isClosed} onError={onError} onTasksChange={(tasks) => updateCurrentDay((current) => ({ ...current, tasks }))} onAdd={(title) => required(async () => { const task = await api.createTask(day.dayDate, title); updateCurrentDay((current) => ({ ...current, tasks: [...current.tasks, task] })); })} onToggle={(task) => guarded(async () => { const next = await api.updateTask({ ...task, isCompleted: !task.isCompleted }); updateCurrentDay((current) => ({ ...current, tasks: current.tasks.map((item) => item.id === next.id ? next : item) })); })} onUpdate={async (task) => { const next = await api.updateTask(task); updateCurrentDay((current) => ({ ...current, tasks: current.tasks.map((item) => item.id === next.id ? next : item) })); return next; }} onDelete={(id) => guarded(async () => { await api.deleteTask(id); updateCurrentDay((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== id) })); })} onReorder={(orderedIds) => api.reorderTasks(day.dayDate, orderedIds)}/>
          <TimelineSection entries={day.entries} disabled={day.isClosed} onAdd={(body, entryType) => required(async () => { const entry = await api.createEntry(day.dayDate, body, entryType); updateCurrentDay((current) => ({ ...current, entries: [...current.entries, entry] })); })} onType={(entry, entryType) => guarded(async () => { const next = await api.updateEntry({ ...entry, entryType }); updateCurrentDay((current) => ({ ...current, entries: current.entries.map((item) => item.id === next.id ? next : item) })); })} onDelete={(id) => guarded(async () => { await api.deleteEntry(id); updateCurrentDay((current) => ({ ...current, entries: current.entries.filter((entry) => entry.id !== id) })); })}/>
        </div>
        <div className="column secondary-column">
          <DailyNoteSection ref={noteSection} notes={day.notes} disabled={day.isClosed} onError={onError} onCardsChange={(notes) => updateCurrentDay((current) => ({ ...current, notes }))} onCreate={async () => { const card = await api.createNoteCard(day.dayDate); updateCurrentDay((current) => ({ ...current, notes: [...current.notes, card] })); return card; }} onSave={async (card) => { const saved = await api.updateNoteCard(card); updateCurrentDay((current) => ({ ...current, notes: current.notes.map((note) => note.id === saved.id ? saved : note) })); return saved; }} onDelete={async (id) => { await api.deleteNoteCard(id); updateCurrentDay((current) => ({ ...current, notes: current.notes.filter((note) => note.id !== id) })); }} onReorder={async (orderedIds) => { const notes = await api.reorderNoteCards(day.dayDate, orderedIds); updateCurrentDay((current) => ({ ...current, notes })); return notes; }}/>
          <ReviewSection review={review} disabled={day.isClosed} settings={settings} saveStatus={saveStatus} canRunAi={canRunAi} aiStatus={aiStatus} aiSummary={day.aiSummary} exporting={exporting} exportMessage={exportMessage} onChange={updateReview} onBlur={() => void flushReview().catch((error) => onError(String(error)))} onRunAi={() => void runAi()} onCancelAi={() => void cancelAi()} onCandidate={(title) => void guarded(async () => { await api.createTask(tomorrow, title, true); })} onExport={() => void exportMarkdown()} onClose={() => void guarded(async () => { await flushAll(); await api.closeDay(day.dayDate); updateCurrentDay((current) => ({ ...current, review, isClosed: true })); })}/>
        </div>
      </div>
    </div>
  </main>;
});
