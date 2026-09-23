import { describe, expect, it } from "vitest";
import { canGoForward, formatPeriodLabel, isCurrentPeriod, periodRange, previousRange, shiftPeriod } from "./period";

describe("period helpers", () => {
  it("builds a Monday-based week around the anchor", () => {
    // 2026-09-23 は水曜。
    expect(periodRange("week", "2026-09-23")).toEqual({ start: "2026-09-21", end: "2026-09-27" });
    // 週内のどの日を起点にしても同じ範囲になる。
    expect(periodRange("week", "2026-09-27")).toEqual({ start: "2026-09-21", end: "2026-09-27" });
  });

  it("builds a calendar month around the anchor", () => {
    expect(periodRange("month", "2026-09-23")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(periodRange("month", "2028-02-15")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });

  it("moves a month without skipping short months", () => {
    // 1/31 から前の月へ動いても 12 月ではなく 12/31 起点にならず、12 月の範囲になる。
    expect(periodRange("month", shiftPeriod("month", "2026-01-31", -1))).toEqual({ start: "2025-12-01", end: "2025-12-31" });
    // 3/31 の1か月前は 2 月（30日や31日が無くても飛ばさない）。
    expect(periodRange("month", shiftPeriod("month", "2026-03-31", -1))).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("moves weeks across a year boundary", () => {
    expect(periodRange("week", shiftPeriod("week", "2027-01-01", -1))).toEqual({ start: "2026-12-21", end: "2026-12-27" });
  });

  it("finds the previous period of the same length", () => {
    expect(previousRange("week", "2026-09-23")).toEqual({ start: "2026-09-14", end: "2026-09-20" });
    expect(previousRange("month", "2026-09-23")).toEqual({ start: "2026-08-01", end: "2026-08-31" });
  });

  it("labels weeks and months readably", () => {
    expect(formatPeriodLabel("week", periodRange("week", "2026-09-23"))).toBe("2026年9月21日 〜 9月27日");
    expect(formatPeriodLabel("month", periodRange("month", "2026-09-23"))).toBe("2026年9月");
    // 年をまたぐ週は終わり側にも年を付ける。
    expect(formatPeriodLabel("week", periodRange("week", "2026-12-31"))).toBe("2026年12月28日 〜 2027年1月3日");
  });

  it("does not allow moving past today", () => {
    const today = "2026-09-23";
    expect(isCurrentPeriod("week", today, today)).toBe(true);
    expect(canGoForward("week", today, today)).toBe(false);
    expect(canGoForward("week", "2026-09-16", today)).toBe(true);
    expect(isCurrentPeriod("month", "2026-08-10", today)).toBe(false);
  });
});
