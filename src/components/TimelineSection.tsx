import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Entry, Tag } from "../types";
import { EntryIcon, parseEntryIcon } from "./EntryIcon";
import { EntryIconPicker } from "./EntryIconPicker";
import { TagChip } from "./TagChip";
import { TagPicker } from "./TagPicker";
import { TimeFields, timePartIsValid } from "./TimeFields";

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
  entries: Entry[]; availableTags: Tag[]; dayDate: string; disabled: boolean;
  onAdd: (body: string, icon: string) => Promise<void>;
  onUpdate: (entry: Entry, targetDate: string) => Promise<Entry>;
  onIcon: (entry: Entry, icon: string) => Promise<void>;
  onSetTags: (id: number, ids: number[]) => Promise<Tag[]>;
  onDelete: (id: number) => Promise<void>;
  onError: (message: string) => void;
}

export function TimelineSection({ entries, availableTags, dayDate, disabled, onAdd, onUpdate, onIcon, onSetTags, onDelete, onError }: Props) {
  const [draft, setDraft] = useState("");
  const [icon, setIcon] = useState("");
  const [iconTarget, setIconTarget] = useState<Entry | "draft" | null>(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [editing, setEditing] = useState<Entry | null>(null);
  const [editTags, setEditTags] = useState<Tag[]>([]);
  const [tagPending, setTagPending] = useState(false);
  const [editBody, setEditBody] = useState("");
  const [editDate, setEditDate] = useState(dayDate);
  const [editHour, setEditHour] = useState("");
  const [editMinute, setEditMinute] = useState("");
  const [showDate, setShowDate] = useState(false);
  const [editError, setEditError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const draftInput = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let timer: number;
    const syncClock = () => {
      const current = Date.now();
      setCurrentTime(current);
      window.clearTimeout(timer);
      timer = window.setTimeout(syncClock, 60_000 - current % 60_000);
    };
    const onVisibilityChange = () => { if (!document.hidden) syncClock(); };
    syncClock();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!editing) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => dialog.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving && !tagPending) { event.preventDefault(); closeEditor(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [editing?.id, saving, tagPending]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || disabled) return;
    try {
      await onAdd(body, icon);
      setDraft((current) => current.trim() === body ? "" : current);
    } catch { /* The parent reports the error; keep the draft for retry. */ }
  };
  const openEditor = (entry: Entry, element: HTMLElement) => {
    const occurred = toLocalParts(entry.occurredAt, dayDate);
    opener.current = element; setEditing(entry); setEditTags(entry.tags ?? []); setEditBody(entry.title ? `${entry.title}\n${entry.body}` : entry.body);
    setEditDate(occurred.date); setEditHour(occurred.hour); setEditMinute(occurred.minute);
    setShowDate(occurred.date !== dayDate); setEditError("");
  };
  const closeEditor = () => { setEditing(null); setEditError(""); window.setTimeout(() => (opener.current?.isConnected ? opener.current : draftInput.current)?.focus()); };
  const deleteEditing = async () => {
    if (!editing || saving || tagPending || disabled) return;
    setSaving(true); setDeleting(true); setEditError("");
    try { await onDelete(editing.id); closeEditor(); }
    catch (error) { setEditError("削除できませんでした。もう一度お試しください。"); onError(String(error)); }
    finally { setSaving(false); setDeleting(false); }
  };
  const saveEditor = async () => {
    if (!editing || saving || tagPending) return;
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
  const changeTags = async (ids: number[]) => {
    if (!editing || tagPending || disabled) return;
    setTagPending(true); setEditError("");
    try { setEditTags(await onSetTags(editing.id, ids)); }
    catch (error) { setEditError("タグを保存できませんでした"); onError(String(error)); }
    finally { setTagPending(false); }
  };
  const now = new Date(currentTime);
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return <section className="card timeline-section">
    <div className="section-heading"><h2>今日の記録</h2><span>{entries.length} 件</span></div>
    <div className="timeline">
      {entries.map((entry) => {
        const text = entry.title ? `${entry.title}\n${entry.body}` : entry.body;
        const editLabel = text.replace(/\s+/g, " ").slice(0, 30);
        return <div className="timeline-row" key={entry.id}>
          <time>{new Date(entry.occurredAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</time>
          <div className="timeline-content"><div><button disabled={disabled} className={`entry-icon ${entry.icon ? "has-icon" : ""}`} aria-label={entry.icon ? `${parseEntryIcon(entry.icon).label}アイコンを変更` : "アイコンを付ける"} title="クリックでアイコンを変更" aria-haspopup="dialog" onClick={() => setIconTarget(entry)}>{entry.icon ? <EntryIcon icon={entry.icon}/> : <span aria-hidden="true">＋</span>}</button><div className="timeline-entry-main"><p>{text}</p>{(entry.tags?.length ?? 0) > 0 && <span className="item-tags">{entry.tags?.map((tag) => <TagChip key={tag.id} tag={tag}/>)}</span>}</div>{!disabled && <button className="entry-edit task-edit subtle-action" aria-label={`記録「${editLabel}」を編集`} onClick={(event) => openEditor(entry, event.currentTarget)}>✎</button>}</div></div>
        </div>;
      })}
      {!entries.length && <p className="empty">何かあったら、その都度ここに書き足していく。時刻は自動で記録されます。</p>}
    </div>
    <div className="quick-entry"><time>{time}</time><textarea ref={draftInput} rows={1} disabled={disabled} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); void submit(); } }} placeholder="今あったことを書く…"/><kbd>Ctrl+Enter</kbd></div>
    <div className="entry-icon-toolbar"><button type="button" className={`entry-icon ${icon ? "has-icon" : ""}`} disabled={disabled} aria-label="記録のアイコンと色を選択" title="クリックでアイコンを選択" aria-haspopup="dialog" onClick={() => setIconTarget("draft")}>{icon ? <EntryIcon icon={icon}/> : <span aria-hidden="true">＋</span>}</button></div>
    {iconTarget !== null && <EntryIconPicker key={iconTarget === "draft" ? "draft" : iconTarget.id} value={iconTarget === "draft" ? icon : iconTarget.icon} onClose={() => setIconTarget(null)} onSelect={async (value) => { if (iconTarget === "draft") setIcon(value); else await onIcon(iconTarget, value); }}/>}
    {editing && createPortal(<div className="entry-editor-backdrop"><div ref={dialog} className="entry-editor" role="dialog" aria-modal="true" aria-labelledby="entry-editor-title">
      <header><div><span>JOURNAL</span><h2 id="entry-editor-title">記録を編集</h2></div><button className="editor-close" aria-label="記録編集を閉じる" disabled={saving || tagPending} onClick={closeEditor}>×</button></header>
      <label><span>内容</span><textarea rows={6} aria-label="記録内容" value={editBody} disabled={saving} onChange={(event) => { setEditBody(event.target.value); setEditError(""); }} onKeyDown={(event) => { if (event.key === "Enter" && event.ctrlKey) { event.preventDefault(); void saveEditor(); } }}/></label>
      <TagPicker available={availableTags} selected={editTags} disabled={disabled} pending={tagPending || saving} onChange={(ids) => void changeTags(ids)}/>
      <div className="task-deadline-field">
        <div className="task-deadline-heading"><span>記録日時</span><button type="button" disabled={saving} onClick={() => setShowDate((current) => !current)}>{showDate ? "日付を閉じる" : "日付を変更"}</button></div>
        <p>{formatEntryDate(editDate)}の記録</p>
        {showDate && <label className="task-due-date"><span>記録日</span><input type="date" aria-label="記録日" value={editDate} disabled={saving} onChange={(event) => { setEditDate(event.target.value || dayDate); setEditError(""); }}/></label>}
        <TimeFields ariaLabel="記録時刻" labelPrefix="記録" hour={editHour} minute={editMinute} disabled={saving} onHourChange={(value) => { setEditHour(value); setEditError(""); }} onMinuteChange={(value) => { setEditMinute(value); setEditError(""); }}/>
      </div>
      {editError && <p className="error-text" role="alert">{editError}</p>}
      <footer><button type="button" className="danger-button" disabled={saving || tagPending || disabled} onClick={() => void deleteEditing()}>{deleting ? "削除中…" : "この項目を削除"}</button><button disabled={saving || tagPending} onClick={closeEditor}>キャンセル</button><button className="primary-button" disabled={saving || tagPending} onClick={() => void saveEditor()}>{saving && !deleting ? "保存中…" : "保存"}</button></footer>
    </div></div>, document.querySelector(".app-shell") ?? document.body)}
  </section>;
}
