import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { SearchPage } from "./SearchPage";
import { api } from "../services/api";
import type { SearchPage as SearchPageResult } from "../types";

vi.mock("../services/api", () => ({ api: { search: vi.fn() } }));

const page = (results: SearchPageResult["results"], total = results.length, hasMore = false): SearchPageResult => ({ results, total, hasMore });
const hit = { entityType: "task", entityId: 1, dayDate: "2026-09-05", excerpt: "朝会", tags: [{ id: 1, name: "仕事", color: "blue" }] };

beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.search).mockResolvedValue(page([hit])); });

const tags = [{ id: 1, name: "仕事", color: "blue" }, ...Array.from({ length: 99 }, (_, index) => ({ id: index + 2, name: `分類${String(index + 1).padStart(3, "0")}`, color: "slate" }))];

it("filters by a tag alone and combines it with a keyword", async () => {
  const onOpen = vi.fn();
  render(<SearchPage tags={tags} onOpen={onOpen}/>);
  fireEvent.change(screen.getByRole("textbox", { name: "タグで絞り込む" }), { target: { value: "仕事" } });
  expect(screen.getByRole("group", { name: "タグの候補" }).querySelectorAll("button")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "仕事で絞り込む" }));
  await waitFor(() => expect(api.search).toHaveBeenCalledWith(expect.objectContaining({ query: "", tagId: 1 })));
  expect(screen.getByRole("button", { name: "仕事の絞り込みを解除" })).toBeInTheDocument();
  expect(await screen.findByText("朝会")).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText("タスク、記録、メモを検索"), { target: { value: "朝会" } });
  await waitFor(() => expect(api.search).toHaveBeenCalledWith(expect.objectContaining({ query: "朝会", tagId: 1 })));
  fireEvent.click(screen.getByRole("button", { name: /朝会/ }));
  expect(onOpen).toHaveBeenCalledWith("2026-09-05");
  fireEvent.click(screen.getByRole("button", { name: "仕事の絞り込みを解除" }));
  await waitFor(() => expect(api.search).toHaveBeenCalledWith(expect.objectContaining({ query: "朝会", tagId: null })));
});

it("passes the selected kinds to the search", async () => {
  render(<SearchPage tags={tags} onOpen={vi.fn()}/>);
  fireEvent.change(screen.getByPlaceholderText("タスク、記録、メモを検索"), { target: { value: "会議" } });
  await waitFor(() => expect(api.search).toHaveBeenCalledWith(expect.objectContaining({ entityTypes: [] })));
  fireEvent.click(screen.getByRole("button", { name: "振り返り" }));
  await waitFor(() => expect(api.search).toHaveBeenCalledWith(expect.objectContaining({ entityTypes: ["review"] })));
  // もう一度押すと外れる。
  fireEvent.click(screen.getByRole("button", { name: "振り返り" }));
  await waitFor(() => expect(api.search).toHaveBeenLastCalledWith(expect.objectContaining({ entityTypes: [] })));
});

it("narrows the search to a period without a keyword", async () => {
  render(<SearchPage tags={[]} onOpen={vi.fn()}/>);
  // 期間だけでも検索が走る。
  fireEvent.click(screen.getByRole("button", { name: "今月" }));
  await waitFor(() => expect(api.search).toHaveBeenCalledWith(expect.objectContaining({ from: expect.stringMatching(/^\d{4}-\d{2}-01$/) as unknown as string })));
});

it("appends the next page and hides the button at the end", async () => {
  const first = Array.from({ length: 50 }, (_, index) => ({ ...hit, entityId: index + 1, excerpt: `結果${index}` }));
  vi.mocked(api.search).mockResolvedValueOnce(page(first, 51, true));
  render(<SearchPage tags={[]} onOpen={vi.fn()}/>);
  fireEvent.change(screen.getByPlaceholderText("タスク、記録、メモを検索"), { target: { value: "結果" } });
  const more = await screen.findByRole("button", { name: /さらに読み込む/ });

  // 検索語（「結果」）を含まない文言にする。含むと <mark> で分割されて
  // findByText が一致しない。
  vi.mocked(api.search).mockResolvedValueOnce(page([{ ...hit, entityId: 51, excerpt: "おしまい" }], 51, false));
  fireEvent.click(more);
  await waitFor(() => expect(api.search).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })));
  expect(await screen.findByText("おしまい")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("button", { name: /さらに読み込む/ })).not.toBeInTheDocument());
});

it("shows an error without losing the page", async () => {
  vi.mocked(api.search).mockRejectedValueOnce(new Error("壊れた索引"));
  render(<SearchPage tags={[]} onOpen={vi.fn()}/>);
  fireEvent.change(screen.getByPlaceholderText("タスク、記録、メモを検索"), { target: { value: "会議" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("検索できませんでした");
});
