import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Tag } from "../types";
import { TagChip, tagColorStyle } from "./TagChip";

interface Props { available: Tag[]; selected: Tag[]; disabled?: boolean; pending?: boolean; onChange: (ids: number[]) => void; }
export function TagPicker({ available, selected, disabled, pending, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const countTrigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const ids = new Set(selected.map((tag) => tag.id));
  const candidates = available.filter((tag) => !ids.has(tag.id) && tag.name.toLocaleLowerCase("ja-JP").includes(query.trim().toLocaleLowerCase("ja-JP")));

  const place = () => {
    const rect = (trigger.current ?? countTrigger.current)?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(320, window.innerWidth - 16);
    const desiredHeight = Math.min(280, popup.current?.scrollHeight || 280);
    const below = window.innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    const useBelow = below >= desiredHeight || below >= above;
    const height = Math.max(40, Math.min(desiredHeight, useBelow ? below : above));
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: useBelow ? rect.bottom + 6 : rect.top - height - 6, width, maxHeight: height });
  };
  const close = (restoreFocus = false) => { setOpen(false); setQuery(""); if (restoreFocus) window.setTimeout(() => trigger.current?.focus()); };
  useEffect(() => {
    if (!open) return;
    place();
    window.setTimeout(() => search.current?.focus());
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(true); } };
    const reposition = () => place();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape, true); window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, [open]);
  useEffect(() => { if (disabled && open) close(); }, [disabled, open]);
  useEffect(() => { if (open) place(); }, [open, selected.length, candidates.length]);

  return <div className="tag-picker" ref={root}><span className="tag-picker-label">タグ</span>
    <span className="tag-picker-summary" aria-label="付与済みタグ">{selected.length ? selected.slice(0, 2).map((tag) => <TagChip key={tag.id} tag={tag}/>) : <span className="tag-picker-none">未設定</span>}{selected.length > 2 && (disabled ? <span className="tag-picker-count">＋{selected.length - 2}</span> : <button type="button" ref={countTrigger} className="tag-picker-count" aria-label={`残り${selected.length - 2}件のタグを見る`} onClick={() => { place(); setOpen(true); }}>＋{selected.length - 2}</button>)}</span>
    {!disabled && available.length > 0 && <button type="button" ref={trigger} className="tag-picker-trigger" aria-expanded={open} aria-controls="tag-picker-popover" disabled={pending} onClick={() => { if (open) close(); else { place(); setOpen(true); } }}>＋ タグ</button>}
    {open && !disabled && <div id="tag-picker-popover" ref={popup} className="tag-picker-popover" role="group" aria-label="タグを設定" style={position}>
      <div className="tag-picker-popover-header"><strong>タグを設定</strong><button type="button" aria-label="タグ設定を閉じる" onClick={() => close(true)}>×</button></div>
      {selected.length > 0 && <div className="tag-picker-selected" aria-label="付与済みタグ">{selected.map((tag) => <button type="button" key={tag.id} className="tag-chip tag-remove-chip" style={tagColorStyle(tag.color)} aria-label={`${tag.name}を外す`} disabled={pending} onClick={() => onChange(selected.filter((item) => item.id !== tag.id).map((item) => item.id))}><svg aria-hidden="true" viewBox="0 0 12 12" fill="none"><path d="M2.5 2.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>{tag.name}</button>)}</div>}
      <input ref={search} className="tag-picker-search" aria-label="タグを探す" value={query} disabled={pending} placeholder="タグ名で探す" onChange={(event) => setQuery(event.target.value)}/>
      <div className="tag-picker-options" role="group" aria-label="タグの候補">{candidates.map((tag) => <button type="button" key={tag.id} aria-label={`${tag.name}を追加`} disabled={pending} onClick={() => { onChange([...selected.map((item) => item.id), tag.id]); setQuery(""); }}><TagChip tag={tag}/></button>)}{!candidates.length && <p className="tag-picker-empty">{query.trim() ? "一致するタグはありません。" : "追加できるタグはありません。"}</p>}</div>
    </div>}
  </div>;
}
