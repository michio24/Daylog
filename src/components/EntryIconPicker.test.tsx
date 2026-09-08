// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntryIconPicker } from "./EntryIconPicker";
import { EntryIcon, parseEntryIcon } from "./EntryIcon";

afterEach(() => { cleanup(); localStorage.clear(); });
const open = (value = "", onSelect = vi.fn().mockResolvedValue(undefined)) => {
  const onClose = vi.fn();
  return { ...render(<EntryIconPicker value={value} onSelect={onSelect} onClose={onClose}/>), onClose, onSelect };
};

describe("EntryIconPicker", () => {
  it("restores persisted pairs, deduplicates them, and keeps the eight most recent", async () => {
    localStorage.setItem("daylog.entry-icon-history.v1", JSON.stringify(["done:teal", "study:blue", "meal:orange", "work:slate", "idea:amber", "walk:green", "happy:rose", "sleep:violet"]));
    const first = open("done:teal");
    fireEvent.click(screen.getByRole("button", { name: "決定" }));
    await waitFor(() => expect(first.onClose).toHaveBeenCalled());
    first.unmount();
    const second = open();
    const history = screen.getByRole("region", { name: "最近使った組み合わせ" });
    expect(within(history).getAllByRole("button")).toHaveLength(8);
    expect(within(history).getAllByRole("button")[0]).toHaveAccessibleName("完了・ティール");
    fireEvent.click(screen.getByRole("button", { name: "目標アイコン" }));
    fireEvent.click(screen.getByRole("button", { name: "ローズ" }));
    fireEvent.click(screen.getByRole("button", { name: "決定" }));
    await waitFor(() => expect(second.onSelect).toHaveBeenCalledWith("goal:rose"));
    await waitFor(() => expect(second.onClose).toHaveBeenCalled());
    const stored = JSON.parse(localStorage.getItem("daylog.entry-icon-history.v1")!);
    expect(stored).toHaveLength(8);
    expect(stored[0]).toBe("goal:rose");
    expect(stored).not.toContain("sleep:violet");
  });

  it("keeps the selection after failure and records history only after successful retry", async () => {
    const select = vi.fn().mockRejectedValueOnce(new Error("save failed")).mockResolvedValue(undefined);
    const { onClose } = open("study:violet", select);
    fireEvent.click(screen.getByRole("button", { name: "決定" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存できませんでした");
    expect(onClose).not.toHaveBeenCalled();
    expect(localStorage.getItem("daylog.entry-icon-history.v1")).toBeNull();
    expect(screen.getByRole("button", { name: "学習アイコン" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "決定" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(select).toHaveBeenLastCalledWith("study:violet");
  });

  it("removes an icon without adding an empty history item", async () => {
    const { onSelect, onClose } = open("done:teal");
    fireEvent.click(screen.getByRole("button", { name: "アイコンなし" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSelect).toHaveBeenCalledWith("");
    expect(localStorage.getItem("daylog.entry-icon-history.v1")).toBeNull();
  });

  it("traps keyboard focus and cancels with Escape without saving", () => {
    const { onSelect, onClose } = open();
    const close = screen.getByRole("button", { name: "アイコン選択を閉じる" });
    const apply = screen.getByRole("button", { name: "決定" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(apply).toHaveFocus();
    fireEvent.keyDown(apply, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("ignores malformed history and renders both legacy and colored icons", () => {
    localStorage.setItem("daylog.entry-icon-history.v1", JSON.stringify([null, {}, "invalid:blue", "done:bad", "done:teal:extra", "done:teal"]));
    open();
    expect(within(screen.getByRole("region", { name: "最近使った組み合わせ" })).getAllByRole("button")).toHaveLength(1);
    expect(parseEntryIcon("done").name).toBe("done");
    expect(parseEntryIcon("done:bad").palette).toBeUndefined();
    const legacy = render(<EntryIcon icon="done"/>);
    expect(legacy.container.querySelector("svg")).toBeInTheDocument();
    legacy.rerender(<EntryIcon icon="study:violet"/>);
    expect(legacy.container.querySelector(".entry-icon-glyph--colored")).toHaveStyle({ "--entry-color": "#7151a5" });
  });
});
