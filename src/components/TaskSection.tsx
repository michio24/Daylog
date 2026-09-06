import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { Task } from "../types";

interface Props {
  tasks: Task[]; disabled: boolean; onTasksChange: (tasks: Task[]) => void;
  onAdd: (title: string) => Promise<void>; onToggle: (task: Task) => Promise<void>;
  onUpdate: (task: Task) => Promise<Task>; onDelete: (id: number) => Promise<void>;
  onReorder: (orderedIds: number[]) => Promise<Task[]>; onError: (message: string) => void;
}

const pad = (value: number) => String(value).padStart(2, "0");
const toLocalInput = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const toRfc3339 = (value: string) => {
  if (!value) return null;
  const date = new Date(value);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  return `${value}:00${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
};
const formatDueAt = (value: string) => new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

export function TaskSection({ tasks, disabled, onTasksChange, onAdd, onToggle, onUpdate, onDelete, onReorder, onError }: Props) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDueAt, setEditDueAt] = useState("");
  const [editError, setEditError] = useState("");
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pointerStart = useRef<{ id: number; pointerId: number; x: number; y: number } | null>(null);
  const draggedIdRef = useRef<number | null>(null);
  const dropTargetIdRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!editing) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => dialog.current?.querySelector<HTMLInputElement>("input")?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) { event.preventDefault(); closeEditor(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [editing?.id, saving]);

  const submit = async () => {
    const title = draft.trim();
    if (!title || disabled) return;
    try {
      await onAdd(title);
      setDraft((current) => current.trim() === title ? "" : current);
    } catch { /* The parent reports the error; keep the draft for retry. */ }
  };
  const openEditor = (task: Task, element: HTMLElement) => {
    opener.current = element; setEditing(task); setEditTitle(task.title); setEditDueAt(toLocalInput(task.dueAt)); setEditError("");
  };
  const closeEditor = () => { setEditing(null); setEditError(""); window.setTimeout(() => opener.current?.focus()); };
  const saveEditor = async () => {
    if (!editing || saving) return;
    const title = editTitle.trim();
    if (!title) { setEditError("タスク名を入力してください"); return; }
    setSaving(true); setEditError("");
    try { await onUpdate({ ...editing, title, dueAt: toRfc3339(editDueAt) }); closeEditor(); }
    catch (error) { setEditError("保存できませんでした"); onError(String(error)); }
    finally { setSaving(false); }
  };
  const move = async (from: number, to: number) => {
    if (disabled || from === to || to < 0 || to >= tasks.length) return;
    const previous = tasks;
    const next = [...tasks]; const [task] = next.splice(from, 1); next.splice(to, 0, task);
    const optimistic = next.map((item, index) => ({ ...item, sortOrder: index }));
    onTasksChange(optimistic);
    try { onTasksChange(await onReorder(optimistic.map((item) => item.id))); }
    catch (error) { onTasksChange(previous); onError(String(error)); }
  };
  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: number) => {
    if (disabled || event.button !== 0 || pointerStart.current) return;
    pointerStart.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const trackDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = pointerStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (draggedIdRef.current === null) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
      draggedIdRef.current = start.id; setDraggedId(start.id);
    }
    const list = event.currentTarget.closest(".task-list");
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-task-id]");
    const id = target && list?.contains(target) ? Number(target.dataset.taskId) : null;
    const validId = id !== null && tasks.some((task) => task.id === id) ? id : null;
    dropTargetIdRef.current = validId; setDropTargetId(validId);
  };
  const cancelDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerStart.current?.pointerId !== event.pointerId) return;
    pointerStart.current = null; draggedIdRef.current = null; dropTargetIdRef.current = null;
    setDraggedId(null); setDropTargetId(null);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerStart.current?.pointerId !== event.pointerId) return;
    if (draggedIdRef.current !== null) trackDrag(event);
    const from = tasks.findIndex((task) => task.id === draggedIdRef.current);
    const to = tasks.findIndex((task) => task.id === dropTargetIdRef.current);
    cancelDrag(event);
    if (from >= 0 && to >= 0) void move(from, to);
  };
  const done = tasks.filter((task) => task.isCompleted).length;
  return <section className="card task-section">
    <div className="section-heading"><h2>今日やること</h2><span>{done} / {tasks.length}</span></div>
    <div className="task-list">
      {tasks.map((task) => {
        const dueTime = task.dueAt ? new Date(task.dueAt).getTime() : Number.NaN;
        const overdue = !task.isCompleted && Number.isFinite(dueTime) && dueTime < now;
        return <div data-task-id={task.id} className={`task-row${draggedId === task.id ? " dragging" : ""}${draggedId !== null && dropTargetId === task.id ? " drop-target" : ""}`} key={task.id}>
          {!disabled && <button className="task-drag" aria-label={`${task.title}をドラッグして並び替え`} title="ドラッグして並び替え" onPointerDown={(event) => startDrag(event, task.id)} onPointerMove={trackDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>⋮⋮</button>}
          <button className={`check ${task.isCompleted ? "checked" : ""}`} disabled={disabled} aria-label={`${task.title}を${task.isCompleted ? "未完了" : "完了"}にする`} onClick={() => void onToggle(task)}>{task.isCompleted ? "✓" : ""}</button>
          <div className="task-content"><span className={task.isCompleted ? "completed" : ""}>{task.title}</span>{task.dueAt && <time dateTime={task.dueAt} className={overdue ? "overdue" : ""}>{overdue && <span aria-label="期限超過">🔥 </span>}{formatDueAt(task.dueAt)}</time>}</div>
          {task.carriedOver && <em>持ち越し</em>}
          {!disabled && <button className="task-edit subtle-action" aria-label={`${task.title}を編集`} onClick={(event) => openEditor(task, event.currentTarget)}>✎</button>}
          {!disabled && <button className="delete subtle-action" aria-label={`${task.title}を削除`} onClick={() => void onDelete(task.id)}>×</button>}
        </div>;
      })}
      {!tasks.length && <p className="empty">まず、今日やることを1つだけ書いてみる。</p>}
    </div>
    <div className="add-row"><span>＋</span><input ref={input} disabled={disabled} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }} placeholder="タスクを追加"/><kbd>Ctrl+T</kbd></div>
    {editing && createPortal(<div className="task-editor-backdrop"><div ref={dialog} className="task-editor" role="dialog" aria-modal="true" aria-labelledby="task-editor-title">
      <header><div><span>TASK</span><h2 id="task-editor-title">タスクを編集</h2></div><button className="editor-close" aria-label="編集画面を閉じる" disabled={saving} onClick={closeEditor}>×</button></header>
      <label><span>タスク名</span><input aria-label="タスク名" value={editTitle} disabled={saving} onChange={(event) => setEditTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void saveEditor(); } }}/></label>
      <label><span>期限（任意）</span><input type="datetime-local" aria-label="期限" value={editDueAt} disabled={saving} onChange={(event) => setEditDueAt(event.target.value)}/></label>
      {editError && <p className="error-text" role="alert">{editError}</p>}
      <footer><button disabled={saving} onClick={closeEditor}>キャンセル</button><button className="primary-button" disabled={saving} onClick={() => void saveEditor()}>{saving ? "保存中…" : "保存"}</button></footer>
    </div></div>, document.querySelector(".app-shell") ?? document.body)}
  </section>;
}
