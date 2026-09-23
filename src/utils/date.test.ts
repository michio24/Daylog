import { describe, expect, it } from "vitest";
import { addDaysToDateKey, endOfMonth, endOfWeek, formatExportFileName, formatLongDate, formatNoteExportFileName, localDateKey, startOfMonth, startOfWeek, startOfYear } from "./date";

describe("date utilities", () => {
  it("formats the Markdown export file name with a zero-padded date and weekday", () => {
    expect(formatExportFileName("2026-09-05")).toBe("2026年09月05日(土).md");
  });
  it("creates a safe Markdown file name from a note title", () => {
    expect(formatNoteExportFileName(' 設計:メモ/案? ')).toBe("設計_メモ_案_.md");
    expect(formatNoteExportFileName("   ")).toBe("無題のメモ.md");
    expect(formatNoteExportFileName("CON")).toBe("CON_.md");
  });
  it("uses a local YYYY-MM-DD key", () => expect(localDateKey(new Date(2026, 8, 3, 23))).toBe("2026-09-03"));
  it("formats a Japanese local date", () => expect(formatLongDate("2026-09-03")).toContain("2026年9月3日"));
  it("moves across month and year boundaries", () => {
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateKey("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("handles leap days", () => expect(addDaysToDateKey("2028-02-28", 1)).toBe("2028-02-29"));
});

describe("period boundaries", () => {
  it("starts the week on Monday", () => {
    // 2026-09-23 は水曜。
    expect(startOfWeek("2026-09-23")).toBe("2026-09-21");
    expect(endOfWeek("2026-09-23")).toBe("2026-09-27");
    // 月曜そのものは動かない。
    expect(startOfWeek("2026-09-21")).toBe("2026-09-21");
    // 日曜は前の月曜に戻る（週の最終日）。
    expect(startOfWeek("2026-09-27")).toBe("2026-09-21");
  });
  it("handles weeks that cross a year boundary", () => {
    // 2027-01-01 は金曜なので、その週は前年の月曜から始まる。
    expect(startOfWeek("2027-01-01")).toBe("2026-12-28");
    expect(endOfWeek("2026-12-28")).toBe("2027-01-03");
  });
  it("finds the first and last day of a month", () => {
    expect(startOfMonth("2026-09-23")).toBe("2026-09-01");
    expect(endOfMonth("2026-09-23")).toBe("2026-09-30");
    expect(endOfMonth("2026-12-01")).toBe("2026-12-31");
    // うるう年の2月。
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
  });
  it("finds the first day of a year", () => {
    expect(startOfYear("2026-09-23")).toBe("2026-01-01");
  });
});
