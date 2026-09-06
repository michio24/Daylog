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
});
