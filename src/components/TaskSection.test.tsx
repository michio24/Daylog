// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../types";
import { TaskSection } from "./TaskSection";

const tasks: Task[] = [
  { id: 1, title: "最初", isCompleted: false, sortOrder: 0, carriedOver: false, completedAt: null, dueAt: null },
  { id: 2, title: "次", isCompleted: false, sortOrder: 1, carriedOver: false, completedAt: null, dueAt: null }
];

const setup = (items = tasks, disabled = false) => {
  const onTasksChange = vi.fn();
  const onAdd = vi.fn(async () => undefined);
  const onToggle = vi.fn(async () => undefined);
  const onUpdate = vi.fn(async (task: Task) => task);
  const onDelete = vi.fn(async () => undefined);
  const onReorder = vi.fn(async (ids: number[]) => ids.map((id, sortOrder) => ({ ...items.find((task) => task.id === id)!, sortOrder })));
  const onError = vi.fn();
  render(<TaskSection tasks={items} disabled={disabled} onTasksChange={onTasksChange} onAdd={onAdd} onToggle={onToggle} onUpdate={onUpdate} onDelete={onDelete} onReorder={onReorder} onError={onError}/>);
  return { onTasksChange, onAdd, onToggle, onUpdate, onDelete, onReorder, onError };
};

beforeEach(() => {
  vi.clearAllMocks();
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("TaskSection", () => {
  it("edits the title and stores an optional local deadline as RFC 3339", async () => {
    const { onUpdate } = setup();
    fireEvent.click(screen.getByRole("button", { name: "最初を編集" }));
    fireEvent.change(screen.getByLabelText("タスク名"), { target: { value: " 更新後 " } });
    fireEvent.change(screen.getByLabelText("期限"), { target: { value: "2026-09-06T18:30" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: 1, title: "更新後", dueAt: expect.stringMatching(/^2026-09-06T18:30:00[+-]\d{2}:\d{2}$/)
    })));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clears a deadline, rejects an empty title, and cancels without saving", async () => {
    const { onUpdate } = setup([{ ...tasks[0], dueAt: "2026-09-06T18:30:00+09:00" }]);
    fireEvent.click(screen.getByRole("button", { name: "最初を編集" }));
    expect((screen.getByLabelText("期限") as HTMLInputElement).value).toMatch(/^2026-09-06T/);
    fireEvent.change(screen.getByLabelText("期限"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("タスク名"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("alert")).toHaveTextContent("タスク名を入力してください");
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("タスク名"), { target: { value: "最初" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ dueAt: null })));

    fireEvent.click(screen.getByRole("button", { name: "最初を編集" }));
    fireEvent.change(screen.getByLabelText("タスク名"), { target: { value: "保存しない" } });
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it("shows fire only for an overdue incomplete task and refreshes every 30 seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T10:00:00.000Z"));
    setup([
      { ...tasks[0], dueAt: "2026-09-06T10:00:15.000Z" },
      { ...tasks[1], isCompleted: true, dueAt: "2026-09-06T09:00:00.000Z" },
      { ...tasks[0], id: 3, title: "期限なし", sortOrder: 2 }
    ]);
    expect(screen.queryByLabelText("期限超過")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getAllByLabelText("期限超過")).toHaveLength(1);
  });

  it("reorders optimistically by dragging and rolls back when persistence fails", async () => {
    const props = setup();
    props.onReorder.mockRejectedValueOnce(new Error("reorder failed"));
    const target = screen.getByText("次").closest("[data-task-id]");
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => target) });
    const handle = screen.getByRole("button", { name: "最初をドラッグして並び替え" });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 50, clientY: 50 });

    await waitFor(() => expect(props.onReorder).toHaveBeenCalledWith([2, 1]));
    expect(props.onTasksChange).toHaveBeenNthCalledWith(1, [expect.objectContaining({ id: 2, sortOrder: 0 }), expect.objectContaining({ id: 1, sortOrder: 1 })]);
    await waitFor(() => expect(props.onTasksChange).toHaveBeenLastCalledWith(tasks));
    expect(props.onError).toHaveBeenCalledWith(expect.stringContaining("reorder failed"));
  });

  it("does not expose editing or drag controls for a closed day", () => {
    setup(tasks, true);
    expect(screen.queryByRole("button", { name: /を編集$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ドラッグして並び替え/ })).not.toBeInTheDocument();
  });
});
