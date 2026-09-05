// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../services/api";
import { localDateKey } from "../utils/date";
import { CalendarPanel } from "./CalendarPanel";

vi.mock("../services/api", () => ({ api: { calendar: vi.fn(), setCustomHoliday: vi.fn(), deleteCustomHoliday: vi.fn() } }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.calendar).mockResolvedValue([]);
  vi.mocked(api.setCustomHoliday).mockImplementation(async (date, name) => ({ date, name }));
  vi.mocked(api.deleteCustomHoliday).mockResolvedValue();
});

describe("CalendarPanel", () => {
  it("loads the selected month, marks the date, and permits future navigation when requested", async () => {
    const onSelectDate = vi.fn();
    render(<CalendarPanel selectedDate="2026-09-05" allowFutureMonths onSelectDate={onSelectDate}/>);
    await waitFor(() => expect(api.calendar).toHaveBeenCalledWith(2026, 9));
    expect(screen.getByRole("button", { name: "2026-09-05" })).toHaveClass("selected");

    fireEvent.click(screen.getByRole("button", { name: "次の月" }));
    await waitFor(() => expect(api.calendar).toHaveBeenCalledWith(2026, 10));
    await waitFor(() => expect(screen.getByRole("button", { name: "2026-10-15" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "2026-10-15" }));
    expect(onSelectDate).toHaveBeenCalledWith("2026-10-15");
  });

  it("does not navigate beyond the current month in history mode", async () => {
    const today = localDateKey();
    render(<CalendarPanel selectedDate={today} onSelectDate={() => undefined}/>);
    await waitFor(() => expect(api.calendar).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "次の月" })).toBeDisabled();
  });

  it("follows a changed selected date", async () => {
    const { rerender } = render(<CalendarPanel selectedDate="2025-02-01" onSelectDate={() => undefined}/>);
    await waitFor(() => expect(api.calendar).toHaveBeenCalledWith(2025, 2));
    rerender(<CalendarPanel selectedDate="2025-11-03" onSelectDate={() => undefined}/>);
    await waitFor(() => expect(api.calendar).toHaveBeenCalledWith(2025, 11));
    expect(screen.getByText("2025年 11月")).toBeInTheDocument();
  });

  it("marks weekends and holidays, then saves and removes a custom holiday", async () => {
    vi.mocked(api.calendar).mockResolvedValue([
      { date: "2026-09-05", count: 0, isClosed: false },
      { date: "2026-09-22", count: 0, isClosed: false, nationalHolidayName: "休日" }
    ]);
    const onHolidayChange = vi.fn();
    render(<div className="app-shell"><CalendarPanel selectedDate="2026-09-22" onSelectDate={() => undefined} onHolidayChange={onHolidayChange}/></div>);
    const nationalHoliday = await screen.findByRole("button", { name: "2026-09-22 休日" });
    expect(nationalHoliday).toHaveClass("holiday");
    expect(nationalHoliday).toHaveAttribute("title", "休日");
    expect(screen.getByRole("button", { name: "2026-09-05" })).toHaveClass("saturday");

    fireEvent.click(screen.getByRole("button", { name: "選択日の休日設定" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("国民の祝日")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("alert")).toHaveTextContent("休日名を入力してください");

    fireEvent.change(screen.getByRole("textbox", { name: "カスタム休日名" }), { target: { value: " 会社休業日 " } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.setCustomHoliday).toHaveBeenCalledWith("2026-09-22", "会社休業日"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onHolidayChange).toHaveBeenCalledWith("2026-09-22", "会社休業日");
    expect(screen.getByRole("button", { name: "2026-09-22 休日／会社休業日" })).toHaveClass("custom-holiday");

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "選択日の休日設定" }));
    fireEvent.click(await screen.findByRole("button", { name: "休日を解除" }));
    await waitFor(() => expect(api.deleteCustomHoliday).toHaveBeenCalledWith("2026-09-22"));
    expect(onHolidayChange).toHaveBeenLastCalledWith("2026-09-22", null);
  });
});
