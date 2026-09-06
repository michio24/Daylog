import { useState } from "react";
import type { Entry } from "../types";

const TYPES = ["仕事", "気づき", "出来事", "体調", "アイデア"];
interface Props { entries: Entry[]; disabled: boolean; onAdd: (body: string, type: string) => Promise<void>; onType: (entry: Entry, type: string) => Promise<void>; onDelete: (id: number) => Promise<void>; }

export function TimelineSection({ entries, disabled, onAdd, onType, onDelete }: Props) {
  const [draft, setDraft] = useState("");
  const [type, setType] = useState("memo");
  const submit = async () => {
    const body = draft.trim();
    if (!body || disabled) return;
    try {
      await onAdd(body, type);
      setDraft((current) => current.trim() === body ? "" : current);
    } catch { /* The parent reports the error; keep the draft for retry. */ }
  };
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return <section className="card timeline-section">
    <div className="section-heading"><h2>今日の記録</h2><span>{entries.length} 件</span></div>
    <div className="timeline">
      {entries.map((entry) => {
        const text = entry.title ? `${entry.title}\n${entry.body}` : entry.body;
        return <div className="timeline-row" key={entry.id}>
          <time>{new Date(entry.occurredAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</time>
          <div className="timeline-content"><div><p>{text}</p><button disabled={disabled} className="tag" onClick={() => void onType(entry, TYPES[(TYPES.indexOf(entry.entryType) + 1) % TYPES.length])}>{entry.entryType === "memo" ? "＋ タグ" : entry.entryType}</button>{!disabled && <button className="delete subtle-action" onClick={() => void onDelete(entry.id)}>×</button>}</div></div>
        </div>;
      })}
      {!entries.length && <p className="empty">何かあったら、その都度ここに書き足していく。時刻は自動で記録されます。</p>}
    </div>
    <div className="quick-entry"><time>{time}</time><textarea rows={1} disabled={disabled} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); void submit(); } }} placeholder="今あったことを書く…"/><kbd>Ctrl+Enter</kbd></div>
    <div className="type-chips">{TYPES.map((item) => <button key={item} disabled={disabled} className={type === item ? "active" : ""} onClick={() => setType(type === item ? "memo" : item)}>{item}</button>)}</div>
  </section>;
}
