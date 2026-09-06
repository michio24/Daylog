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

const setup = (items = tasks, disabled = false, dayDate = "2026-09-05") => {
  const onTasksChange = vi.fn();
  const onAdd = vi.fn(async () => undefined);
  const onToggle = vi.fn(async () => undefined);
  const onUpdate = vi.fn(async (task: Task) => task);
  const onDelete = vi.fn(async () => undefined);
  const onReorder = vi.fn(async (ids: number[]) => ids.map((id, sortOrder) => ({ ...items.find((task) => task.id === id)!, sortOrder })));
  const onError = vi.fn();
  render(<TaskSection tasks={items} dayDate={dayDate} disabled={disabled} onTasksChange={onTasksChange} onAdd={onAdd} onToggle={onToggle} onUpdate={onUpdate} onDelete={onDelete} onReorder={onReorder} onError={onError}/>);
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
    const { onUpdate } = setup(tasks, false, "2026-09-06");
    fireEvent.click(screen.getByRole("button", { name: "最初を編集" }));
    fireEvent.change(screen.getByLabelText("タスク名"), { target: { value: " 更新後 " } });
    expect(screen.getByText("9月6日(日)の期限")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("期限の時"), { target: { value: "18" } });
    fireEvent.change(screen.getByLabelText("期限の分"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: 1, title: "更新後", dueAt: expect.stringMatching(/^2026-09-06T18:30:00[+-]\d{2}:\d{2}$/)
    })));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clears a deadline, rejects an empty title, and cancels without saving", async () => {
    const { onUpdate } = setup([{ ...tasks[0], dueAt: "2026-09-06T18:30:00+09:00" }]);
    fireEvent.click(screen.getByRole("button", { name: "最初を編集" }));
    expect(screen.getByLabelText("期限日")).toHaveValue("2026-09-06");
    expect(screen.getByLabelText("期限の時")).toHaveValue("18");
    expect(screen.getByLabelText("期限の分")).toHaveValue("30");
    fireEvent.click(screen.getByRole("button", { name: "期限を解除" }));
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

  it.each(["2025-01-02", "2026-09-06", "2027-12-31"])("uses the record date %s when only a time is entered", async (dayDate) => {
    const { onUpdate } = setup(tasks, false, dayDate);
    fireEvent.click(screen.getByRole("button", { name: "最初を編集" }));
    fireEvent.change(screen.getByLabelText("期限の時"), { target: { value: "0" } });
    fireEvent.blur(screen.getByLabelText("期限の時"));
    fireEvent.change(screen.getByLabelText("期限の分"), { target: { value: "0" } });
    fireEvent.blur(screen.getByLabelText("期限の分"));
    expect(screen.getByLabelText("期限の時")).toHaveValue("00");
    expect(screen.getByLabelText("期限の分")).toHaveValue("00");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ dueAt: expect.stringMatching(new RegExp(`^${dayDate}T00:00:00[+-]\\d{2}:\\d{2}$`)) })));
  });

  it("changes the date without clearing the time and accepts 23:59", async () => {
    const { onUpdate } = setup();
    fireEvent.click(screen.getByRole("button", { name: "最初を編集" }));
    fireEvent.change(screen.getByLabelText("期限の時"), { target: { value: "23" } });
    fireEvent.change(screen.getByLabelText("期限の分"), { target: { value: "59" } });
    fireEvent.click(screen.getByRole("button", { name: "日付を変更" }));
    fireEvent.change(screen.getByLabelText("期限日"), { target: { value: "2026-09-07" } });
    expect(screen.getByLabelText("期限の時")).toHaveValue("23");
    expect(screen.getByLabelText("期限の分")).toHaveValue("59");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ dueAt: expect.stringMatching(/^2026-09-07T23:59:00[+-]\d{2}:\d{2}$/) })));
  });

  it("shows every choice when a time already has a value", () => {
    setup([{ ...tasks[0], dueAt: "2026-09-05T16:00:00+09:00" }]);
    fireEvent.click(screen.getByRole("button", { name: "最初を編集" }));
    fireEvent.focus(screen.getByLabelText("期限の時"));
    expect(screen.getAllByRole("option")).toHaveLength(24);
    expect(screen.getByRole("option", { name: "00" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "23" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "09" }));
    expect(screen.getByLabelText("期限の時")).toHaveValue("09");

    fireEvent.focus(screen.getByLabelText("期限の分"));
    expect(screen.getAllByRole("option")).toHaveLength(60);
    expect(screen.getByRole("option", { name: "59" })).toBeInTheDocument();
  });

  it("changes a time with the arrow keys without filtering its choices", () => {
    setup([{ ...tasks[0], dueAt: "2026-09-05T16:00:00+09:00" }]);
    fireEvent.click(screen.getByRole("button", { name: "最初を編集" }));
    const hour = screen.getByLabelText("期限の時");
    fireEvent.keyDown(hour, { key: "ArrowDown" });
    expect(hour).toHaveValue("17");
    expect(screen.getAllByRole("option")).toHaveLength(24);
    fireEvent.keyDown(hour, { key: "ArrowUp" });
    expect(hour).toHaveValue("16");
  });

  it("rejects incomplete and out-of-range times", () => {
    const { onUpdate } = setup();
    fireEvent.click(screen.getByRole("button", { name: "最初を編集" }));
    fireEvent.change(screen.getByLabelText("期限の時"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("alert")).toHaveTextContent("期限の時と分を両方入力してください");
    fireEvent.change(screen.getByLabelText("期限の分"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("alert")).toHaveTextContent("期限は00:00〜23:59の範囲で入力してください");
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("keeps the editor values after a save failure and allows retry", async () => {
    const { onUpdate, onError } = setup();
    onUpdate.mockRejectedValueOnce(new Error("update failed"));
    fireEvent.click(screen.getByRole("button", { name: "最初を編集" }));
    fireEvent.change(screen.getByLabelText("期限の時"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("期限の分"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存できませんでした");
    expect(screen.getByLabelText("期限の時")).toHaveValue("8");
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("update failed"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
