// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entry, Tag } from "../types";
import { TimelineSection } from "./TimelineSection";

const entry: Entry = { id: 1, icon: "", body: "最初の行\n2行目\n3行目", occurredAt: "2026-09-05T09:00:00+09:00" };

const setup = (entries: Entry[] = [entry], disabled = false, availableTags: Tag[] = []) => {
  const onAdd = vi.fn().mockResolvedValue(undefined);
  const onUpdate = vi.fn(async (value: Entry) => value);
  const onIcon = vi.fn().mockResolvedValue(undefined);
  const onSetTags = vi.fn(async (_id: number, ids: number[]) => availableTags.filter((tag) => ids.includes(tag.id)));
  const onDelete = vi.fn().mockResolvedValue(undefined);
  const onError = vi.fn();
  const result = render(<TimelineSection entries={entries} availableTags={availableTags} dayDate="2026-09-05" disabled={disabled} onAdd={onAdd} onUpdate={onUpdate} onIcon={onIcon} onSetTags={onSetTags} onDelete={onDelete} onError={onError}/>);
  return { ...result, onAdd, onUpdate, onIcon, onSetTags, onDelete, onError };
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
  it("assigns and removes multiple tags from a record without saving its text", async () => {
    const availableTags: Tag[] = [{ id: 1, name: "仕事", color: "blue" }, { id: 2, name: "発想", color: "rose" }, ...Array.from({ length: 98 }, (_, index) => ({ id: index + 3, name: `分類${index + 1}`, color: "slate" }))];
    const { onSetTags, onUpdate, rerender } = setup([entry], false, availableTags);
    fireEvent.click(screen.getByRole("button", { name: /を編集$/ }));
    fireEvent.click(screen.getByRole("button", { name: "＋ タグ" }));
    fireEvent.change(screen.getByRole("textbox", { name: "タグを探す" }), { target: { value: "仕事" } });
    fireEvent.click(screen.getByRole("button", { name: "仕事を追加" }));
    await waitFor(() => expect(onSetTags).toHaveBeenCalledWith(1, [1]));
    fireEvent.change(screen.getByRole("textbox", { name: "タグを探す" }), { target: { value: "発想" } });
    fireEvent.click(screen.getByRole("button", { name: "発想を追加" }));
    await waitFor(() => expect(onSetTags).toHaveBeenCalledWith(1, [1, 2]));
    fireEvent.click(screen.getByRole("button", { name: "仕事を外す" }));
    await waitFor(() => expect(onSetTags).toHaveBeenCalledWith(1, [2]));
    expect(onUpdate).not.toHaveBeenCalled();
    rerender(<TimelineSection entries={[{ ...entry, tags: [availableTags[1]] }]} availableTags={availableTags} dayDate="2026-09-05" disabled onAdd={vi.fn()} onUpdate={vi.fn()} onIcon={vi.fn()} onSetTags={vi.fn()} onDelete={vi.fn()} onError={vi.fn()}/>);
    expect(document.querySelector(".timeline-entry-main .tag-chip")).toHaveTextContent("発想");
    expect(screen.queryByRole("button", { name: "＋ タグ" })).not.toBeInTheDocument();
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
