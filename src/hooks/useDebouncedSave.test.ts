// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDebouncedSave } from "./useDebouncedSave";

describe("useDebouncedSave", () => {
  it("keeps a failed value dirty so an explicit retry can save it", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("save failed")).mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ value }) => useDebouncedSave(value, save, 60_000), { initialProps: { value: "initial" } });
    rerender({ value: "changed" });

    await expect(result.current()).rejects.toThrow("save failed");
    await result.current();

    expect(save).toHaveBeenNthCalledWith(1, "changed");
    expect(save).toHaveBeenNthCalledWith(2, "changed");
  });

  it("waits for an active save and then persists edits made while it was active", async () => {
    let finishFirst!: () => void;
    const save = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }))
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ value }) => useDebouncedSave(value, save, 60_000), { initialProps: { value: "initial" } });
    rerender({ value: "first" });

    const firstSave = result.current();
    rerender({ value: "second" });
    let finished = false;
    const flushLatest = result.current().then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);

    finishFirst();
    await Promise.all([firstSave, flushLatest]);
    expect(save.mock.calls.map(([value]) => value)).toEqual(["first", "second"]);
  });
});
