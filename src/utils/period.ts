import type { PeriodKind } from "../types";
import { addDaysToDateKey, endOfMonth, endOfWeek, localDateKey, startOfMonth, startOfWeek } from "./date";

export interface Range { start: string; end: string; }

/** 基準日を含む週（月曜始まり）または月の範囲。 */
export const periodRange = (kind: PeriodKind, anchor: string): Range =>
  kind === "week"
    ? { start: startOfWeek(anchor), end: endOfWeek(anchor) }
    : { start: startOfMonth(anchor), end: endOfMonth(anchor) };

/**
 * 期間を前後に動かした先の基準日。
 *
 * 月を動かすときは月初を起点にする。月末（31日）から動かすと、日数の
 * 少ない月を飛び越してしまうため。
 */
export const shiftPeriod = (kind: PeriodKind, anchor: string, delta: number): string => {
  if (kind === "week") return addDaysToDateKey(anchor, delta * 7);
  const [year, month] = anchor.split("-").map(Number);
  const moved = new Date(year, month - 1 + delta, 1, 12);
  return localDateKey(moved);
};

/** 同じ長さの直前の期間。前期比に使う。 */
export const previousRange = (kind: PeriodKind, anchor: string): Range =>
  periodRange(kind, shiftPeriod(kind, anchor, -1));

/** 期間の見出し。週は「9月21日 〜 9月27日」、月は「2026年9月」。 */
export const formatPeriodLabel = (kind: PeriodKind, { start, end }: Range): string => {
  if (kind === "month") {
    const [year, month] = start.split("-").map(Number);
    return `${year}年${month}月`;
  }
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  const head = `${startYear}年${startMonth}月${startDay}日`;
  // 年をまたぐ週だけ、終わり側にも年を付ける。
  const tail = endYear === startYear ? `${endMonth}月${endDay}日` : `${endYear}年${endMonth}月${endDay}日`;
  return `${head} 〜 ${tail}`;
};

/** 今日を含む期間かどうか。「今週へ」ボタンと次へ移動の可否に使う。 */
export const isCurrentPeriod = (kind: PeriodKind, anchor: string, today = localDateKey()): boolean => {
  const current = periodRange(kind, anchor);
  return today >= current.start && today <= current.end;
};

/** 今日より後の期間には進ませない。 */
export const canGoForward = (kind: PeriodKind, anchor: string, today = localDateKey()): boolean =>
  periodRange(kind, shiftPeriod(kind, anchor, 1)).start <= today;
