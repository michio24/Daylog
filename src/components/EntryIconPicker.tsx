import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ENTRY_COLORS, ENTRY_ICONS, EntryIcon, entryColorStyle, parseEntryIcon } from "./EntryIcon";

const HISTORY_KEY = "daylog.entry-icon-history.v1";
let recentFallback: string[] = [];
function readRecent(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(value) ? [...new Set(value.filter((item): item is string => {
      if (typeof item !== "string") return false;
      const parsed = parseEntryIcon(item);
      return Boolean(parsed.name && parsed.palette && item === `${parsed.name}:${parsed.color}`);
    }))].slice(0, 8) : [];
  } catch { return recentFallback; }
}
function remember(value: string) {
  if (!value) return;
  recentFallback = [value, ...readRecent().filter((item) => item !== value)].slice(0, 8);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(recentFallback)); } catch { /* Keep session history when storage is unavailable. */ }
}

interface Props { value: string; onSelect: (value: string) => Promise<void>; onClose: () => void; }

export function EntryIconPicker({ value, onSelect, onClose }: Props) {
  const initial = parseEntryIcon(value);
  const [name, setName] = useState<string>(initial.name || "message");
  const [color, setColor] = useState<string>(initial.color);
  const [recent] = useState(readRecent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const selection = `${name}:${color}`;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const shell = document.querySelector<HTMLElement>(".app-shell");
    const overflow = shell?.style.overflow;
    if (shell) shell.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (shell) shell.style.overflow = overflow ?? ""; opener?.focus(); };
  }, []);
  const apply = async (next: string) => {
    if (busy.current) return;
    busy.current = true; setSaving(true); setError("");
    try { await onSelect(next); remember(next); onClose(); }
    catch { setError("保存できませんでした。もう一度お試しください。"); }
    finally { busy.current = false; setSaving(false); }
  };
  return createPortal(<div className="entry-icon-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy.current) onClose(); }}>
    <div ref={dialog} className="entry-icon-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={saving} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy.current) onClose(); }
      if (event.key === "Tab") {
        const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <header><div><span>今日の記録</span><h2 id={titleId}>アイコンと色</h2></div><button type="button" className="editor-close" aria-label="アイコン選択を閉じる" disabled={saving} onClick={onClose}>×</button></header>
      <section aria-label="最近使った組み合わせ"><h3>最近使った組み合わせ</h3>
        {recent.length ? <div className="entry-recent-grid">{recent.map((item) => {
          const parsed = parseEntryIcon(item);
          return <button type="button" key={item} disabled={saving} aria-label={`${parsed.label}・${parsed.palette?.label}`} aria-pressed={selection === item} title={`${parsed.label}・${parsed.palette?.label}`} onClick={() => { setName(parsed.name); setColor(parsed.color); }}><EntryIcon icon={item}/></button>;
        })}</div> : <p className="entry-history-empty">選んだアイコンと色がここに並びます</p>}
      </section>
      <section aria-label="アイコンの色"><h3>カラー <span>{ENTRY_COLORS.find((item) => item.value === color)?.label}</span></h3><div className="entry-color-grid">{ENTRY_COLORS.map((item) => <button type="button" key={item.value} disabled={saving} className="entry-color-choice" style={entryColorStyle(item.value)} aria-label={item.label} aria-pressed={color === item.value} title={item.label} onClick={() => setColor(item.value)}><span>{color === item.value ? "✓" : ""}</span></button>)}</div></section>
      <section aria-label="記録に合うアイコン"><h3>アイコン</h3><div className="entry-symbol-grid">{ENTRY_ICONS.map((item) => <button type="button" key={item.value} disabled={saving} aria-label={`${item.label}アイコン`} aria-pressed={name === item.value} title={item.label} onClick={() => setName(item.value)}><EntryIcon icon={`${item.value}:${color}`}/><span>{item.label}</span></button>)}</div></section>
      <div className="entry-icon-preview"><EntryIcon icon={selection}/><span>{parseEntryIcon(selection).label}<small>{ENTRY_COLORS.find((item) => item.value === color)?.label}</small></span><span className="entry-preview-caption">プレビュー</span></div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <footer><button type="button" className="entry-icon-remove" disabled={saving} onClick={() => void apply("")}>アイコンなし</button><button type="button" className="primary-button" disabled={saving} onClick={() => void apply(selection)}>{saving ? "保存中…" : "決定"}</button></footer>
    </div>
  </div>, document.querySelector(".app-shell") ?? document.body);
}
