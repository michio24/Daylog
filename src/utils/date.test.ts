import { describe, expect, it } from "vitest";
import { addDaysToDateKey, formatLongDate, localDateKey } from "./date";

describe("date utilities", () => {
  it("uses a local YYYY-MM-DD key", () => expect(localDateKey(new Date(2026, 8, 3, 23))).toBe("2026-09-03"));
  it("formats a Japanese local date", () => expect(formatLongDate("2026-09-03")).toContain("2026年9月3日"));
  it("moves across month and year boundaries", () => {
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateKey("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("handles leap days", () => expect(addDaysToDateKey("2028-02-28", 1)).toBe("2028-02-29"));
});
