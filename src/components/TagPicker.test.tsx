// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TagPicker } from "./TagPicker";
import type { Tag } from "../types";

afterEach(cleanup);

it("keeps the editor row compact and opens all tags in a searchable popup", async () => {
  const available: Tag[] = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, name: `分類${String(index + 1).padStart(3, "0")}`, color: "blue" }));
  const selected = available.slice(0, 5);
  const onChange = vi.fn();
  render(<TagPicker available={available} selected={selected} onChange={onChange}/>);
  expect(document.querySelectorAll(".tag-picker-summary .tag-chip")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "残り3件のタグを見る" })).toHaveTextContent("＋3");
  expect(screen.queryByRole("textbox", { name: "タグを探す" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "残り3件のタグを見る" }));
  expect(screen.getAllByRole("button", { name: /を外す$/ })).toHaveLength(5);
  fireEvent.change(screen.getByRole("textbox", { name: "タグを探す" }), { target: { value: "分類100" } });
  expect(screen.getByRole("group", { name: "タグの候補" }).querySelectorAll("button")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "分類100を追加" }));
  expect(onChange).toHaveBeenCalledWith([1, 2, 3, 4, 5, 100]);
  fireEvent.pointerDown(document.body);
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "タグを探す" })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "＋ タグ" }));
  fireEvent.keyDown(screen.getByRole("textbox", { name: "タグを探す" }), { key: "Escape" });
  expect(screen.queryByRole("textbox", { name: "タグを探す" })).not.toBeInTheDocument();
});

it("shows assigned tags without an edit control on a closed day", () => {
  const tags: Tag[] = Array.from({ length: 4 }, (_, index) => ({ id: index + 1, name: `タグ${index + 1}`, color: "blue" }));
  render(<TagPicker available={tags} selected={tags} disabled onChange={vi.fn()}/>);
  expect(document.querySelectorAll(".tag-picker-summary .tag-chip")).toHaveLength(2);
  expect(screen.getByText("＋2")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "＋ タグ" })).not.toBeInTheDocument();
});

it("keeps the popup inside the viewport near the lower right edge", async () => {
  const tag: Tag = { id: 1, name: "仕事", color: "blue" };
  render(<TagPicker available={[tag]} selected={[]} onChange={vi.fn()}/>);
  const trigger = screen.getByRole("button", { name: "＋ タグ" });
  vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ left: window.innerWidth - 60, right: window.innerWidth, top: window.innerHeight - 48, bottom: window.innerHeight - 24, width: 60, height: 24, x: window.innerWidth - 60, y: window.innerHeight - 48, toJSON: () => ({}) } as DOMRect);
  fireEvent.click(trigger);
  const popup = screen.getByRole("group", { name: "タグを設定" });
  await waitFor(() => expect(parseInt(popup.style.top, 10)).toBeLessThan(window.innerHeight - 48));
  expect(parseInt(popup.style.left, 10) + parseInt(popup.style.width, 10)).toBeLessThanOrEqual(window.innerWidth - 8);
});
