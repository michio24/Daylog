// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineSection } from "./TimelineSection";

afterEach(cleanup);

describe("TimelineSection", () => {
  it("shows every line of a multiline entry", () => {
    const { container } = render(<TimelineSection entries={[{
      id: 1,
      entryType: "memo",
      body: "最初の行\n2行目\n3行目",
      occurredAt: "2026-09-05T09:00:00+09:00"
    }]} disabled={false} onAdd={vi.fn()} onType={vi.fn()} onDelete={vi.fn()}/>);

    expect(screen.getByText("最初の行")).toBeInTheDocument();
    expect(container.querySelector(".timeline-content p")).toHaveTextContent("2行目\n3行目", { normalizeWhitespace: false });
  });

  it("submits a multiline draft without dropping lines", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<TimelineSection entries={[]} disabled={false} onAdd={onAdd} onType={vi.fn()} onDelete={vi.fn()}/>);
    const input = screen.getByPlaceholderText("今あったことを書く…");

    fireEvent.change(input, { target: { value: "最初の行\n2行目" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("最初の行\n2行目", "memo"));
  });
});
