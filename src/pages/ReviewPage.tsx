import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../services/api";
import type { DayData, PeriodDigest, PeriodKind, PeriodStats } from "../types";
import { formatLongDate, localDateKey } from "../utils/date";
import { canGoForward, formatPeriodLabel, isCurrentPeriod, periodRange, previousRange, shiftPeriod } from "../utils/period";
import { StatTile } from "../components/StatTile";
import { BarChart } from "../components/charts/BarChart";
import { Heatmap } from "../components/charts/Heatmap";
import { RatioBar } from "../components/charts/RatioBar";
import { TagChip } from "../components/TagChip";
import { EntryIcon } from "../components/EntryIcon";

const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];
const percentage = (part: number, whole: number) => whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;
/** 期限の日付部分だけを取り出す。 */
const dueDay = (dueAt?: string | null) => dueAt ? dueAt.slice(0, 10) : null;

interface Props { onOpenDate: (date: string) => void; onError: (message: string) => void; }

export function ReviewPage({ onOpenDate, onError }: Props) {
  const [kind, setKind] = useState<PeriodKind>("week");
  const [anchor, setAnchor] = useState(localDateKey());
  const [stats, setStats] = useState<PeriodStats | null>(null);
  const [digest, setDigest] = useState<PeriodDigest | null>(null);
  const [lastYear, setLastYear] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportMessage, setExportMessage] = useState("");
  const [exporting, setExporting] = useState(false);

  const range = useMemo(() => periodRange(kind, anchor), [kind, anchor]);
  const compare = useMemo(() => previousRange(kind, anchor), [kind, anchor]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    void Promise.all([
      api.periodStats(range.start, range.end, compare.start, compare.end),
      api.periodDigest(range.start, range.end)
    ]).then(([nextStats, nextDigest]) => {
      if (!live) return;
      setStats(nextStats); setDigest(nextDigest);
    }).catch((reason) => { if (live) onError(`ふりかえりを読み込めませんでした: ${String(reason)}`); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [range, compare, onError]);

  useEffect(() => {
    let live = true;
    void api.onThisDay(localDateKey(), 3)
      .then((days) => { if (live) setLastYear(days); })
      .catch(() => { if (live) setLastYear([]); });
    return () => { live = false; };
  }, []);

  // 期間の記録を1日1ファイルで書き出す。保存先はフォルダを選んでもらう。
  const exportPeriod = () => {
    setExportMessage("");
    void (async () => {
      try {
        const directory = await openDialog({ directory: true, title: "書き出し先のフォルダを選ぶ" });
        if (typeof directory !== "string") return;
        setExporting(true);
        const written = await api.exportPeriodMarkdown(range.start, range.end, directory);
        setExportMessage(`${written.length} 件を書き出しました：${directory}`);
      } catch (reason) {
        setExportMessage(`書き出せませんでした: ${String(reason)}`);
      } finally {
        setExporting(false);
      }
    })();
  };

  const totals = stats?.totals;
  const previous = stats?.previous ?? null;
  const forward = canGoForward(kind, anchor);
  const atCurrent = isCurrentPeriod(kind, anchor);

  return <main className="page"><div className="page-inner review-width">
    <div className="page-title"><span>REVIEW</span><h1>ふりかえり</h1></div>

    <div className="period-nav">
      <div className="segmented compact" role="group" aria-label="期間の単位">
        <button className={kind === "week" ? "active" : ""} aria-pressed={kind === "week"} onClick={() => setKind("week")}>週</button>
        <button className={kind === "month" ? "active" : ""} aria-pressed={kind === "month"} onClick={() => setKind("month")}>月</button>
      </div>
      <div className="period-move">
        <button type="button" aria-label="前の期間" onClick={() => setAnchor(shiftPeriod(kind, anchor, -1))}>‹</button>
        <strong>{formatPeriodLabel(kind, range)}</strong>
        <button type="button" aria-label="次の期間" disabled={!forward} onClick={() => setAnchor(shiftPeriod(kind, anchor, 1))}>›</button>
      </div>
      {!atCurrent && <button type="button" className="period-today" onClick={() => setAnchor(localDateKey())}>{kind === "week" ? "今週へ" : "今月へ"}</button>}
      <button type="button" className="period-export" disabled={exporting} onClick={exportPeriod}>{exporting ? "書き出しています…" : "Markdownで書き出す"}</button>
    </div>
    {exportMessage && <p className="review-export-message" role="status">{exportMessage}</p>}

    {loading && !stats ? <p className="empty">集計しています…</p> : stats && totals ? <>
      <div className="stat-strip">
        <StatTile label="記録した日" value={`${totals.daysRecorded} / ${totals.daysInRange}`} note={percentage(totals.daysRecorded, totals.daysInRange)} delta={previous ? totals.daysRecorded - previous.daysRecorded : null}/>
        <StatTile label="タスク完了" value={`${totals.tasksCompleted} / ${totals.tasksTotal}`} note={percentage(totals.tasksCompleted, totals.tasksTotal)} delta={previous ? totals.tasksCompleted - previous.tasksCompleted : null}/>
        <StatTile label="記録" value={String(totals.entriesTotal)} delta={previous ? totals.entriesTotal - previous.entriesTotal : null}/>
        <StatTile label="メモ" value={String(totals.notesTotal)} delta={previous ? totals.notesTotal - previous.notesTotal : null}/>
        <StatTile label="連続記録" value={`${stats.streakCurrent} 日`} note={`この期間の最長 ${stats.streakLongest} 日`}/>
        <StatTile label="振り返りを書いた日" value={`${totals.reviewsWritten} 日`} note={`完了した日 ${totals.daysClosed} 日`}/>
      </div>

      <section className="card review-card">
        <h2>記録のあった日</h2>
        <Heatmap days={stats.daily} onSelect={onOpenDate}/>
        <p className="review-hint">日付を押すと、その日を開きます。</p>
      </section>

      <div className="review-columns">
        <section className="card review-card">
          <h2>時間帯別の記録</h2>
          {stats.hourHistogram.some((value) => value > 0)
            ? <BarChart summary={`時間帯別の記録件数。最も多いのは${stats.hourHistogram.indexOf(Math.max(...stats.hourHistogram))}時台。`} labelEvery={3} bars={stats.hourHistogram.map((value, hour) => ({ label: String(hour), value, title: `${hour}時台: ${value}件` }))}/>
            : <p className="empty">この期間に記録はありません。</p>}
        </section>
        <section className="card review-card">
          <h2>曜日別の記録量</h2>
          {stats.weekdayHistogram.some((value) => value > 0)
            ? <BarChart summary="曜日別の記録量。" bars={stats.weekdayHistogram.map((value, index) => ({ label: weekdayLabels[index], value }))}/>
            : <p className="empty">この期間に記録はありません。</p>}
        </section>
      </div>

      <div className="review-columns">
        <section className="card review-card">
          <h2>よく使ったタグ</h2>
          {stats.tagCounts.length
            ? <ul className="review-tag-counts">{stats.tagCounts.map(({ tag, count }) => <li key={tag.id}><TagChip tag={tag}/><span>{count}</span></li>)}</ul>
            : <p className="empty">この期間にタグは使われていません。</p>}
        </section>
        <section className="card review-card">
          <h2>記録の種類</h2>
          {stats.iconCounts.length
            ? <ul className="review-icon-counts">{stats.iconCounts.map(({ icon, count }) => <li key={icon}><EntryIcon icon={icon}/><span>{count}</span></li>)}</ul>
            : <p className="empty">アイコン付きの記録はありません。</p>}
        </section>
      </div>

      {stats.tagCounts.length > 0 && <section className="card review-card">
        <h2>タグの内訳</h2>
        <RatioBar summary="タグ別の使用回数。" slices={stats.tagCounts.map(({ tag, count }) => ({ label: tag.name, value: count }))}/>
      </section>}

      <section className="card review-card">
        <h2>この期間の振り返り</h2>
        {digest?.reviews.length
          ? <ul className="review-timeline">{digest.reviews.map((review) => <li key={review.date}>
              <button type="button" className="review-date" onClick={() => onOpenDate(review.date)}>{formatLongDate(review.date)}</button>
              <dl>
                {review.good.trim() && <><dt>よかったこと</dt><dd>{review.good}</dd></>}
                {review.bad.trim() && <><dt>うまくいかなかったこと</dt><dd>{review.bad}</dd></>}
                {review.carryOver.trim() && <><dt>持ち越し</dt><dd>{review.carryOver}</dd></>}
              </dl>
            </li>)}</ul>
          : <p className="empty">この期間に書かれた振り返りはありません。</p>}
      </section>

      {digest && digest.aiOneLines.length > 0 && <section className="card review-card">
        <h2>AIの一行まとめ</h2>
        <ul className="review-lines">{digest.aiOneLines.map((line) => <li key={line.date}>
          <button type="button" className="review-date" onClick={() => onOpenDate(line.date)}>{formatLongDate(line.date)}</button>
          <p>{line.oneLine}</p>
        </li>)}</ul>
      </section>}

      <section className="card review-card">
        <h2>まだ終わっていないタスク</h2>
        {digest?.openTasks.length
          ? <ul className="review-open-tasks">{digest.openTasks.map((task) => {
              const due = dueDay(task.dueAt);
              const overdue = due !== null && due < localDateKey();
              return <li key={task.id}>
                <button type="button" className="review-date" onClick={() => onOpenDate(task.date)}>{task.date.slice(5)}</button>
                <span className="review-task-title">{task.title}</span>
                {due && <em className={overdue ? "overdue" : ""}>{overdue ? "期限超過 " : "期限 "}{due.slice(5)}</em>}
                {task.carriedOver && <em>持ち越し</em>}
                {task.tags.map((tag) => <TagChip key={tag.id} tag={tag}/>)}
              </li>;
            })}</ul>
          : <p className="empty">未完了のタスクはありません。</p>}
      </section>

      {lastYear.length > 0 && <section className="card review-card">
        <h2>去年の今日</h2>
        <ul className="review-lines">{lastYear.map((day) => <li key={day.dayDate}>
          <button type="button" className="review-date" onClick={() => onOpenDate(day.dayDate)}>{formatLongDate(day.dayDate)}</button>
          <p>{[...day.entries.map((entry) => entry.body), ...day.notes.map((note) => note.title)].filter(Boolean).slice(0, 2).join(" / ") || `タスク ${day.tasks.length} 件`}</p>
        </li>)}</ul>
      </section>}
    </> : null}
  </div></main>;
}
