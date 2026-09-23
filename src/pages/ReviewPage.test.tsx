import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ReviewPage } from "./ReviewPage";
import { api } from "../services/api";
import type { DayStat, PeriodDigest, PeriodStats } from "../types";

vi.mock("../services/api", () => ({ api: { periodStats: vi.fn(), periodDigest: vi.fn(), onThisDay: vi.fn(), exportPeriodMarkdown: vi.fn() } }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const day = (date: string, entries = 0): DayStat => ({ date, tasksTotal: 0, tasksCompleted: 0, entries, notes: 0, hasReview: false, isClosed: false });

const stats = (start: string, end: string, daily: DayStat[]): PeriodStats => ({
  start, end, daily,
  totals: { daysInRange: daily.length, daysRecorded: daily.filter((d) => d.entries > 0).length, daysClosed: 0, tasksTotal: 4, tasksCompleted: 3, entriesTotal: 7, notesTotal: 2, reviewsWritten: 1 },
  previous: { daysInRange: daily.length, daysRecorded: 1, daysClosed: 0, tasksTotal: 2, tasksCompleted: 1, entriesTotal: 3, notesTotal: 0, reviewsWritten: 0 },
  tagCounts: [], iconCounts: [], hourHistogram: Array.from({ length: 24 }, () => 0), weekdayHistogram: Array.from({ length: 7 }, () => 0),
  streakLongest: 2, streakCurrent: 1
});

const emptyDigest: PeriodDigest = { reviews: [], openTasks: [], aiOneLines: [] };

// 2026-09-23 は水曜。その週は 09-21(月)〜09-27(日)。
beforeEach(() => {
  // Date だけを差し替える。setTimeout まで止めると waitFor が進まなくなる。
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 23, 10, 0, 0));
  vi.clearAllMocks();
  vi.mocked(api.periodStats).mockResolvedValue(stats("2026-09-21", "2026-09-27", [day("2026-09-21", 1), day("2026-09-22"), day("2026-09-23", 2)]));
  vi.mocked(api.periodDigest).mockResolvedValue(emptyDigest);
  vi.mocked(api.onThisDay).mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); });

const renderPage = () => {
  const onOpenDate = vi.fn(); const onError = vi.fn();
  render(<ReviewPage onOpenDate={onOpenDate} onError={onError}/>);
  return { onOpenDate, onError };
};

it("loads the current week on arrival", async () => {
  renderPage();
  await waitFor(() => expect(api.periodStats).toHaveBeenCalledWith("2026-09-21", "2026-09-27", "2026-09-14", "2026-09-20"));
  expect(api.periodDigest).toHaveBeenCalledWith("2026-09-21", "2026-09-27");
  expect(screen.getByText("2026年9月21日 〜 9月27日")).toBeInTheDocument();
});

it("moves to the previous period and blocks moving past today", async () => {
  renderPage();
  await waitFor(() => expect(api.periodStats).toHaveBeenCalled());
  // 今週にいるので「次の期間」は押せない。
  expect(screen.getByRole("button", { name: "次の期間" })).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "前の期間" }));
  await waitFor(() => expect(api.periodStats).toHaveBeenLastCalledWith("2026-09-14", "2026-09-20", "2026-09-07", "2026-09-13"));
  // 過去に戻ると次へ進めるようになり、「今週へ」が出る。
  expect(screen.getByRole("button", { name: "次の期間" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "今週へ" }));
  await waitFor(() => expect(api.periodStats).toHaveBeenLastCalledWith("2026-09-21", "2026-09-27", "2026-09-14", "2026-09-20"));
});

it("switches to month boundaries", async () => {
  renderPage();
  await waitFor(() => expect(api.periodStats).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "月" }));
  await waitFor(() => expect(api.periodStats).toHaveBeenLastCalledWith("2026-09-01", "2026-09-30", "2026-08-01", "2026-08-31"));
  expect(screen.getByText("2026年9月")).toBeInTheDocument();
});

it("opens a day from the heatmap", async () => {
  const { onOpenDate } = renderPage();
  const cell = await screen.findByRole("button", { name: /2026-09-23/ });
  fireEvent.click(cell);
  expect(onOpenDate).toHaveBeenCalledWith("2026-09-23");
});

it("shows empty states when nothing was recorded", async () => {
  vi.mocked(api.periodStats).mockResolvedValue(stats("2026-09-21", "2026-09-27", [day("2026-09-21")]));
  renderPage();
  expect(await screen.findByText("この期間に書かれた振り返りはありません。")).toBeInTheDocument();
  expect(screen.getByText("未完了のタスクはありません。")).toBeInTheDocument();
});

it("exports the shown period into the chosen folder", async () => {
  vi.mocked(openDialog).mockResolvedValue("W:\\書き出し先");
  vi.mocked(api.exportPeriodMarkdown).mockResolvedValue([
    { markdownPath: "a.md", attachmentCount: 0 },
    { markdownPath: "b.md", attachmentCount: 0 }
  ]);
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Markdownで書き出す" }));
  await waitFor(() => expect(api.exportPeriodMarkdown).toHaveBeenCalledWith("2026-09-21", "2026-09-27", "W:\\書き出し先"));
  expect(await screen.findByRole("status")).toHaveTextContent("2 件を書き出しました");
});

it("does nothing when the folder dialog is cancelled", async () => {
  vi.mocked(openDialog).mockResolvedValue(null);
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Markdownで書き出す" }));
  await waitFor(() => expect(openDialog).toHaveBeenCalled());
  expect(api.exportPeriodMarkdown).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("reports a failure without crashing", async () => {
  vi.mocked(api.periodStats).mockRejectedValue(new Error("集計に失敗"));
  const { onError } = renderPage();
  await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining("ふりかえりを読み込めませんでした")));
});
