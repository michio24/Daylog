// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "../types";
import { TimelineSection } from "./TimelineSection";

const entry: Entry = { id: 1, entryType: "memo", body: "最初の行\n2行目\n3行目", occurredAt: "2026-09-05T09:00:00+09:00" };

const setup = (entries: Entry[] = [entry], disabled = false) => {
  const onAdd = vi.fn().mockResolvedValue(undefined);
  const onUpdate = vi.fn(async (value: Entry) => value);
  const onType = vi.fn().mockResolvedValue(undefined);
  const onDelete = vi.fn().mockResolvedValue(undefined);
  const onError = vi.fn();
  const result = render(<TimelineSection entries={entries} dayDate="2026-09-05" disabled={disabled} onAdd={onAdd} onUpdate={onUpdate} onType={onType} onDelete={onDelete} onError={onError}/>);
  return { ...result, onAdd, onUpdate, onType, onDelete, onError };
};

afterEach(cleanup);

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
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("最初の行\n2行目", "memo"));
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
});
