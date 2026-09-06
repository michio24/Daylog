// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../services/api";
import type { DayData, Settings } from "../types";
import { TodayPage } from "./TodayPage";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../services/api", () => ({
  api: {
    saveReview: vi.fn(),
    updateNoteCard: vi.fn(),
    updateEntry: vi.fn(),
    exportDayMarkdown: vi.fn()
  }
}));

const settings: Settings = { aiEnabled: false, modelPath: "", backend: "Auto", contextSize: null, generationLength: "標準", backupGenerations: 30, theme: "light", layout: "one" };
const day: DayData = {
  id: 1,
  dayDate: "2026-09-05",
  isClosed: false,
  tasks: [],
  entries: [],
  notes: [{ id: 10, title: "メモ", markdown: "変更前", sortOrder: 0 }],
  review: { good: "", bad: "", carryOver: "" }
};

describe("TodayPage Markdown export", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(save).mockResolvedValue("C:\\Exports\\2026年09月05日(土).md");
    vi.mocked(api.saveReview).mockResolvedValue();
    vi.mocked(api.updateNoteCard).mockImplementation(async (note) => note);
    vi.mocked(api.updateEntry).mockImplementation(async (entry) => entry);
    vi.mocked(api.exportDayMarkdown).mockResolvedValue({ markdownPath: "C:\\Exports\\2026年09月05日(土).md", assetsDirectory: null, attachmentCount: 0 });
  });

  it("flushes edited content before opening the save dialog and exporting", async () => {
    render(<TodayPage day={day} settings={settings} onDay={vi.fn()} onOpenDate={vi.fn()} onError={vi.fn()}/>);
    fireEvent.change(screen.getByLabelText("今日よかったこと"), { target: { value: "よかった" } });
    fireEvent.click(screen.getByRole("button", { name: "「メモ」を編集" }));
    fireEvent.change(screen.getByLabelText("Markdown本文"), { target: { value: "変更後" } });
    fireEvent.click(screen.getByRole("button", { name: "Markdownで保存" }));

    await waitFor(() => expect(api.exportDayMarkdown).toHaveBeenCalledWith("2026-09-05", "C:\\Exports\\2026年09月05日(土).md"));
    expect(api.saveReview).toHaveBeenCalledWith("2026-09-05", expect.objectContaining({ good: "よかった" }));
    expect(api.updateNoteCard).toHaveBeenCalledWith(expect.objectContaining({ markdown: "変更後" }));
    expect(vi.mocked(save).mock.calls[0][0]).toMatchObject({ defaultPath: "2026年09月05日(土).md" });
    expect(vi.mocked(api.saveReview).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(save).mock.invocationCallOrder[0]);
    expect(vi.mocked(api.updateNoteCard).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(save).mock.invocationCallOrder[0]);
    expect(await screen.findByRole("status")).toHaveTextContent("保存しました");
  });

  it("does nothing when the save dialog is cancelled", async () => {
    vi.mocked(save).mockResolvedValue(null);
    render(<TodayPage day={{ ...day, notes: [] }} settings={settings} onDay={vi.fn()} onOpenDate={vi.fn()} onError={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button", { name: "Markdownで保存" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(api.exportDayMarkdown).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("reorders an edited entry by its new time", async () => {
    const entries = [
      { id: 1, entryType: "memo", body: "早い", occurredAt: "2026-09-05T10:00:00+09:00" },
      { id: 2, entryType: "memo", body: "遅い", occurredAt: "2026-09-05T12:00:00+09:00" }
    ];
    const currentDay = { ...day, entries, notes: [] };
    const onDay = vi.fn();
    render(<TodayPage day={currentDay} settings={settings} onDay={onDay} onOpenDate={vi.fn()} onError={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button", { name: "記録「遅い」を編集" }));
    fireEvent.change(screen.getByLabelText("記録の時"), { target: { value: "08" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(api.updateEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 2, occurredAt: expect.stringMatching(/^2026-09-05T08:00:00/) }), "2026-09-05"));
    const update = onDay.mock.calls.at(-1)?.[0] as (value: DayData) => DayData;
    expect(update(currentDay).entries.map((entry) => entry.id)).toEqual([2, 1]);
  });

  it("removes an entry from the current list after moving it to another day", async () => {
    const currentDay = { ...day, entries: [{ id: 1, entryType: "memo", body: "移動する", occurredAt: "2026-09-05T10:00:00+09:00" }], notes: [] };
    const onDay = vi.fn();
    const onOpenDate = vi.fn();
    render(<TodayPage day={currentDay} settings={settings} onDay={onDay} onOpenDate={onOpenDate} onError={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button", { name: "記録「移動する」を編集" }));
    fireEvent.click(screen.getByRole("button", { name: "日付を変更" }));
    fireEvent.change(screen.getByLabelText("記録日"), { target: { value: "2026-09-07" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(api.updateEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 1, occurredAt: expect.stringMatching(/^2026-09-07T10:00:00/) }), "2026-09-07"));
    const update = onDay.mock.calls.at(-1)?.[0] as (value: DayData) => DayData;
    expect(update(currentDay).entries).toEqual([]);
    expect(onOpenDate).not.toHaveBeenCalled();
  });
});
