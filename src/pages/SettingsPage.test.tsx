// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";
import { api } from "../services/api";
import type { Settings } from "../types";

vi.mock("../services/api", () => ({
  api: {
    updateNationalHolidays: vi.fn(),
    createBackup: vi.fn()
  }
}));

const settings: Settings = {
  aiEnabled: false,
  modelPath: "",
  backend: "Auto",
  contextSize: null,
  generationLength: "標準",
  backupGenerations: 30,
  theme: "light",
  layout: "one"
};

afterEach(cleanup);

describe("SettingsPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the downloaded record count and refreshes the current day", async () => {
    vi.mocked(api.updateNationalHolidays).mockResolvedValue({ count: 1070, latestDate: "2028-11-23" });
    const onHolidayUpdated = vi.fn().mockResolvedValue(undefined);
    render(<SettingsPage settings={settings} onChange={vi.fn()} onHolidayUpdated={onHolidayUpdated}/>);

    fireEvent.click(screen.getByRole("button", { name: "公式データから更新" }));

    expect(screen.getByRole("button", { name: "更新中…" })).toBeDisabled();
    expect(await screen.findByRole("status")).toHaveTextContent("1070件に更新しました（最終日: 2028-11-23）");
    expect(onHolidayUpdated).toHaveBeenCalledTimes(1);
  });

  it("prevents duplicate requests and reports an update error", async () => {
    let rejectUpdate!: (error: Error) => void;
    vi.mocked(api.updateNationalHolidays).mockImplementation(() => new Promise((_, reject) => { rejectUpdate = reject; }));
    render(<SettingsPage settings={settings} onChange={vi.fn()} onHolidayUpdated={vi.fn()}/>);

    const button = screen.getByRole("button", { name: "公式データから更新" });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "更新中…" }));
    expect(api.updateNationalHolidays).toHaveBeenCalledTimes(1);
    rejectUpdate(new Error("network failed"));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("network failed"));
    expect(screen.getByRole("button", { name: "公式データから更新" })).toBeEnabled();
  });

  it("clamps backup generations and does not save an empty value", () => {
    const onChange = vi.fn();
    render(<SettingsPage settings={settings} onChange={onChange} onHolidayUpdated={vi.fn()}/>);
    const input = screen.getByRole("spinbutton", { name: "保存する世代数" });

    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, backupGenerations: 1 });
    expect(input).toHaveValue(1);

    fireEvent.change(input, { target: { value: "366" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, backupGenerations: 365 });
    expect(input).toHaveValue(365);

    onChange.mockClear();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue(30);

    for (const value of ["1", "365"]) {
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
      expect(onChange).toHaveBeenLastCalledWith({ ...settings, backupGenerations: Number(value) });
    }
  });
});
