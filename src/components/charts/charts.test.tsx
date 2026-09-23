import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { BarChart } from "./BarChart";
import { Heatmap } from "./Heatmap";
import { RatioBar } from "./RatioBar";
import type { DayStat } from "../../types";

const day = (date: string, entries: number): DayStat => ({ date, tasksTotal: 0, tasksCompleted: 0, entries, notes: 0, hasReview: false, isClosed: false });

it("scales bars against the largest value and labels the chart", () => {
  const { container } = render(<BarChart summary="曜日別の記録量。" bars={[{ label: "月", value: 4 }, { label: "火", value: 2 }, { label: "水", value: 0 }]}/>);
  expect(screen.getByRole("img", { name: "曜日別の記録量。" })).toBeInTheDocument();
  const fills = container.querySelectorAll<HTMLElement>(".chart-bar-fill");
  expect(fills).toHaveLength(3);
  expect(fills[0].style.height).toBe("100%");
  expect(fills[1].style.height).toBe("50%");
  // 値0の棒は空として印を付け、0%のまま潰れないようにする。
  expect(fills[2].dataset.empty).toBe("true");
  // 数値も文字で出す（色や高さだけに情報を載せない）。
  expect(screen.getByText("4")).toBeInTheDocument();
});

it("draws a chart with all zeroes without dividing by zero", () => {
  const { container } = render(<BarChart summary="空の期間。" bars={[{ label: "月", value: 0 }, { label: "火", value: 0 }]}/>);
  for (const fill of container.querySelectorAll<HTMLElement>(".chart-bar-fill")) {
    expect(fill.style.height).toBe("0%");
  }
});

it("thins out labels when asked", () => {
  const { container } = render(<BarChart summary="時間帯。" labelEvery={3} bars={Array.from({ length: 6 }, (_, hour) => ({ label: String(hour), value: hour }))}/>);
  const labels = [...container.querySelectorAll(".chart-labels span")].map((node) => node.textContent);
  expect(labels).toEqual(["0", "", "", "3", "", ""]);
});

it("shades heatmap cells by volume and opens the day", () => {
  const onSelect = vi.fn();
  const { container } = render(<Heatmap days={[day("2026-09-21", 6), day("2026-09-22", 1), day("2026-09-23", 0)]} onSelect={onSelect}/>);
  const cells = container.querySelectorAll(".heatmap-cell:not(.heatmap-lead)");
  expect(cells[0].className).toContain("level-3");
  expect(cells[1].className).toContain("level-1");
  expect(cells[2].className).toContain("level-0");
  fireEvent.click(screen.getByRole("button", { name: /2026-09-22/ }));
  expect(onSelect).toHaveBeenCalledWith("2026-09-22");
});

it("pads the heatmap so the first day lands on its weekday", () => {
  // 2026-09-23 は水曜なので、月曜・火曜のぶん2マス空ける。
  const { container } = render(<Heatmap days={[day("2026-09-23", 1)]} onSelect={vi.fn()}/>);
  expect(container.querySelectorAll(".heatmap-lead")).toHaveLength(2);
});

it("renders every slice of a ratio bar with its value", () => {
  const { container } = render(<RatioBar summary="タグ別。" slices={[{ label: "仕事", value: 8 }, { label: "学び", value: 2 }]}/>);
  const fills = container.querySelectorAll<HTMLElement>(".ratio-fill");
  expect(fills[0].style.width).toBe("100%");
  expect(fills[1].style.width).toBe("25%");
  expect(screen.getByText("仕事")).toBeInTheDocument();
  expect(screen.getByText("8")).toBeInTheDocument();
});

it("handles an empty ratio bar", () => {
  const { container } = render(<RatioBar summary="空。" slices={[]}/>);
  expect(container.querySelectorAll(".ratio-fill")).toHaveLength(0);
});
