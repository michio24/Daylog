// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowControls } from "./WindowControls";

const windowApi = vi.hoisted(() => ({
  close: vi.fn(),
  isMaximized: vi.fn(),
  minimize: vi.fn(),
  onResized: vi.fn(),
  toggleMaximize: vi.fn()
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowApi
}));

describe("WindowControls", () => {
  let resizeHandler: (() => void) | undefined;
  const unlisten = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resizeHandler = undefined;
    windowApi.close.mockResolvedValue(undefined);
    windowApi.isMaximized.mockResolvedValue(false);
    windowApi.minimize.mockResolvedValue(undefined);
    windowApi.toggleMaximize.mockResolvedValue(undefined);
    windowApi.onResized.mockImplementation(async (handler: () => void) => {
      resizeHandler = handler;
      return unlisten;
    });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("does not render controls outside Tauri", () => {
    render(<WindowControls/>);
    expect(screen.queryByRole("group", { name: "ウィンドウ操作" })).not.toBeInTheDocument();
  });

  it("calls the matching window commands in Tauri", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    render(<WindowControls/>);

    fireEvent.click(await screen.findByRole("button", { name: "最小化" }));
    fireEvent.click(screen.getByRole("button", { name: "最大化" }));
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));

    expect(windowApi.minimize).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(windowApi.toggleMaximize).toHaveBeenCalledTimes(1));
    expect(windowApi.close).toHaveBeenCalledTimes(1);
  });

  it("tracks maximized state and remains inside the active theme", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const { unmount } = render(<div className="app-shell" data-theme="sakura"><WindowControls/></div>);

    const controls = await screen.findByRole("group", { name: "ウィンドウ操作" });
    expect(controls.closest('.app-shell[data-theme="sakura"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "最大化" })).toBeInTheDocument();

    windowApi.isMaximized.mockResolvedValue(true);
    resizeHandler?.();
    expect(await screen.findByRole("button", { name: "元のサイズに戻す" })).toBeInTheDocument();

    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
