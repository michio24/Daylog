import { useRef, useState } from "react";
import type { Task } from "../types";

interface Props { tasks: Task[]; disabled: boolean; onAdd: (title: string) => Promise<void>; onToggle: (task: Task) => Promise<void>; onDelete: (id: number) => Promise<void>; }

export function TaskSection({ tasks, disabled, onAdd, onToggle, onDelete }: Props) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const submit = async () => {
    const title = draft.trim();
    if (!title || disabled) return;
    try {
      await onAdd(title);
      setDraft((current) => current.trim() === title ? "" : current);
    } catch { /* The parent reports the error; keep the draft for retry. */ }
  };
  const done = tasks.filter((task) => task.isCompleted).length;
  return <section className="card task-section">
    <div className="section-heading"><h2>今日やること</h2><span>{done} / {tasks.length}</span></div>
    <div className="task-list">
      {tasks.map((task) => <div className="task-row" key={task.id}>
        <button className={`check ${task.isCompleted ? "checked" : ""}`} disabled={disabled} aria-label={`${task.title}を${task.isCompleted ? "未完了" : "完了"}にする`} onClick={() => void onToggle(task)}>{task.isCompleted ? "✓" : ""}</button>
        <span className={task.isCompleted ? "completed" : ""}>{task.title}</span>
        {task.carriedOver && <em>持ち越し</em>}
        {!disabled && <button className="delete subtle-action" aria-label={`${task.title}を削除`} onClick={() => void onDelete(task.id)}>×</button>}
      </div>)}
      {!tasks.length && <p className="empty">まず、今日やることを1つだけ書いてみる。</p>}
    </div>
    <div className="add-row"><span>＋</span><input ref={input} disabled={disabled} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }} placeholder="タスクを追加"/><kbd>Ctrl+T</kbd></div>
  </section>;
}
