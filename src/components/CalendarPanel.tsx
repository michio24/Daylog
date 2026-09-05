import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../services/api";
import type { CalendarDay } from "../types";
import { formatHolidayNames, formatLongDate, localDateKey } from "../utils/date";

interface Props {
  selectedDate?: string;
  onSelectDate: (date: string) => void | Promise<void>;
  onHolidayChange?: (date: string, customHolidayName: string | null) => void;
  disabled?: boolean;
  allowFutureMonths?: boolean;
  compact?: boolean;
  onError?: (message: string) => void;
}

const monthStart = (dateKey?: string) => {
  if (!dateKey) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  const [year, month] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, 1);
};

export function CalendarPanel({ selectedDate, onSelectDate, onHolidayChange, disabled = false, allowFutureMonths = false, compact = false, onError }: Props) {
  const now = new Date();
  const [cursor, setCursor] = useState(() => monthStart(selectedDate));
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [holidayEditorOpen, setHolidayEditorOpen] = useState(false);
  const [holidayName, setHolidayName] = useState("");
  const [holidayError, setHolidayError] = useState("");
  const [holidaySaving, setHolidaySaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const holidayInputRef = useRef<HTMLInputElement>(null);
  const holidayOpenerRef = useRef<HTMLButtonElement | null>(null);
  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;

  useEffect(() => {
    if (selectedDate) setCursor(monthStart(selectedDate));
  }, [selectedDate]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api.calendar(year, month).then((value) => {
      if (!cancelled) setDays(value);
    }).catch((error) => {
      if (!cancelled) {
        setDays([]);
        onError?.(`カレンダーを読み込めませんでした: ${String(error)}`);
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month, onError, year]);

  useEffect(() => {
    if (!holidayEditorOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => holidayInputRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !holidaySaving) {
        event.preventDefault();
        setHolidayEditorOpen(false);
        window.setTimeout(() => holidayOpenerRef.current?.focus());
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKeyDown); };
  }, [holidayEditorOpen, holidaySaving]);

  const cells = useMemo(() => {
    const leading = new Date(year, month - 1, 1).getDay();
    const count = new Date(year, month, 0).getDate();
    const map = new Map(days.map((day) => [day.date, day]));
    return [...Array(leading).fill(null), ...Array.from({ length: count }, (_, index) => {
      const value = new Date(year, month - 1, index + 1);
      const date = localDateKey(value);
      return { date, weekday: value.getDay(), stat: map.get(date) };
    })];
  }, [days, month, year]);

  const selectedDay = days.find((day) => day.date === selectedDate);
  const openHolidayEditor = (opener: HTMLButtonElement) => {
    if (!selectedDate) return;
    holidayOpenerRef.current = opener;
    setHolidayName(selectedDay?.customHolidayName || "");
    setHolidayError("");
    setHolidayEditorOpen(true);
  };
  const closeHolidayEditor = () => {
    if (holidaySaving) return;
    setHolidayEditorOpen(false);
    window.setTimeout(() => holidayOpenerRef.current?.focus());
  };
  const updateHoliday = (name: string | null) => {
    if (!selectedDate) return;
    setDays((current) => current.map((day) => day.date === selectedDate ? { ...day, customHolidayName: name } : day));
    onHolidayChange?.(selectedDate, name);
  };
  const saveHoliday = async () => {
    if (!selectedDate || holidaySaving) return;
    const name = holidayName.trim();
    if (!name) { setHolidayError("休日名を入力してください。"); holidayInputRef.current?.focus(); return; }
    if ([...name].length > 80) { setHolidayError("休日名は80文字以内で入力してください。"); holidayInputRef.current?.focus(); return; }
    setHolidaySaving(true); setHolidayError("");
    try {
      const saved = await api.setCustomHoliday(selectedDate, name);
      updateHoliday(saved.name);
      setHolidayEditorOpen(false);
      window.setTimeout(() => holidayOpenerRef.current?.focus());
    } catch (error) { setHolidayError(`休日を保存できませんでした: ${String(error)}`); }
    finally { setHolidaySaving(false); }
  };
  const deleteHoliday = async () => {
    if (!selectedDate || !selectedDay?.customHolidayName || holidaySaving || !window.confirm("このカスタム休日を解除しますか？")) return;
    setHolidaySaving(true); setHolidayError("");
    try {
      await api.deleteCustomHoliday(selectedDate);
      updateHoliday(null);
      setHolidayEditorOpen(false);
      window.setTimeout(() => holidayOpenerRef.current?.focus());
    } catch (error) { setHolidayError(`休日を解除できませんでした: ${String(error)}`); }
    finally { setHolidaySaving(false); }
  };

  const futureMonthBlocked = year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);
  return <section className={`card calendar${compact ? " compact-calendar" : ""}`} aria-label="カレンダー">
    <div className="calendar-heading"><div>
      <button type="button" aria-label="前の月" disabled={disabled || loading} onClick={() => setCursor(new Date(year, month - 2, 1))}>‹</button>
      <h2>{year}年 {month}月</h2>
      <button type="button" aria-label="次の月" disabled={disabled || loading || (!allowFutureMonths && futureMonthBlocked)} onClick={() => setCursor(new Date(year, month, 1))}>›</button>
    </div><small>色が濃いほど記録が多い</small></div>
    <div className="weekdays">{["日", "月", "火", "水", "木", "金", "土"].map((weekday, index) => <span key={weekday} className={index === 0 ? "sunday" : index === 6 ? "saturday" : ""}>{weekday}</span>)}</div>
    <div className="calendar-cells">{cells.map((cell, index) => {
      if (!cell) return <span key={`blank-${index}`}/>;
      const names = formatHolidayNames(cell.stat?.nationalHolidayName, cell.stat?.customHolidayName);
      const isHoliday = Boolean(names);
      const className = [`level-${Math.min(3, cell.stat?.count || 0)}`, selectedDate === cell.date ? "selected" : "", cell.weekday === 0 ? "sunday" : "", cell.weekday === 6 ? "saturday" : "", isHoliday ? "holiday" : "", cell.stat?.customHolidayName ? "custom-holiday" : ""].filter(Boolean).join(" ");
      const label = names ? `${cell.date} ${names}` : cell.date;
      return <button type="button" key={cell.date} aria-label={label} title={names || undefined} disabled={disabled || loading} className={className} onClick={() => void onSelectDate(cell.date)}>{Number(cell.date.slice(-2))}</button>;
    })}</div>
    <div className="calendar-footer"><div className="calendar-stats"><strong>{days.filter((day) => day.count).length}</strong><span>{month}月の記録日数</span></div><button type="button" className="holiday-settings-button" disabled={disabled || loading || !selectedDate} onClick={(event) => openHolidayEditor(event.currentTarget)}>選択日の休日設定</button></div>
    {holidayEditorOpen && selectedDate && createPortal(<div className="holiday-editor-backdrop"><div ref={dialogRef} className="holiday-editor" role="dialog" aria-modal="true" aria-labelledby="holiday-editor-title">
      <header><div><span>CUSTOM HOLIDAY</span><h2 id="holiday-editor-title">休日を設定</h2></div><button type="button" className="editor-close" aria-label="休日設定を閉じる" disabled={holidaySaving} onClick={closeHolidayEditor}>×</button></header>
      <p className="holiday-editor-date">{formatLongDate(selectedDate)}</p>
      {selectedDay?.nationalHolidayName && <p className="national-holiday-note"><span>国民の祝日</span><strong>{selectedDay.nationalHolidayName}</strong></p>}
      <label className="holiday-name-field"><span>カスタム休日名</span><input ref={holidayInputRef} maxLength={80} disabled={holidaySaving} value={holidayName} onChange={(event) => { setHolidayName(event.target.value); setHolidayError(""); }} placeholder="例：会社休業日"/></label>
      {holidayError && <p className="error-text" role="alert">{holidayError}</p>}
      <footer>{selectedDay?.customHolidayName && <button type="button" className="danger-button" disabled={holidaySaving} onClick={() => void deleteHoliday()}>休日を解除</button>}<button type="button" disabled={holidaySaving} onClick={closeHolidayEditor}>キャンセル</button><button type="button" className="primary-button" disabled={holidaySaving} onClick={() => void saveHoliday()}>{holidaySaving ? "保存中…" : "保存"}</button></footer>
    </div></div>, document.querySelector(".app-shell") ?? document.body)}
  </section>;
}
