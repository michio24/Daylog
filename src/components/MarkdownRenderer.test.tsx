// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CSSProperties } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownRenderer } from "./MarkdownRenderer";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn().mockResolvedValue({ svg: "<svg></svg>" })
}));

vi.mock("mermaid", () => ({ default: mermaid }));

vi.mock("../services/api", () => ({ api: {
  getAttachment: vi.fn().mockRejectedValue(new Error("missing")),
  openAttachment: vi.fn()
} }));

afterEach(cleanup);

describe("MarkdownRenderer", () => {
  it("renders GFM tables, math, and guarded external images without raw HTML", () => {
    const { container } = render(<div className="markdown"><MarkdownRenderer interactive markdown={'| A | B |\n| - | - |\n| 1 | 2 |\n\n$E=mc^2$\n\n<img src="bad" />\n\n![remote](https://example.com/image.png)'}/></div>);
    expect(container.querySelector("table")).toBeInTheDocument();
    expect(container.querySelector(".katex")).toBeInTheDocument();
    expect(container.querySelector('img[src="bad"]')).not.toBeInTheDocument();
    expect(container.querySelector('img[src="https://example.com/image.png"]')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "画像を読み込む" }));
    expect(container.querySelector('img[src="https://example.com/image.png"]')).toBeInTheDocument();
  });

  it("uses a lightweight placeholder for Mermaid in compact cards", () => {
    render(<MarkdownRenderer compact markdown={'```mermaid\ngraph TD\nA-->B\n```'}/>);
    expect(screen.getByText("◇ Mermaid diagram")).toBeInTheDocument();
  });

  it("renders Mermaid with the app theme colors and redraws after a theme change", async () => {
    const light = { "--surface": "#ffffff", "--surface-3": "#fafafa", "--ink": "#111111", "--ink-2": "#333333", "--line-2": "#cccccc", "--accent": "#126b73", "--accent-soft": "#dce9e6", "--warm": "#a85c32", "--warm-soft": "#f3e2d4" } as CSSProperties;
    const dark = { ...light, "--surface": "#151c25", "--surface-3": "#1a232d", "--ink": "#edf3f7", "--accent": "#65c4cf", "--accent-soft": "#18343c" } as CSSProperties;
    const { rerender } = render(<div className="app-shell" data-theme="light" style={light}><MarkdownRenderer markdown={'```mermaid\ngraph TD\nA-->B\n```'}/></div>);

    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));
    expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({
      theme: "base",
      themeVariables: expect.objectContaining({ primaryColor: "#dce9e6", primaryTextColor: "#111111", primaryBorderColor: "#126b73" })
    }));

    rerender(<div className="app-shell" data-theme="dark" style={dark}><MarkdownRenderer markdown={'```mermaid\ngraph TD\nA-->B\n```'}/></div>);
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2));
    expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({
      themeVariables: expect.objectContaining({ primaryColor: "#18343c", primaryTextColor: "#edf3f7", primaryBorderColor: "#65c4cf" })
    }));
  });

  it("shows a broken local attachment in interactive views", async () => {
    render(<MarkdownRenderer interactive markdown="[file](daylog-attachment:00000000-0000-0000-0000-000000000000)"/>);
    expect(await screen.findByText("file（見つかりません）")).toBeInTheDocument();
  });
});
