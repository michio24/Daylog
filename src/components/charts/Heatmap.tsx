import type { DayStat } from "../../types";

interface Props {
  days: DayStat[];
  onSelect: (date: string) => void;
}

const weekdayLabels = ["月", "火", "水", "木", "金", "土", "日"];

/** 件数を4段階の濃さに割り当てる。0 は空セル。 */
const levelOf = (count: number, max: number) => {
  if (count <= 0) return 0;
  if (max <= 1) return 3;
  return Math.min(3, Math.ceil((count / max) * 3));
};

/**
 * 期間の記録量を日ごとのマスで見せる。
 *
 * カレンダー画面（CalendarPanel）とは責務が違う（あちらは日付選択・祝日編集を
 * 持つ）ので別部品にし、濃さの段階を表す `level-N` のクラス名だけを共有する。
 */
export function Heatmap({ days, onSelect }: Props) {
  const max = Math.max(0, ...days.map((day) => day.tasksTotal + day.entries + day.notes + (day.hasReview ? 1 : 0)));
  // 月曜始まりに揃えるため、先頭の曜日ぶんだけ空マスを置く。
  const first = days[0];
  const lead = first ? (new Date(`${first.date}T12:00:00`).getDay() + 6) % 7 : 0;
  return <div className="heatmap">
    <div className="heatmap-weekdays" aria-hidden="true">{weekdayLabels.map((label) => <span key={label}>{label}</span>)}</div>
    <div className="heatmap-grid">
      {Array.from({ length: lead }, (_, index) => <span key={`lead-${index}`} className="heatmap-cell heatmap-lead"/>)}
      {days.map((day) => {
        const count = day.tasksTotal + day.entries + day.notes + (day.hasReview ? 1 : 0);
        const holiday = day.nationalHolidayName ?? day.customHolidayName;
        return <button
          key={day.date}
          type="button"
          className={`heatmap-cell level-${levelOf(count, max)}${day.isClosed ? " closed" : ""}`}
          aria-label={`${day.date} ${count}件${holiday ? ` ${holiday}` : ""}${day.isClosed ? " 完了済み" : ""}`}
          title={`${day.date}・${count}件${holiday ? `・${holiday}` : ""}`}
          onClick={() => onSelect(day.date)}
        >{Number(day.date.slice(8))}</button>;
      })}
    </div>
  </div>;
}
