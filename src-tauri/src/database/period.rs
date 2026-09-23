//! 期間を横断した集計。週次・月次のふりかえり画面が使う。
//!
//! 日単位の件数の数え方はこのモジュールに集約し、カレンダーの件数バッジ
//! （[`Database::calendar`]）もここに委譲している。二か所で数え方がずれると
//! 「カレンダーでは記録ありなのに統計では0日」といった食い違いが起きるため。

use super::Database;
use crate::models::*;
use chrono::{Datelike, NaiveDate};
use rusqlite::{params, Connection};
use std::collections::HashMap;

/// 1日ぶんの件数を数える SQL。`?1`〜`?2` が期間の両端（両方含む）。
const DAILY_SQL: &str = "SELECT d.day_date,d.is_closed,
     (SELECT COUNT(*) FROM tasks t WHERE t.day_id=d.id),
     (SELECT COUNT(*) FROM tasks t WHERE t.day_id=d.id AND t.is_completed=1),
     (SELECT COUNT(*) FROM entries e WHERE e.day_id=d.id),
     (SELECT COUNT(*) FROM note_cards n WHERE n.day_id=d.id),
     CASE WHEN COALESCE(r.good,'')<>'' OR COALESCE(r.bad,'')<>'' OR COALESCE(r.carry_over,'')<>'' THEN 1 ELSE 0 END
   FROM days d LEFT JOIN reviews r ON r.day_id=d.id
   WHERE d.day_date BETWEEN ?1 AND ?2 ORDER BY d.day_date";

/// 期間の長さの上限。UI は週か月しか出さないが、不正な入力で全期間を
/// 舐めてしまわないよう歯止めを置く。
const MAX_DAYS: i64 = 400;

pub fn parse_date(value: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| "日付が不正です".to_string())
}

fn validate_range(start: &str, end: &str) -> Result<(NaiveDate, NaiveDate), String> {
    let from = parse_date(start)?;
    let to = parse_date(end)?;
    if from > to {
        return Err("開始日が終了日より後です".into());
    }
    if (to - from).num_days() + 1 > MAX_DAYS {
        return Err(format!("期間が長すぎます（{MAX_DAYS}日まで）"));
    }
    Ok((from, to))
}

impl Database {
    /// 期間の各日の件数。記録がない日も 0 埋めで、開始日から終了日まで並ぶ。
    pub fn daily_stats(&self, start: &str, end: &str) -> Result<Vec<DayStat>, String> {
        let (from, to) = validate_range(start, end)?;
        let holidays = self.1.load()?;
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let recorded = Self::recorded_days(&conn, start, end)?;
        let custom = Self::custom_holidays_in(&conn, start, end)?;
        let mut rows = Vec::new();
        let mut date = from;
        while date <= to {
            let key = date.format("%Y-%m-%d").to_string();
            let mut stat = recorded.get(&key).cloned().unwrap_or_default();
            stat.date = key.clone();
            stat.national_holiday_name = holidays.get(&key).cloned();
            stat.custom_holiday_name = custom.get(&key).cloned();
            rows.push(stat);
            date = date.succ_opt().ok_or("日付を進められませんでした")?;
        }
        Ok(rows)
    }

    /// 期間内で実際に行がある日だけを返す。日付キーで引ける形。
    fn recorded_days(
        conn: &Connection,
        start: &str,
        end: &str,
    ) -> Result<HashMap<String, DayStat>, String> {
        let mut query = conn.prepare(DAILY_SQL).map_err(|e| e.to_string())?;
        let rows = query
            .query_map(params![start, end], |row| {
                Ok(DayStat {
                    date: row.get(0)?,
                    is_closed: row.get::<_, i64>(1)? != 0,
                    tasks_total: row.get(2)?,
                    tasks_completed: row.get(3)?,
                    entries: row.get(4)?,
                    notes: row.get(5)?,
                    has_review: row.get::<_, i64>(6)? != 0,
                    national_holiday_name: None,
                    custom_holiday_name: None,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows
            .into_iter()
            .map(|stat| (stat.date.clone(), stat))
            .collect())
    }

    fn custom_holidays_in(
        conn: &Connection,
        start: &str,
        end: &str,
    ) -> Result<HashMap<String, String>, String> {
        let mut query = conn
            .prepare("SELECT date,name FROM custom_holidays WHERE date BETWEEN ?1 AND ?2")
            .map_err(|e| e.to_string())?;
        let rows = query
            .query_map(params![start, end], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<HashMap<_, _>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    /// 期間の統計一式。`compare` に前期間を渡すと前期比を付けて返す。
    pub fn period_stats(
        &self,
        start: &str,
        end: &str,
        compare: Option<(&str, &str)>,
    ) -> Result<PeriodStats, String> {
        let daily = self.daily_stats(start, end)?;
        let totals = totals_of(&daily);
        let previous = match compare {
            Some((from, to)) => Some(totals_of(&self.daily_stats(from, to)?)),
            None => None,
        };
        let (streak_longest, streak_current) = streaks(&daily);
        let weekday_histogram = weekday_histogram(&daily);
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let tag_counts = Self::tag_counts(&conn, start, end)?;
        let icon_counts = Self::icon_counts(&conn, start, end)?;
        let hour_histogram = Self::hour_histogram(&conn, start, end)?;
        Ok(PeriodStats {
            start: start.into(),
            end: end.into(),
            totals,
            previous,
            daily,
            tag_counts,
            icon_counts,
            hour_histogram,
            weekday_histogram,
            streak_longest,
            streak_current,
        })
    }

    /// タグの使用回数。タスク・記録・メモの3つを横断して数える。
    fn tag_counts(conn: &Connection, start: &str, end: &str) -> Result<Vec<TagCount>, String> {
        let mut query = conn
            .prepare(
                "SELECT g.id,g.name,g.color,COUNT(*) FROM (
                   SELECT x.tag_id AS tid FROM task_tags x JOIN tasks t ON t.id=x.task_id JOIN days d ON d.id=t.day_id WHERE d.day_date BETWEEN ?1 AND ?2
                   UNION ALL
                   SELECT x.tag_id FROM entry_tags x JOIN entries e ON e.id=x.entry_id JOIN days d ON d.id=e.day_id WHERE d.day_date BETWEEN ?1 AND ?2
                   UNION ALL
                   SELECT x.tag_id FROM note_card_tags x JOIN note_cards n ON n.id=x.note_card_id JOIN days d ON d.id=n.day_id WHERE d.day_date BETWEEN ?1 AND ?2
                 ) u JOIN tags g ON g.id=u.tid GROUP BY g.id ORDER BY COUNT(*) DESC,g.name LIMIT 12",
            )
            .map_err(|e| e.to_string())?;
        let rows = query
            .query_map(params![start, end], |row| {
                Ok(TagCount {
                    tag: Tag {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        color: row.get(2)?,
                    },
                    count: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    /// 記録のアイコン別件数。`icon` は "name" か "name:color" なので名前でまとめる。
    fn icon_counts(conn: &Connection, start: &str, end: &str) -> Result<Vec<IconCount>, String> {
        let mut query = conn
            .prepare(
                "SELECT e.icon FROM entries e JOIN days d ON d.id=e.day_id WHERE d.day_date BETWEEN ?1 AND ?2 AND e.icon<>''",
            )
            .map_err(|e| e.to_string())?;
        let icons = query
            .query_map(params![start, end], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let mut counts: HashMap<String, i64> = HashMap::new();
        for icon in icons {
            let name = icon.split_once(':').map(|(n, _)| n).unwrap_or(&icon);
            *counts.entry(name.to_string()).or_default() += 1;
        }
        let mut rows: Vec<IconCount> = counts
            .into_iter()
            .map(|(icon, count)| IconCount { icon, count })
            .collect();
        // 件数の多い順。同数はアイコン名で安定させる。
        rows.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.icon.cmp(&b.icon)));
        rows.truncate(8);
        Ok(rows)
    }

    /// 時間帯別の記録件数。`occurred_at` は RFC3339 なので 12 文字目から 2 文字が「時」。
    fn hour_histogram(conn: &Connection, start: &str, end: &str) -> Result<Vec<i64>, String> {
        let mut query = conn
            .prepare(
                "SELECT CAST(substr(e.occurred_at,12,2) AS INTEGER),COUNT(*) FROM entries e JOIN days d ON d.id=e.day_id WHERE d.day_date BETWEEN ?1 AND ?2 GROUP BY 1",
            )
            .map_err(|e| e.to_string())?;
        let rows = query
            .query_map(params![start, end], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let mut histogram = vec![0; 24];
        for (hour, count) in rows {
            if (0..24).contains(&hour) {
                histogram[hour as usize] = count;
            }
        }
        Ok(histogram)
    }

    /// 期間の読み物（振り返り・未完了タスク・AIの一行）。
    pub fn period_digest(&self, start: &str, end: &str) -> Result<PeriodDigest, String> {
        validate_range(start, end)?;
        let conn = self.0.lock().map_err(|e| e.to_string())?;

        let mut query = conn
            .prepare(
                "SELECT d.day_date,r.good,r.bad,r.carry_over FROM reviews r JOIN days d ON d.id=r.day_id
                 WHERE d.day_date BETWEEN ?1 AND ?2 AND (TRIM(r.good)<>'' OR TRIM(r.bad)<>'' OR TRIM(r.carry_over)<>'')
                 ORDER BY d.day_date",
            )
            .map_err(|e| e.to_string())?;
        let reviews = query
            .query_map(params![start, end], |row| {
                Ok(DayReview {
                    date: row.get(0)?,
                    good: row.get(1)?,
                    bad: row.get(2)?,
                    carry_over: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        // 期間内の未完了タスクに加え、期限がこの期間に落ちるものも拾う。
        let mut query = conn
            .prepare(
                "SELECT t.id,d.day_date,t.title,t.due_at,t.carried_over FROM tasks t JOIN days d ON d.id=t.day_id
                 WHERE t.is_completed=0 AND (d.day_date BETWEEN ?1 AND ?2 OR (t.due_at IS NOT NULL AND substr(t.due_at,1,10) BETWEEN ?1 AND ?2))
                 ORDER BY COALESCE(substr(t.due_at,1,10),d.day_date),t.sort_order,t.id LIMIT 200",
            )
            .map_err(|e| e.to_string())?;
        let mut open_tasks = query
            .query_map(params![start, end], |row| {
                Ok(OpenTask {
                    id: row.get(0)?,
                    date: row.get(1)?,
                    title: row.get(2)?,
                    due_at: row.get(3)?,
                    carried_over: row.get::<_, i64>(4)? != 0,
                    tags: vec![],
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        for task in &mut open_tasks {
            task.tags = Self::task_tags(&conn, task.id)?;
        }

        // AIまとめは日ごとに最新の1件だけ。
        let mut query = conn
            .prepare(
                "SELECT d.day_date,a.one_line FROM ai_summaries a JOIN days d ON d.id=a.day_id
                 WHERE d.day_date BETWEEN ?1 AND ?2 AND COALESCE(a.one_line,'')<>''
                   AND a.id=(SELECT MAX(a2.id) FROM ai_summaries a2 WHERE a2.day_id=a.day_id)
                 ORDER BY d.day_date",
            )
            .map_err(|e| e.to_string())?;
        let ai_one_lines = query
            .query_map(params![start, end], |row| {
                Ok(DayLine {
                    date: row.get(0)?,
                    one_line: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(PeriodDigest {
            reviews,
            open_tasks,
            ai_one_lines,
        })
    }

    /// 1年前・2年前…の同じ日。記録がある年だけを新しい順に返す。
    pub fn on_this_day(&self, date: &str, years_back: u32) -> Result<Vec<DayData>, String> {
        let target = parse_date(date)?;
        let mut days = Vec::new();
        for back in 1..=years_back.min(10) {
            let year = target.year() - back as i32;
            // 2月29日は、その年にうるう日がなければ2月28日に寄せる。
            let same_day = NaiveDate::from_ymd_opt(year, target.month(), target.day())
                .or_else(|| NaiveDate::from_ymd_opt(year, target.month(), target.day() - 1));
            let Some(same_day) = same_day else { continue };
            let key = same_day.format("%Y-%m-%d").to_string();
            if !self.day_exists(&key)? {
                continue;
            }
            let day = self.get_day(&key)?;
            if !day.tasks.is_empty()
                || !day.entries.is_empty()
                || !day.notes.is_empty()
                || !day.review.good.trim().is_empty()
                || !day.review.bad.trim().is_empty()
                || !day.review.carry_over.trim().is_empty()
            {
                days.push(day);
            }
        }
        Ok(days)
    }

    /// `get_day` は行が無ければ作ってしまうので、存在確認は別に行う。
    fn day_exists(&self, date: &str) -> Result<bool, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM days WHERE day_date=?1)",
            [date],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())
    }
}

fn totals_of(daily: &[DayStat]) -> PeriodTotals {
    PeriodTotals {
        days_in_range: daily.len() as i64,
        days_recorded: daily.iter().filter(|d| d.has_record()).count() as i64,
        days_closed: daily.iter().filter(|d| d.is_closed).count() as i64,
        tasks_total: daily.iter().map(|d| d.tasks_total).sum(),
        tasks_completed: daily.iter().map(|d| d.tasks_completed).sum(),
        entries_total: daily.iter().map(|d| d.entries).sum(),
        notes_total: daily.iter().map(|d| d.notes).sum(),
        reviews_written: daily.iter().filter(|d| d.has_review).count() as i64,
    }
}

/// 期間内の連続記録日数（最長, 期間末までの現在の連続）。
fn streaks(daily: &[DayStat]) -> (i64, i64) {
    let mut longest = 0;
    let mut run = 0;
    for day in daily {
        if day.has_record() {
            run += 1;
            longest = longest.max(run);
        } else {
            run = 0;
        }
    }
    // `run` はループを抜けた時点で「末尾から続いている日数」になっている。
    (longest, run)
}

/// 日曜(0)〜土曜(6)それぞれの記録量。
fn weekday_histogram(daily: &[DayStat]) -> Vec<i64> {
    let mut histogram = vec![0; 7];
    for day in daily {
        if let Ok(date) = parse_date(&day.date) {
            histogram[date.weekday().num_days_from_sunday() as usize] += day.total();
        }
    }
    histogram
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stat(date: &str, tasks: i64, done: i64, entries: i64, notes: i64, review: bool) -> DayStat {
        DayStat {
            date: date.into(),
            tasks_total: tasks,
            tasks_completed: done,
            entries,
            notes,
            has_review: review,
            ..DayStat::default()
        }
    }

    #[test]
    fn totals_sum_every_day_in_the_range() {
        let daily = vec![
            stat("2026-09-01", 2, 1, 3, 1, true),
            stat("2026-09-02", 0, 0, 0, 0, false),
            stat("2026-09-03", 1, 1, 0, 2, false),
        ];
        let totals = totals_of(&daily);
        assert_eq!(totals.days_in_range, 3);
        assert_eq!(totals.days_recorded, 2);
        assert_eq!(totals.tasks_total, 3);
        assert_eq!(totals.tasks_completed, 2);
        assert_eq!(totals.entries_total, 3);
        assert_eq!(totals.notes_total, 3);
        assert_eq!(totals.reviews_written, 1);
    }

    #[test]
    fn streaks_count_the_longest_and_the_trailing_run() {
        let daily = vec![
            stat("2026-09-01", 1, 0, 0, 0, false),
            stat("2026-09-02", 1, 0, 0, 0, false),
            stat("2026-09-03", 0, 0, 0, 0, false),
            stat("2026-09-04", 1, 0, 0, 0, false),
        ];
        assert_eq!(streaks(&daily), (2, 1));

        // 末尾が空なら現在の連続は 0。
        let broken = vec![
            stat("2026-09-01", 1, 0, 0, 0, false),
            stat("2026-09-02", 0, 0, 0, 0, false),
        ];
        assert_eq!(streaks(&broken), (1, 0));

        assert_eq!(streaks(&[]), (0, 0));
    }

    #[test]
    fn a_review_alone_counts_as_a_record() {
        assert!(stat("2026-09-01", 0, 0, 0, 0, true).has_record());
        assert!(!stat("2026-09-01", 0, 0, 0, 0, false).has_record());
    }

    #[test]
    fn weekday_histogram_places_each_day_correctly() {
        // 2026-09-01 は火曜（日曜起点で 2）。
        let histogram = weekday_histogram(&[stat("2026-09-01", 1, 0, 2, 0, false)]);
        assert_eq!(histogram[2], 3);
        assert_eq!(histogram.iter().sum::<i64>(), 3);
    }

    #[test]
    fn rejects_an_invalid_or_reversed_range() {
        assert!(validate_range("2026-09-01", "2026-08-01").is_err());
        assert!(validate_range("2026-13-01", "2026-13-02").is_err());
        assert!(validate_range("2026-01-01", "2027-12-31").is_err());
        assert!(validate_range("2026-09-01", "2026-09-01").is_ok());
    }
}
