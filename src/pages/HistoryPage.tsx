import { useState } from "react";
import { CalendarPanel } from "../components/CalendarPanel";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { api } from "../services/api";
import type { DayData } from "../types";
import { formatHolidayNames, formatLongDate } from "../utils/date";

interface Props { onOpenDay: (day: DayData) => void; }
export function HistoryPage({ onOpenDay }: Props) {
  const [selected, setSelected] = useState<DayData | null>(null);
  const [selectionPending, setSelectionPending] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const choose = async (date: string) => {
    if (selectionPending || selected?.dayDate === date) return;
    setSelectionPending(true); setSelectionError("");
    try { setSelected(await api.getDay(date)); }
    catch (error) { setSelectionError(`記録を読み込めませんでした: ${String(error)}`); }
    finally { setSelectionPending(false); }
  };
  return <main className="page"><div className="page-inner history-width">
    <div className="page-title"><span>HISTORY</span><h1>記録の履歴</h1></div>
    <div className="history-grid">
      <CalendarPanel selectedDate={selected?.dayDate} disabled={selectionPending} onSelectDate={choose} onHolidayChange={(date, customHolidayName) => setSelected((current) => current?.dayDate === date ? { ...current, customHolidayName } : current)}/>
      <section className="card day-preview">{selectionError ? <p className="error-text" role="alert">{selectionError}</p> : selected ? <><div className="section-heading"><div><span>{formatLongDate(selected.dayDate)}{formatHolidayNames(selected.nationalHolidayName, selected.customHolidayName) && <em className="holiday-name">{formatHolidayNames(selected.nationalHolidayName, selected.customHolidayName)}</em>}</span><h2>{selected.isClosed ? "完了した記録" : "過去の記録"}</h2></div><button onClick={() => onOpenDay(selected)}>この日を開く</button></div>
        {!selected.tasks.length && !selected.entries.length && !selected.notes.length && !selected.review.good && !selected.review.bad && !selected.review.carryOver && !selected.aiSummary ? <p className="empty">この日の記録はありません。</p> : <div className="preview-content">
          {selected.tasks.length > 0 && <div><h3>タスク</h3>{selected.tasks.map((t) => <p key={t.id}>{t.isCompleted ? "✓" : "○"} {t.title}</p>)}</div>}
          {selected.entries.map((e) => <div className="preview-entry" key={e.id}><time>{new Date(e.occurredAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</time><span>{e.body}</span></div>)}
          {selected.notes.length > 0 && <div className="preview-note"><h3>この日のメモ</h3>{selected.notes.map((note) => <article className="history-note-card" key={note.id}><h4>{note.title.trim() || "無題のメモ"}</h4><div className="markdown"><MarkdownRenderer markdown={note.markdown || "_本文はありません。_"} interactive/></div></article>)}</div>}
          {(selected.review.good || selected.review.bad || selected.review.carryOver) && <div><h3>振り返り</h3>{selected.review.good && <p><strong>よかったこと：</strong>{selected.review.good}</p>}{selected.review.bad && <p><strong>うまくいかなかったこと：</strong>{selected.review.bad}</p>}{selected.review.carryOver && <p><strong>持ち越すこと：</strong>{selected.review.carryOver}</p>}</div>}
          {selected.aiSummary && <div className="ai-summary compact-summary"><h3>AIまとめ</h3><p>{selected.aiSummary.summary}</p></div>}
        </div>}</> : <p className="empty">カレンダーから日付を選んでください。</p>}</section>
    </div>
  </div></main>;
}
