// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { api } from "./services/api";
import type { DayData, Settings } from "./types";
import { addDaysToDateKey, formatLongDate, localDateKey } from "./utils/date";

vi.mock("./services/api", () => ({
  api: {
    getToday: vi.fn(),
    getDay: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    createNoteCard: vi.fn(),
    updateNoteCard: vi.fn(),
    deleteNoteCard: vi.fn(),
    reorderNoteCards: vi.fn(),
    saveReview: vi.fn(),
    runAi: vi.fn(),
    cancelAi: vi.fn(),
    calendar: vi.fn()
  }
}));

const settings: Settings = {
  aiEnabled: false,
  modelPath: "",
  backend: "Auto",
  contextSize: null,
  generationLength: "標準",
  backupGenerations: 30,
  theme: "light",
  layout: "one"
};

afterEach(cleanup);

describe("App navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const day: DayData = {
      id: 1,
      dayDate: localDateKey(),
      isClosed: false,
      tasks: [],
      entries: [],
      notes: [{ id: 10, title: "既存メモ", markdown: "", sortOrder: 0 }],
      review: { good: "", bad: "", carryOver: "" }
    };
    vi.mocked(api.getToday).mockResolvedValue(day);
    vi.mocked(api.getDay).mockImplementation(async (date) => ({ ...day, id: 2, dayDate: date }));
    vi.mocked(api.getSettings).mockResolvedValue(settings);
    vi.mocked(api.saveSettings).mockResolvedValue();
    vi.mocked(api.createNoteCard).mockResolvedValue({ id: 11, title: "", markdown: "", sortOrder: 1 });
    vi.mocked(api.updateNoteCard).mockImplementation(async (card) => card);
    vi.mocked(api.deleteNoteCard).mockResolvedValue();
    vi.mocked(api.reorderNoteCards).mockResolvedValue([]);
    vi.mocked(api.saveReview).mockResolvedValue();
    vi.mocked(api.runAi).mockResolvedValue({ id: 20, summary: "まとめ", oneLine: "一言", achievements: [], tomorrowCandidates: [], generatedAt: "now" });
    vi.mocked(api.cancelAi).mockResolvedValue();
    vi.mocked(api.calendar).mockResolvedValue([]);
  });

  it("keeps an edited daily note after visiting history", async () => {
    render(<App/>);
    await screen.findByText("今日のメモ");
    fireEvent.click(screen.getByRole("button", { name: "「既存メモ」を編集" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown本文" }), { target: { value: "画面を移動しても残るメモ" } });
    fireEvent.click(screen.getByRole("button", { name: "履歴" }));

    await waitFor(() => expect(api.updateNoteCard).toHaveBeenCalledWith(expect.objectContaining({ id: 10, markdown: "画面を移動しても残るメモ" })));
    fireEvent.click(screen.getByRole("button", { name: "今日" }));
    fireEvent.click(await screen.findByRole("button", { name: "「既存メモ」を編集" }));
    expect(screen.getByRole("textbox", { name: "Markdown本文" })).toHaveValue("画面を移動しても残るメモ");
  });

  it("saves drafts before moving to the next day", async () => {
    const today = localDateKey();
    const nextDay = addDaysToDateKey(today, 1);
    render(<App/>);
    await screen.findByText("今日のメモ");
    fireEvent.click(screen.getByRole("button", { name: "「既存メモ」を編集" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown本文" }), { target: { value: "翌日へ移動する前のメモ" } });
    fireEvent.change(screen.getByPlaceholderText("うまくいったことを一言で"), { target: { value: "保存できた" } });
    fireEvent.click(screen.getByRole("button", { name: "次の日" }));

    await waitFor(() => expect(api.getDay).toHaveBeenCalledWith(nextDay));
    expect(api.updateNoteCard).toHaveBeenCalledWith(expect.objectContaining({ id: 10, markdown: "翌日へ移動する前のメモ" }));
    expect(api.saveReview).toHaveBeenCalledWith(today, { good: "保存できた", bad: "", carryOver: "" });
    expect(vi.mocked(api.updateNoteCard).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.getDay).mock.invocationCallOrder[0]);
    expect(vi.mocked(api.saveReview).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.getDay).mock.invocationCallOrder[0]);
    expect(await screen.findByText(formatLongDate(nextDay))).toBeInTheDocument();
  });

  it("keeps the current day when loading an adjacent day fails", async () => {
    const today = localDateKey();
    vi.mocked(api.getDay).mockRejectedValueOnce(new Error("load failed"));
    render(<App/>);
    await screen.findByText("今日のメモ");

    fireEvent.click(screen.getByRole("button", { name: "前の日" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("データを読み込めませんでした");
    expect(screen.getByText(formatLongDate(today))).toBeInTheDocument();
  });

  it("uses messages appropriate to past and future days", async () => {
    const today = localDateKey();
    const yesterday = addDaysToDateKey(today, -1);
    const tomorrow = addDaysToDateKey(today, 1);
    render(<App/>);
    await screen.findByText("今日のメモ");

    fireEvent.click(screen.getByRole("button", { name: "前の日" }));
    expect(await screen.findByRole("heading", { name: "この日はどうでしたか" })).toBeInTheDocument();
    expect(screen.getByText("この日の記録 0 件")).toBeInTheDocument();
    expect(api.getDay).toHaveBeenCalledWith(yesterday);

    fireEvent.click(screen.getByRole("button", { name: "次の日" }));
    expect(await screen.findByRole("heading", { name: /今日はどうですか|おはようございます|おつかれさまでした/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "次の日" }));
    expect(await screen.findByRole("heading", { name: "この日はどう過ごしますか" })).toBeInTheDocument();
    expect(screen.getByText("この日の予定・記録 0 件")).toBeInTheDocument();
    expect(api.getDay).toHaveBeenCalledWith(tomorrow);
  });

  it("switches to and saves the sakura theme", async () => {
    const { container } = render(<App/>);
    await screen.findByText("今日のメモ");

    fireEvent.click(screen.getByRole("button", { name: /和/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /桜/ }));

    expect(container.querySelector(".app-shell")).toHaveAttribute("data-theme", "sakura");
    expect(api.saveSettings).toHaveBeenCalledWith({ ...settings, theme: "sakura" });
  });

  it("switches to and restores the three-column layout", async () => {
    const first = render(<App/>);
    await screen.findByText("今日のメモ");
    fireEvent.click(screen.getByRole("button", { name: "3カラム" }));
    expect(api.saveSettings).toHaveBeenCalledWith({ ...settings, layout: "three" });
    expect(first.container.querySelector(".today-grid.three")).toBeInTheDocument();
    expect([...first.container.querySelector(".today-grid.three")!.children].map((element) => element.className)).toEqual([
      "calendar-column", "column primary-column", "column secondary-column"
    ]);

    first.unmount();
    vi.mocked(api.getSettings).mockResolvedValue({ ...settings, layout: "three" });
    const restored = render(<App/>);
    await screen.findByLabelText("カレンダー");
    expect(restored.container.querySelector(".page-inner.three-wide .today-grid.three")).toBeInTheDocument();
  });

  it("saves drafts before switching dates from the three-column calendar", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({ ...settings, layout: "three" });
    const today = localDateKey();
    const [year, month, dayNumber] = today.split("-");
    const target = `${year}-${month}-${dayNumber === "01" ? "02" : "01"}`;
    render(<App/>);
    await screen.findByLabelText("カレンダー");
    fireEvent.click(screen.getByRole("button", { name: "「既存メモ」を編集" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown本文" }), { target: { value: "カレンダー移動前のメモ" } });
    fireEvent.change(screen.getByPlaceholderText("うまくいったことを一言で"), { target: { value: "カレンダー移動前" } });
    const dateButton = screen.getByRole("button", { name: target });
    await waitFor(() => expect(dateButton).toBeEnabled());
    fireEvent.click(dateButton);

    await waitFor(() => expect(api.getDay).toHaveBeenCalledWith(target));
    expect(api.updateNoteCard).toHaveBeenCalledWith(expect.objectContaining({ markdown: "カレンダー移動前のメモ" }));
    expect(api.saveReview).toHaveBeenCalledWith(today, { good: "カレンダー移動前", bad: "", carryOver: "" });
    expect(vi.mocked(api.updateNoteCard).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.getDay).mock.invocationCallOrder[0]);
    expect(vi.mocked(api.saveReview).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.getDay).mock.invocationCallOrder[0]);
  });

  it("keeps the current date when saving before a calendar switch fails", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({ ...settings, layout: "three" });
    vi.mocked(api.saveReview).mockRejectedValueOnce(new Error("save failed"));
    const today = localDateKey();
    const target = `${today.slice(0, 8)}${today.endsWith("-01") ? "02" : "01"}`;
    render(<App/>);
    await screen.findByLabelText("カレンダー");
    fireEvent.change(screen.getByPlaceholderText("うまくいったことを一言で"), { target: { value: "未保存" } });
    const dateButton = screen.getByRole("button", { name: target });
    await waitFor(() => expect(dateButton).toBeEnabled());
    fireEvent.click(dateButton);

    expect(await screen.findByRole("alert")).toHaveTextContent("review save failed");
    expect(api.getDay).not.toHaveBeenCalled();
    expect(screen.getByText(formatLongDate(today))).toBeInTheDocument();
  });

  it("blocks another calendar selection while a date is loading", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({ ...settings, layout: "three" });
    const today = localDateKey();
    const availableDays = ["01", "02", "03"].filter((value) => value !== today.slice(-2));
    const firstDate = `${today.slice(0, 8)}${availableDays[0]}`;
    const secondDate = `${today.slice(0, 8)}${availableDays[1]}`;
    let finishLoad!: (day: DayData) => void;
    vi.mocked(api.getDay).mockImplementation(() => new Promise((resolve) => { finishLoad = resolve; }));
    render(<App/>);
    await screen.findByLabelText("カレンダー");
    const firstButton = screen.getByRole("button", { name: firstDate });
    const secondButton = screen.getByRole("button", { name: secondDate });
    await waitFor(() => expect(firstButton).toBeEnabled());
    fireEvent.click(firstButton);
    await waitFor(() => expect(api.getDay).toHaveBeenCalledTimes(1));
    expect(secondButton).toBeDisabled();
    fireEvent.click(secondButton);
    expect(api.getDay).toHaveBeenCalledTimes(1);
    finishLoad({ id: 2, dayDate: firstDate, isClosed: false, tasks: [], entries: [], notes: [], review: { good: "", bad: "", carryOver: "" } });
    expect(await screen.findByText(formatLongDate(firstDate))).toBeInTheDocument();
  });

  it("does not overwrite review edits made while AI is running", async () => {
    let finishAi!: (value: Awaited<ReturnType<typeof api.runAi>>) => void;
    vi.mocked(api.getSettings).mockResolvedValue({ ...settings, aiEnabled: true });
    vi.mocked(api.runAi).mockImplementation(() => new Promise((resolve) => { finishAi = resolve; }));
    render(<App/>);
    await screen.findByText("今日のメモ");

    fireEvent.change(screen.getByPlaceholderText("うまくいったことを一言で"), { target: { value: "AI開始前" } });
    fireEvent.click(screen.getByRole("button", { name: "AIで今日をまとめる" }));
    await waitFor(() => expect(api.runAi).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText("うまくいったことを一言で"), { target: { value: "AI実行中の編集" } });
    finishAi({ id: 20, summary: "まとめ", oneLine: "一言", achievements: [], tomorrowCandidates: [], generatedAt: "now" });

    await screen.findByText("まとめ");
    expect(screen.getByPlaceholderText("うまくいったことを一言で")).toHaveValue("AI実行中の編集");
  });

  it("does not offer AI generation for an empty day", async () => {
    vi.mocked(api.getSettings).mockResolvedValue({ ...settings, aiEnabled: true });
    vi.mocked(api.getToday).mockResolvedValue({
      id: 1,
      dayDate: localDateKey(),
      isClosed: false,
      tasks: [],
      entries: [],
      notes: [],
      review: { good: "", bad: "", carryOver: "" }
    });
    render(<App/>);

    expect(await screen.findByRole("button", { name: "まとめる記録がありません" })).toBeDisabled();
    expect(api.runAi).not.toHaveBeenCalled();
  });
});
