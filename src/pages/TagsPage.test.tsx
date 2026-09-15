// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TagsPage } from "./TagsPage";
import { api } from "../services/api";
import type { Tag } from "../types";

vi.mock("../services/api", () => ({ api: { createTag: vi.fn(), updateTag: vi.fn(), deleteTag: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.createTag).mockImplementation(async (name, color) => ({ id: 2, name, color })); vi.mocked(api.updateTag).mockImplementation(async (tag) => tag); vi.mocked(api.deleteTag).mockResolvedValue(); });
afterEach(cleanup);

it("creates, edits and deletes a tag while explaining the deletion", async () => {
  let tags: Tag[] = [{ id: 1, name: "仕事", color: "blue" }];
  const onTags = vi.fn((next: Tag[]) => { tags = next; });
  const onError = vi.fn();
  const { rerender } = render(<TagsPage tags={tags} onTags={onTags} onError={onError}/>);
  fireEvent.change(screen.getByLabelText("タグ名"), { target: { value: "発想" } });
  fireEvent.click(screen.getByRole("button", { name: "ローズを選択" }));
  fireEvent.click(screen.getByRole("button", { name: "タグを追加" }));
  await waitFor(() => expect(api.createTag).toHaveBeenCalledWith("発想", "rose"));
  rerender(<TagsPage tags={tags} onTags={onTags} onError={onError}/>);
  fireEvent.click(screen.getAllByRole("button", { name: "編集" })[0]);
  fireEvent.change(screen.getByLabelText("タグ名"), { target: { value: "業務" } });
  fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));
  await waitFor(() => expect(api.updateTag).toHaveBeenCalledWith(expect.objectContaining({ id: 1, name: "業務" })));
  rerender(<TagsPage tags={tags} onTags={onTags} onError={onError}/>);
  fireEvent.click(screen.getAllByRole("button", { name: "削除" })[0]);
  expect(screen.getByText(/タスク・メモからタグだけを外します/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "タグを削除" }));
  await waitFor(() => expect(api.deleteTag).toHaveBeenCalledWith(1));
});

it("filters a 100-tag list while keeping management actions available", async () => {
  let tags: Tag[] = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, name: index === 49 ? "仕事" : `分類${String(index + 1).padStart(3, "0")}`, color: "slate" }));
  vi.mocked(api.createTag).mockResolvedValueOnce({ id: 101, name: "仕事追加", color: "blue" });
  const onTags = vi.fn((next: Tag[]) => { tags = next; });
  const { rerender } = render(<TagsPage tags={tags} onTags={onTags} onError={vi.fn()}/>);
  fireEvent.change(screen.getByRole("textbox", { name: "タグ一覧を絞り込む" }), { target: { value: "仕事" } });
  expect(screen.getAllByRole("button", { name: "編集" })).toHaveLength(1);
  fireEvent.change(screen.getByRole("textbox", { name: "タグ名" }), { target: { value: "仕事追加" } });
  fireEvent.click(screen.getByRole("button", { name: "タグを追加" }));
  await waitFor(() => expect(api.createTag).toHaveBeenCalledWith("仕事追加", "blue"));
  rerender(<TagsPage tags={tags} onTags={onTags} onError={vi.fn()}/>);
  expect(screen.getAllByRole("button", { name: "編集" })).toHaveLength(2);
  fireEvent.click(screen.getByText("仕事").closest(".tag-list-row")!.querySelector<HTMLButtonElement>("button")!);
  fireEvent.change(screen.getByRole("textbox", { name: "タグ名" }), { target: { value: "仕事改" } });
  fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));
  await waitFor(() => expect(api.updateTag).toHaveBeenCalledWith(expect.objectContaining({ id: 50, name: "仕事改" })));
  rerender(<TagsPage tags={tags} onTags={onTags} onError={vi.fn()}/>);
  fireEvent.change(screen.getByRole("textbox", { name: "タグ一覧を絞り込む" }), { target: { value: "見つからない" } });
  expect(screen.getByText("一致するタグはありません。")).toBeInTheDocument();
});
