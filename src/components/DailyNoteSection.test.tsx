// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailyNoteSection } from "./DailyNoteSection";
import type { NoteCard } from "../types";

const cards: NoteCard[] = [
  { id: 1, title: "最初", markdown: "**本文**", sortOrder: 0 },
  { id: 2, title: "次", markdown: "二枚目", sortOrder: 1 }
];

beforeEach(() => {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup(notes = cards) {
  const onCardsChange = vi.fn();
  const onCreate = vi.fn(async () => ({ id: 3, title: "", markdown: "", sortOrder: 2 }));
  const onSave = vi.fn(async (card: NoteCard) => card);
  const onDelete = vi.fn(async () => undefined);
  const onReorder = vi.fn(async (ids: number[]) => ids.map((id, sortOrder) => ({ ...cards.find((card) => card.id === id)!, sortOrder })));
  const onError = vi.fn();
  render(<DailyNoteSection notes={notes} disabled={false} onCardsChange={onCardsChange} onCreate={onCreate} onSave={onSave} onDelete={onDelete} onReorder={onReorder} onError={onError}/>);
  return { onCardsChange, onCreate, onSave, onDelete, onReorder, onError };
}

const cardOpenButton = (title: string) => screen.getByText(title).closest("article")!.querySelector<HTMLButtonElement>(".note-card-open")!;

describe("DailyNoteSection", () => {
  it("creates a card and opens the full editor", async () => {
    const { onCreate } = setup([]);
    fireEvent.click(screen.getByRole("button", { name: "＋ メモを追加" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(onCreate).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox", { name: "メモのタイトル" })).toHaveFocus();
  });

  it("edits markdown, previews it, and flushes before closing", async () => {
    const { onSave } = setup();
    fireEvent.click(cardOpenButton("最初"));
    fireEvent.change(screen.getByRole("textbox", { name: "メモのタイトル" }), { target: { value: "更新後" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown本文" }), { target: { value: "## 見出し\n\n内容" } });
    fireEvent.click(screen.getByRole("button", { name: "表示" }));
    expect(screen.getByRole("heading", { name: "見出し" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: "更新後", markdown: "## 見出し\n\n内容" })));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("applies keyboard formatting without losing the selection", async () => {
    setup();
    fireEvent.click(cardOpenButton("最初"));
    const textarea = screen.getByRole("textbox", { name: "Markdown本文" }) as HTMLTextAreaElement;
    textarea.setSelectionRange(2, 4);
    fireEvent.keyDown(textarea, { key: "b", ctrlKey: true });
    expect(textarea).toHaveValue("****本文****");
    await waitFor(() => {
      expect(textarea.selectionStart).toBe(4);
      expect(textarea.selectionEnd).toBe(6);
    });
  });

  it("renders source line breaks and code blocks, and toggles tasks in preview", () => {
    const markdown = "1行目\n2行目\n\n- [ ] 確認する\n\n```ts\nconst value = 1;\n```";
    const { onCardsChange } = setup([{ ...cards[0], markdown }]);
    fireEvent.click(cardOpenButton("最初"));
    fireEvent.click(screen.getByRole("button", { name: "表示" }));

    const dialog = screen.getByRole("dialog");
    const firstLine = within(dialog).getByText(/1行目/);
    expect(firstLine.querySelector("br")).toBeInTheDocument();
    const code = dialog.querySelector("code.language-ts")!;
    expect(code).toHaveTextContent("const value = 1;");
    expect(code.closest("pre")).toBeInTheDocument();
    expect(code).toHaveClass("language-ts");

    const checkbox = within(dialog).getByRole("checkbox");
    expect(checkbox).toBeEnabled();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(onCardsChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ markdown: markdown.replace("- [ ] 確認する", "- [x] 確認する") })
    ]));
  });

  it("toggles and saves a task directly from a card without opening the editor", async () => {
    const { onSave } = setup([{ ...cards[0], markdown: "- [ ] カードで確認" }]);
    const card = screen.getByText("最初").closest("article")!;
    const checkbox = within(card).getByRole("checkbox");

    expect(checkbox).toBeEnabled();
    fireEvent.click(checkbox);

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ markdown: "- [x] カードで確認" })));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the editor open when saving fails", async () => {
    const props = setup();
    props.onSave.mockRejectedValueOnce(new Error("save failed"));
    fireEvent.click(cardOpenButton("最初"));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown本文" }), { target: { value: "未保存" } });
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    await waitFor(() => expect(props.onError).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens the editor after a click with slight pointer movement", () => {
    const { onReorder } = setup();
    const card = cardOpenButton("最初");
    fireEvent.pointerDown(card, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 12, clientY: 12 });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 12, clientY: 12 });
    fireEvent.click(card, { detail: 1 });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onReorder).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /を後へ移動|を前へ移動|をドラッグして/ })).not.toBeInTheDocument();
  });

  it("carries a card preview from the grab point and removes it on drop", () => {
    setup();
    const card = cardOpenButton("最初");
    const article = card.closest("article")!;
    vi.spyOn(article, "getBoundingClientRect").mockReturnValue({ left: 20, top: 30, width: 240, height: 150 } as DOMRect);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => article) });
    fireEvent.pointerDown(card, { button: 0, pointerId: 1, clientX: 50, clientY: 60 });
    expect(document.querySelector(".note-card-drag-preview")).toBeNull();
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 100, clientY: 120 });
    const preview = document.querySelector(".note-card-drag-preview")!;
    expect(preview).toHaveStyle({ left: "70px", top: "90px", width: "240px", height: "150px" });
    expect(preview).toHaveAttribute("aria-hidden", "true");
    expect(preview).toHaveTextContent("最初");
    expect(article).toHaveClass("dragging");
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 130, clientY: 140 });
    expect(preview).toHaveStyle({ left: "100px", top: "110px" });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 130, clientY: 140 });
    expect(document.querySelector(".note-card-drag-preview")).toBeNull();
    expect(article).not.toHaveClass("dragging");
  });

  it("reorders by dragging the card without opening the editor, then allows another click", async () => {
    const { onReorder } = setup();
    const target = screen.getByText("次").closest("article");
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => target) });
    const card = cardOpenButton("最初");
    fireEvent.pointerDown(card, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.click(card, { detail: 1 });
    await waitFor(() => expect(onReorder).toHaveBeenCalledWith([2, 1]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.pointerDown(card, { button: 0, pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(card, { pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.click(card, { detail: 1 });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it.each(["outside", "cancel", "lost capture"])("does not reorder or edit after %s", (end) => {
    const { onReorder } = setup();
    const target = screen.getByText("次").closest("article");
    const hitTest = vi.fn(() => target);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hitTest });
    const card = cardOpenButton("最初");
    fireEvent.pointerDown(card, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 100, clientY: 100 });
    if (end === "outside") {
      hitTest.mockReturnValue(null);
      fireEvent.pointerUp(card, { pointerId: 1, clientX: 500, clientY: 500 });
    } else if (end === "cancel") fireEvent.pointerCancel(card, { pointerId: 1 });
    else fireEvent.lostPointerCapture(card, { pointerId: 1 });
    fireEvent.click(card, { detail: 1 });
    expect(document.querySelector(".note-card-drag-preview")).toBeNull();
    expect(onReorder).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("deletes a card after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onDelete } = setup();
    fireEvent.click(cardOpenButton("最初"));
    fireEvent.click(screen.getByRole("button", { name: "メモを削除" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
