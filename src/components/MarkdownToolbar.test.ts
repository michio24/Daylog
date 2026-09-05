// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { applyMarkdownEdit } from "./MarkdownToolbar";

describe("applyMarkdownEdit", () => {
  it("wraps the selection and keeps it selected", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "before text after";
    textarea.setSelectionRange(7, 11);
    const result = applyMarkdownEdit(textarea, textarea.value, { before: "**", after: "**" });
    expect(result).toEqual({ value: "before **text** after", start: 9, end: 13 });
  });

  it("prefixes every selected line", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "one\ntwo";
    textarea.setSelectionRange(0, textarea.value.length);
    expect(applyMarkdownEdit(textarea, textarea.value, { before: "", linePrefix: "- [ ] " }).value).toBe("- [ ] one\n- [ ] two");
  });
});
