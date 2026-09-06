import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Entry } from "../types";
import { TimeFields, timePartIsValid } from "./TimeFields";

const TYPES = ["仕事", "気づき", "出来事", "体調", "アイデア"];
const pad = (value: number) => String(value).padStart(2, "0");
const toLocalParts = (value: string, fallbackDate: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: fallbackDate, hour: "", minute: "" };
  return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, hour: pad(date.getHours()), minute: pad(date.getMinutes()) };
};
const toRfc3339 = (date: string, hour: string, minute: string) => {
  const localValue = `${date}T${pad(Number(hour))}:${pad(Number(minute))}`;
  const offset = -new Date(localValue).getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  return `${localValue}:00${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
};
const formatEntryDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short" }).format(new Date(year, month - 1, day, 12));
};

interface Props {
  entries: Entry[]; dayDate: string; disabled: boolean;
  onAdd: (body: string, type: string) => Promise<void>;
  onUpdate: (entry: Entry, targetDate: string) => Promise<Entry>;
  onType: (entry: Entry, type: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onError: (message: string) => void;
}

export function TimelineSection({ entries, dayDate, disabled, onAdd, onUpdate, onType, onDelete, onError }: Props) {
  const [draft, setDraft] = useState("");
  const [type, setType] = useState("memo");
  const [editing, setEditing] = useState<Entry | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editDate, setEditDate] = useState(dayDate);
  const [editHour, setEditHour] = useState("");
  const [editMinute, setEditMinute] = useState("");
  const [showDate, setShowDate] = useState(false);
  const [editError, setEditError] = useState("");
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => dialog.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) { event.preventDefault(); closeEditor(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [editing?.id, saving]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || disabled) return;
    try {
      await onAdd(body, type);
      setDraft((current) => current.trim() === body ? "" : current);
    } catch { /* The parent reports the error; keep the draft for retry. */ }
  };
  const openEditor = (entry: Entry, element: HTMLElement) => {
    const occurred = toLocalParts(entry.occurredAt, dayDate);
    opener.current = element; setEditing(entry); setEditBody(entry.title ? `${entry.title}\n${entry.body}` : entry.body);
    setEditDate(occurred.date); setEditHour(occurred.hour); setEditMinute(occurred.minute);
    setShowDate(occurred.date !== dayDate); setEditError("");
  };
  const closeEditor = () => { setEditing(null); setEditError(""); window.setTimeout(() => opener.current?.focus()); };
  const saveEditor = async () => {
    if (!editing || saving) return;
    const body = editBody.trim();
    if (!body) { setEditError("内容を入力してください"); return; }
    const hasHour = editHour.trim() !== "";
    const hasMinute = editMinute.trim() !== "";
    if (hasHour !== hasMinute) { setEditError("記録時刻の時と分を両方入力してください"); return; }
    if (!timePartIsValid(editHour, 23) || !timePartIsValid(editMinute, 59)) {
      setEditError("記録時刻は00:00〜23:59の範囲で入力してください"); return;
    }
    setSaving(true); setEditError("");
    try {
      await onUpdate({ ...editing, title: null, body, occurredAt: toRfc3339(editDate, editHour, editMinute) }, editDate);
      closeEditor();
    } catch (error) { setEditError("保存できませんでした"); onError(String(error)); }
    finally { setSaving(false); }
  };
  const now = new Date();
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return <section className="card timeline-section">
    <div className="section-heading"><h2>今日の記録</h2><span>{entries.length} 件</span></div>
    <div className="timeline">
      {entries.map((entry) => {
        const text = entry.title ? `${entry.title}\n${entry.body}` : entry.body;
        const editLabel = text.replace(/\s+/g, " ").slice(0, 30);
        return <div className="timeline-row" key={entry.id}>
          <time>{new Date(entry.occurredAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</time>
          <div className="timeline-content"><div><p>{text}</p><button disabled={disabled} className="tag" onClick={() => void onType(entry, TYPES[(TYPES.indexOf(entry.entryType) + 1) % TYPES.length])}>{entry.entryType === "memo" ? "＋ タグ" : entry.entryType}</button>{!disabled && <button className="entry-edit task-edit subtle-action" aria-label={`記録「${editLabel}」を編集`} onClick={(event) => openEditor(entry, event.currentTarget)}>✎</button>}{!disabled && <button className="delete subtle-action" aria-label={`記録「${editLabel}」を削除`} onClick={() => void onDelete(entry.id)}>×</button>}</div></div>
        </div>;
      })}
      {!entries.length && <p className="empty">何かあったら、その都度ここに書き足していく。時刻は自動で記録されます。</p>}
    </div>
    <div className="quick-entry"><time>{time}</time><textarea rows={1} disabled={disabled} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); void submit(); } }} placeholder="今あったことを書く…"/><kbd>Ctrl+Enter</kbd></div>
    <div className="type-chips">{TYPES.map((item) => <button key={item} disabled={disabled} className={type === item ? "active" : ""} onClick={() => setType(type === item ? "memo" : item)}>{item}</button>)}</div>
    {editing && createPortal(<div className="entry-editor-backdrop"><div ref={dialog} className="entry-editor" role="dialog" aria-modal="true" aria-labelledby="entry-editor-title">
      <header><div><span>JOURNAL</span><h2 id="entry-editor-title">記録を編集</h2></div><button className="editor-close" aria-label="記録編集を閉じる" disabled={saving} onClick={closeEditor}>×</button></header>
      <label><span>内容</span><textarea rows={6} aria-label="記録内容" value={editBody} disabled={saving} onChange={(event) => { setEditBody(event.target.value); setEditError(""); }} onKeyDown={(event) => { if (event.key === "Enter" && event.ctrlKey) { event.preventDefault(); void saveEditor(); } }}/></label>
      <div className="task-deadline-field">
        <div className="task-deadline-heading"><span>記録日時</span><button type="button" disabled={saving} onClick={() => setShowDate((current) => !current)}>{showDate ? "日付を閉じる" : "日付を変更"}</button></div>
        <p>{formatEntryDate(editDate)}の記録</p>
        {showDate && <label className="task-due-date"><span>記録日</span><input type="date" aria-label="記録日" value={editDate} disabled={saving} onChange={(event) => { setEditDate(event.target.value || dayDate); setEditError(""); }}/></label>}
        <TimeFields ariaLabel="記録時刻" labelPrefix="記録" hour={editHour} minute={editMinute} disabled={saving} onHourChange={(value) => { setEditHour(value); setEditError(""); }} onMinuteChange={(value) => { setEditMinute(value); setEditError(""); }}/>
      </div>
      {editError && <p className="error-text" role="alert">{editError}</p>}
      <footer><button disabled={saving} onClick={closeEditor}>キャンセル</button><button className="primary-button" disabled={saving} onClick={() => void saveEditor()}>{saving ? "保存中…" : "保存"}</button></footer>
    </div></div>, document.querySelector(".app-shell") ?? document.body)}
  </section>;
}
