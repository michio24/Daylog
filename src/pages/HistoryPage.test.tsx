// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../services/api";
import type { DayData } from "../types";
import { localDateKey } from "../utils/date";
import { HistoryPage } from "./HistoryPage";

vi.mock("../services/api", () => ({ api: { calendar: vi.fn(), getDay: vi.fn() } }));

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.calendar).mockResolvedValue([]); });

describe("HistoryPage", () => {
  it("keeps the calendar preview and opens the selected day", async () => {
    const date = localDateKey();
    const selected: DayData = { id: 1, dayDate: date, isClosed: true, tasks: [], entries: [], notes: [], review: { good: "", bad: "", carryOver: "" }, nationalHolidayName: "休日", customHolidayName: "会社休業日" };
    vi.mocked(api.getDay).mockResolvedValue(selected);
    const onOpenDay = vi.fn();
    render(<HistoryPage onOpenDay={onOpenDay}/>);
    const dateButton = screen.getByRole("button", { name: date });
    await waitFor(() => expect(dateButton).toBeEnabled());
    fireEvent.click(dateButton);

    expect(await screen.findByRole("heading", { name: "完了した記録" })).toBeInTheDocument();
    expect(screen.getByText("休日／会社休業日")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "この日を開く" }));
    expect(onOpenDay).toHaveBeenCalledWith(selected);
  });
});
