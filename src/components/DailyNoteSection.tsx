import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { createPortal } from "react-dom";
import type { Attachment, NoteCard, SaveStatus } from "../types";
import { api } from "../services/api";
import { toggleMarkdownTask } from "../utils/markdown";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { applyMarkdownEdit, MarkdownToolbar } from "./MarkdownToolbar";

interface Props {
  notes: NoteCard[]; disabled: boolean;
  onCardsChange: (notes: NoteCard[]) => void;
  onCreate: () => Promise<NoteCard>; onSave: (card: NoteCard) => Promise<NoteCard>;
  onDelete: (id: number) => Promise<void>; onReorder: (orderedIds: number[]) => Promise<NoteCard[]>;
  onError: (message: string) => void;
}
export interface DailyNoteSectionHandle { flush: () => Promise<void>; }

const statusText = (status: SaveStatus) => status === "saving" ? "保存中…" : status === "error" ? "保存できませんでした" : "保存済み";

export const DailyNoteSection = forwardRef<DailyNoteSectionHandle, Props>(function DailyNoteSection({ notes, disabled, onCardsChange, onCreate, onSave, onDelete, onReorder, onError }, ref) {
  const [draft, setDraft] = useState<NoteCard | null>(null);
  const [mode, setMode] = useState<"edit" | "view">("edit");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [dragPreview, setDragPreview] = useState<{ note: NoteCard; left: number; top: number; width: number; height: number; root: Element } | null>(null);
  const pointerStartRef = useRef<{ id: number; pointerId: number; x: number; y: number; rect: DOMRect; root: Element } | null>(null);
  const suppressClickRef = useRef(false);
  const draggedIdRef = useRef<number | null>(null);
  const dropTargetIdRef = useRef<number | null>(null);
  const draftRef = useRef<NoteCard | null>(null);
  const dirtyRef = useRef(false);
  const revisionRef = useRef(0);
  const pendingRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<number>();
  const dialogRef = useRef<HTMLDivElement>(null);
  const markdownInputRef = useRef<HTMLTextAreaElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const persistDraft = async () => {
    window.clearTimeout(timerRef.current);
    if (pendingRef.current) {
      await pendingRef.current;
      if (dirtyRef.current) await persistDraft();
      return;
    }
    if (!dirtyRef.current || !draftRef.current) return;
    const value = draftRef.current;
    const revision = revisionRef.current;
    dirtyRef.current = false;
    setSaveStatus("saving");
    const work = (async () => {
      const saved = await onSave(value);
      if (revisionRef.current === revision) {
        setSaveStatus("saved"); setDraft(saved); draftRef.current = saved;
      }
    })();
    pendingRef.current = work;
    try { await work; }
    catch (error) { dirtyRef.current = true; setSaveStatus("error"); throw error; }
    finally { pendingRef.current = null; }
  };

  useImperativeHandle(ref, () => ({ flush: persistDraft }));
  useEffect(() => () => { window.clearTimeout(timerRef.current); void persistDraft().catch(() => undefined); }, []);

  const closeEditor = async () => {
    try {
      await persistDraft();
      setDraft(null);
      window.setTimeout(() => openerRef.current?.focus());
    } catch (error) { onError(String(error)); }
  };

  useEffect(() => {
    if (!draft) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>(disabled ? "button" : "input")?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); void closeEditor(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [draft?.id, disabled]);

  const openEditor = (card: NoteCard) => {
    openerRef.current = document.activeElement as HTMLElement;
    draftRef.current = card; dirtyRef.current = false;
    setDraft(card); setMode(disabled ? "view" : "edit"); setSaveStatus("saved");
  };
  const changeDraft = (change: Partial<NoteCard>) => {
    if (!draftRef.current) return;
    const next = { ...draftRef.current, ...change };
    draftRef.current = next; dirtyRef.current = true; revisionRef.current += 1; setDraft(next); setSaveStatus("saving");
    onCardsChange(notes.map((note) => note.id === next.id ? next : note));
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void persistDraft().catch((error) => onError(String(error))), 700);
  };
  const toggleTask = (lineNumber: number, checked: boolean) => {
    if (!draftRef.current || disabled) return;
    changeDraft({ markdown: toggleMarkdownTask(draftRef.current.markdown, lineNumber, checked) });
  };
  const toggleCardTask = async (card: NoteCard, lineNumber: number, checked: boolean) => {
    if (disabled) return;
    const updated = { ...card, markdown: toggleMarkdownTask(card.markdown, lineNumber, checked) };
    const previous = notes;
    onCardsChange(notes.map((note) => note.id === card.id ? updated : note));
    try { await onSave(updated); }
    catch (error) { onCardsChange(previous); onError(String(error)); }
  };
  const currentMarkdownSelection = () => {
    const textarea = markdownInputRef.current;
    return textarea ? { start: textarea.selectionStart, end: textarea.selectionEnd } : null;
  };
  const insertAttachments = (attachments: Attachment[], selection = currentMarkdownSelection()) => {
    if (!draftRef.current || !markdownInputRef.current || !attachments.length) return;
    const start = selection?.start ?? draftRef.current.markdown.length;
    const end = selection?.end ?? start;
    const inserted = attachments.map((attachment) => attachment.isImage
      ? `![${attachment.name}](daylog-attachment:${attachment.id})`
      : `[📎 ${attachment.name}](daylog-attachment:${attachment.id})`).join("\n");
    const before = draftRef.current.markdown.slice(0, start);
    const after = draftRef.current.markdown.slice(end);
    const prefix = before && !before.endsWith("\n") ? "\n" : "";
    const suffix = after && !after.startsWith("\n") ? "\n" : "";
    const next = before + prefix + inserted + suffix + after;
    changeDraft({ markdown: next });
    const cursor = (before + prefix + inserted).length;
    requestAnimationFrame(() => { markdownInputRef.current?.focus(); markdownInputRef.current?.setSelectionRange(cursor, cursor); });
  };
  const importFiles = async (files: File[], selection = currentMarkdownSelection()) => {
    try {
      const attachments = await Promise.all(files.map(async (file) => api.importAttachmentBytes(file.name, file.type, [...new Uint8Array(await file.arrayBuffer())])));
      insertAttachments(attachments, selection);
    } catch (error) { onError(String(error)); }
  };
  const pickFiles = async (imageOnly: boolean) => {
    const selection = currentMarkdownSelection();
    try {
      const selected = await open({ multiple: true, directory: false, filters: imageOnly ? [{ name: "画像", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }] : undefined });
      const paths = typeof selected === "string" ? [selected] : selected || [];
      insertAttachments(await Promise.all(paths.map(api.importAttachmentFromPath)), selection);
    } catch (error) { onError(String(error)); }
  };
  const editShortcut = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const edit = key === "b" ? { before: "**", after: "**", placeholder: "太字" } : key === "i" ? { before: "_", after: "_", placeholder: "斜体" } : key === "k" ? { before: "[", after: "](https://)", placeholder: "リンク" } : null;
    if (!edit || !draftRef.current) return;
    event.preventDefault();
    const textarea = event.currentTarget;
    const result = applyMarkdownEdit(textarea, draftRef.current.markdown, edit);
    changeDraft({ markdown: result.value });
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(result.start, result.end);
    });
  };
  const pasteFiles = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files];
    if (!files.length) return;
    event.preventDefault(); void importFiles(files);
  };
  const dropFiles = (event: ReactDragEvent<HTMLTextAreaElement>) => {
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    event.preventDefault(); void importFiles(files);
  };
  const addCard = async () => {
    try { openEditor(await onCreate()); } catch (error) { onError(String(error)); }
  };
  const removeCard = async () => {
    if (!draft || !window.confirm("このメモを削除しますか？")) return;
    try {
      window.clearTimeout(timerRef.current); dirtyRef.current = false;
      await onDelete(draft.id); setDraft(null); window.setTimeout(() => openerRef.current?.focus());
    } catch (error) { onError(String(error)); }
  };
  const move = async (from: number, to: number) => {
    if (disabled || from === to || to < 0 || to >= notes.length) return;
    const previous = notes;
    const next = [...notes]; const [card] = next.splice(from, 1); next.splice(to, 0, card);
    const optimistic = next.map((note, index) => ({ ...note, sortOrder: index }));
    onCardsChange(optimistic);
    try { await onReorder(optimistic.map((note) => note.id)); }
    catch (error) { onCardsChange(previous); onError(String(error)); }
  };
  const startPointerDrag = (event: ReactPointerEvent<HTMLElement>, id: number) => {
    if (disabled || event.button !== 0 || pointerStartRef.current) return;
    suppressClickRef.current = false;
    const rect = event.currentTarget.closest(".note-card")!.getBoundingClientRect();
    const root = event.currentTarget.closest(".app-shell") ?? document.body;
    pointerStartRef.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect, root };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const trackPointerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const start = pointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (draggedIdRef.current === null) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
      draggedIdRef.current = start.id;
      suppressClickRef.current = true;
      setDraggedId(start.id);
    }
    const note = notes.find((card) => card.id === start.id);
    if (note) setDragPreview({ note, left: start.rect.left + event.clientX - start.x, top: start.rect.top + event.clientY - start.y, width: start.rect.width, height: start.rect.height, root: start.root });
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-note-id]");
    const id = target && event.currentTarget.closest(".note-card-grid")?.contains(target) ? Number(target.dataset.noteId) : null;
    const validId = id !== null && notes.some((note) => note.id === id) ? id : null;
    dropTargetIdRef.current = validId; setDropTargetId(validId);
  };
  const cancelPointerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (pointerStartRef.current?.pointerId !== event.pointerId) return;
    pointerStartRef.current = null;
    draggedIdRef.current = null; dropTargetIdRef.current = null;
    setDraggedId(null); setDropTargetId(null); setDragPreview(null);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const finishPointerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (pointerStartRef.current?.pointerId !== event.pointerId) return;
    if (draggedIdRef.current !== null) trackPointerDrag(event);
    const from = notes.findIndex((note) => note.id === draggedIdRef.current);
    const to = notes.findIndex((note) => note.id === dropTargetIdRef.current);
    cancelPointerDrag(event);
    if (from >= 0 && to >= 0) void move(from, to);
  };

  return <section className="card note-section" id="daily-note">
    <div className="section-heading"><h2>今日のメモ</h2><button className="note-add" disabled={disabled} onClick={() => void addCard()}>＋ メモを追加</button></div>
    {!notes.length ? <p className="empty">メモはまだありません。</p> : <div className="note-card-grid">
      {notes.map((note) => <article key={note.id} data-note-id={note.id} className={`note-card${draggedId === note.id ? " dragging" : ""}${draggedId !== null && dropTargetId === note.id ? " drop-target" : ""}`}>
        <button className="note-card-open" aria-label={`「${note.title.trim() || "無題のメモ"}」を編集`} onPointerDown={(event) => startPointerDrag(event, note.id)} onPointerMove={trackPointerDrag} onPointerUp={finishPointerDrag} onPointerCancel={cancelPointerDrag} onLostPointerCapture={cancelPointerDrag} onDragStart={(event) => event.preventDefault()} onClick={(event) => {
          if (suppressClickRef.current && event.detail !== 0) { event.preventDefault(); return; }
          openEditor(note);
        }}/><div className="note-card-content"><strong>{note.title.trim() || "無題のメモ"}</strong><div className="markdown note-card-preview"><MarkdownRenderer compact markdown={note.markdown || "_本文はまだありません。_"} checkboxDisabled={disabled} onTaskToggle={(lineNumber, checked) => void toggleCardTask(note, lineNumber, checked)} onError={onError}/></div></div>
      </article>)}
    </div>}
    {dragPreview && createPortal(<div className="note-card note-card-drag-preview" aria-hidden="true" style={{ left: dragPreview.left, top: dragPreview.top, width: dragPreview.width, height: dragPreview.height }}>
      <div className="note-card-content"><strong>{dragPreview.note.title.trim() || "無題のメモ"}</strong><div className="markdown note-card-preview"><MarkdownRenderer compact markdown={dragPreview.note.markdown || "_本文はまだありません。_"}/></div></div>
    </div>, dragPreview.root)}
    {draft && createPortal(<div className="note-editor-backdrop"><div ref={dialogRef} className="note-editor" role="dialog" aria-modal="true" aria-labelledby="note-editor-title">
      <header><div><span>MARKDOWN NOTE</span><h2 id="note-editor-title">{disabled ? "メモを表示" : "メモを編集"}</h2></div><button className="editor-close" aria-label="編集画面を閉じる" onClick={() => void closeEditor()}>×</button></header>
      <div className="note-editor-toolbar"><div className="segmented"><button className={mode === "edit" ? "active" : ""} disabled={disabled} onClick={() => setMode("edit")}>編集</button><button className={mode === "view" ? "active" : ""} onClick={() => setMode("view")}>表示</button></div><span className={`save-state ${saveStatus}`}>{statusText(saveStatus)}</span></div>
      {mode === "edit" ? <input className="note-title-input" disabled={disabled} aria-label="メモのタイトル" placeholder="タイトル" value={draft.title} onChange={(event) => changeDraft({ title: event.target.value })}/> : <h3 className="note-editor-view-title">{draft.title.trim() || "無題のメモ"}</h3>}
      {mode === "edit" ? <div className="note-edit-body"><MarkdownToolbar textarea={markdownInputRef} value={draft.markdown} disabled={disabled} onChange={(markdown) => changeDraft({ markdown })} onPickFiles={(imageOnly) => void pickFiles(imageOnly)}/><textarea ref={markdownInputRef} className="note-markdown-input" disabled={disabled} aria-label="Markdown本文" value={draft.markdown} onChange={(event) => changeDraft({ markdown: event.target.value })} onKeyDown={editShortcut} onPaste={pasteFiles} onDragOver={(event) => event.preventDefault()} onDrop={dropFiles} placeholder="# 今日考えたこと\n\n- Markdownで自由に"/></div> : <div className="markdown note-editor-preview"><MarkdownRenderer markdown={draft.markdown || "_本文はまだありません。_"} interactive checkboxDisabled={disabled} onTaskToggle={toggleTask} onError={onError}/></div>}
      <footer>{!disabled && <button className="danger-button" onClick={() => void removeCard()}>メモを削除</button>}<button className="primary-button" onClick={() => void closeEditor()}>閉じる</button></footer>
    </div></div>, document.querySelector(".app-shell") ?? document.body)}
  </section>;
});
