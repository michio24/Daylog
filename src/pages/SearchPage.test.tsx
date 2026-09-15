// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SearchPage } from "./SearchPage";
import { api } from "../services/api";

vi.mock("../services/api", () => ({ api: { searchByTag: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.searchByTag).mockResolvedValue([{ entityType: "task", entityId: 1, dayDate: "2026-09-05", excerpt: "朝会", tags: [{ id: 1, name: "仕事", color: "blue" }] }]); });
afterEach(cleanup);

it("filters by a tag alone and combines it with a keyword", async () => {
  const onOpen = vi.fn();
  const tags = [{ id: 1, name: "仕事", color: "blue" }, ...Array.from({ length: 99 }, (_, index) => ({ id: index + 2, name: `分類${String(index + 1).padStart(3, "0")}`, color: "slate" }))];
  render(<SearchPage tags={tags} onOpen={onOpen}/>);
  fireEvent.change(screen.getByRole("textbox", { name: "タグで絞り込む" }), { target: { value: "仕事" } });
  expect(screen.getByRole("group", { name: "タグの候補" }).querySelectorAll("button")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "仕事で絞り込む" }));
  await waitFor(() => expect(api.searchByTag).toHaveBeenCalledWith("", 1));
  expect(screen.getByRole("button", { name: "仕事の絞り込みを解除" })).toBeInTheDocument();
  expect(await screen.findByText("朝会")).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText("タスク、記録、メモを検索"), { target: { value: "朝会" } });
  await waitFor(() => expect(api.searchByTag).toHaveBeenCalledWith("朝会", 1));
  fireEvent.click(screen.getByRole("button", { name: /朝会/ }));
  expect(onOpen).toHaveBeenCalledWith("2026-09-05");
  fireEvent.click(screen.getByRole("button", { name: "仕事の絞り込みを解除" }));
  await waitFor(() => expect(api.searchByTag).toHaveBeenCalledWith("朝会", null));
});
