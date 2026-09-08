// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "../types";
import { TimelineSection } from "./TimelineSection";

const entry: Entry = { id: 1, icon: "", body: "最初の行\n2行目\n3行目", occurredAt: "2026-09-05T09:00:00+09:00" };

const setup = (entries: Entry[] = [entry], disabled = false) => {
  const onAdd = vi.fn().mockResolvedValue(undefined);
  const onUpdate = vi.fn(async (value: Entry) => value);
  const onIcon = vi.fn().mockResolvedValue(undefined);
  const onDelete = vi.fn().mockResolvedValue(undefined);
  const onError = vi.fn();
  const result = render(<TimelineSection entries={entries} dayDate="2026-09-05" disabled={disabled} onAdd={onAdd} onUpdate={onUpdate} onIcon={onIcon} onDelete={onDelete} onError={onError}/>);
  return { ...result, onAdd, onUpdate, onIcon, onDelete, onError };
};

afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

describe("TimelineSection", () => {
  it("shows every line of a multiline entry", () => {
    const { container } = setup();
    expect(container.querySelector(".timeline-content strong")).not.toBeInTheDocument();
    expect(container.querySelector(".timeline-content p")).toHaveTextContent("最初の行\n2行目\n3行目", { normalizeWhitespace: false });
  });

  it("submits a multiline draft without dropping lines", async () => {
    const { onAdd } = setup([]);
    const input = screen.getByPlaceholderText("今あったことを書く…");
    fireEvent.change(input, { target: { value: "最初の行\n2行目" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("最初の行\n2行目", ""));
  });

  it("selects an icon for a new entry and changes an existing icon", async () => {
    const { onAdd, onIcon } = setup();
    fireEvent.click(screen.getByRole("button", { name: "記録のアイコンと色を選択" }));
    fireEvent.click(screen.getByRole("button", { name: "完了アイコン" }));
    fireEvent.click(screen.getByRole("button", { name: "ティール" }));
    fireEvent.click(screen.getByRole("button", { name: "決定" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const input = screen.getByPlaceholderText("今あったことを書く…");
    fireEvent.change(input, { target: { value: "アイコン付き" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("アイコン付き", "done:teal"));

    fireEvent.click(screen.getByRole("button", { name: "アイコンを付ける" }));
    fireEvent.click(screen.getByRole("button", { name: "完了・ティール" }));
    fireEvent.click(screen.getByRole("button", { name: "決定" }));
    await waitFor(() => expect(onIcon).toHaveBeenCalledWith(entry, "done:teal"));
  });

  it("keeps the quick-entry clock aligned with the current minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 7, 22, 16, 45));
    const { container } = setup([]);
    const clock = container.querySelector(".quick-entry time");
    expect(clock).toHaveTextContent("22:16");

    act(() => { vi.advanceTimersByTime(15_000); });

    expect(clock).toHaveTextContent("22:17");
  });

  it("edits unified content and its existing local time", async () => {
    const titled = { ...entry, title: "タイトル", body: "本文", occurredAt: "2026-09-05T16:00:00+09:00" };
    const { onUpdate } = setup([titled]);
    fireEvent.click(screen.getByRole("button", { name: "記録「タイトル 本文」を編集" }));
    expect(screen.getByLabelText("記録内容")).toHaveValue("タイトル\n本文");
    expect(screen.getByLabelText("記録の時")).toHaveValue("16");
    expect(screen.getByLabelText("記録の分")).toHaveValue("00");
    fireEvent.change(screen.getByLabelText("記録内容"), { target: { value: " 更新後\nの内容 " } });
    fireEvent.change(screen.getByLabelText("記録の時"), { target: { value: "18" } });
    fireEvent.change(screen.getByLabelText("記録の分"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ title: null, body: "更新後\nの内容", occurredAt: expect.stringMatching(/^2026-09-05T18:30:00[+-]\d{2}:\d{2}$/) }), "2026-09-05"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("changes the record date while keeping time values", async () => {
    const { onUpdate } = setup();
    fireEvent.click(screen.getByRole("button", { name: /を編集$/ }));
    fireEvent.click(screen.getByRole("button", { name: "日付を変更" }));
    fireEvent.change(screen.getByLabelText("記録日"), { target: { value: "2026-09-07" } });
    expect(screen.getByLabelText("記録の時")).toHaveValue("09");
    expect(screen.getByLabelText("記録の分")).toHaveValue("00");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ occurredAt: expect.stringMatching(/^2026-09-07T09:00:00[+-]\d{2}:\d{2}$/) }), "2026-09-07"));
  });

  it("keeps all time choices available for an existing value", () => {
    setup([{ ...entry, occurredAt: "2026-09-05T16:25:00+09:00" }]);
    fireEvent.click(screen.getByRole("button", { name: /を編集$/ }));
    fireEvent.focus(screen.getByLabelText("記録の時"));
    expect(screen.getAllByRole("option")).toHaveLength(24);
    fireEvent.click(screen.getByRole("option", { name: "23" }));
    expect(screen.getByLabelText("記録の時")).toHaveValue("23");
    fireEvent.focus(screen.getByLabelText("記録の分"));
    expect(screen.getAllByRole("option")).toHaveLength(60);
    expect(screen.getByRole("option", { name: "59" })).toBeInTheDocument();
  });

  it("rejects empty content and invalid times", () => {
    const { onUpdate } = setup();
    fireEvent.click(screen.getByRole("button", { name: /を編集$/ }));
    fireEvent.change(screen.getByLabelText("記録内容"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("alert")).toHaveTextContent("内容を入力してください");
    fireEvent.change(screen.getByLabelText("記録内容"), { target: { value: "内容" } });
    fireEvent.change(screen.getByLabelText("記録の分"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("alert")).toHaveTextContent("記録時刻の時と分を両方入力してください");
    fireEvent.change(screen.getByLabelText("記録の分"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("alert")).toHaveTextContent("記録時刻は00:00〜23:59の範囲で入力してください");
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("keeps edits after save failure, retries, and cancels without saving", async () => {
    const { onUpdate, onError } = setup();
    onUpdate.mockRejectedValueOnce(new Error("update failed"));
    fireEvent.click(screen.getByRole("button", { name: /を編集$/ }));
    fireEvent.change(screen.getByLabelText("記録内容"), { target: { value: "再試行する内容" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存できませんでした");
    expect(screen.getByLabelText("記録内容")).toHaveValue("再試行する内容");
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("update failed"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: /を編集$/ }));
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it("does not expose editing for a closed day", () => {
    setup([entry], true);
    expect(screen.queryByRole("button", { name: /を編集$/ })).not.toBeInTheDocument();
  });
  it("deletes from the editor, removes inline delete controls, and locks actions while deleting", async () => {
    const { onDelete, onUpdate } = setup();
    let finish!: (value: undefined) => void;
    onDelete.mockImplementationOnce(() => new Promise<undefined>((resolve) => { finish = resolve; }));
    expect(screen.queryByRole("button", { name: /削除/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "記録「最初の行 2行目 3行目」を編集" }));
    fireEvent.click(screen.getByRole("button", { name: "この項目を削除" }));
    expect(onDelete).toHaveBeenCalledWith(1);
    expect(screen.getByRole("button", { name: "削除中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "キャンセル" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => { finish(undefined); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("keeps edits after deletion failure and allows retry", async () => {
    const { onDelete, onError } = setup();
    onDelete.mockRejectedValueOnce(new Error("delete failed"));
    fireEvent.click(screen.getByRole("button", { name: "記録「最初の行 2行目 3行目」を編集" }));
    fireEvent.change(screen.getByLabelText("記録内容"), { target: { value: "編集中の内容" } });
    fireEvent.click(screen.getByRole("button", { name: "この項目を削除" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("削除できませんでした");
    expect(screen.getByLabelText("記録内容")).toHaveValue("編集中の内容");
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("delete failed"));
    fireEvent.click(screen.getByRole("button", { name: "この項目を削除" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onDelete).toHaveBeenCalledTimes(2);
  });

});
