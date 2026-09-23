export const localDateKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const addDaysToDateKey = (key: string, days: number) => {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
};

/** 日付キーを「その日の正午のローカル Date」にする。加算で日付がずれるのを避けるための既存の流儀。 */
const noonOf = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
};

/** 週の始まり（月曜）。 */
export const startOfWeek = (key: string) => {
  const date = noonOf(key);
  // getDay() は日曜が 0。月曜始まりにするため日曜を 6 に読み替える。
  const offset = (date.getDay() + 6) % 7;
  return addDaysToDateKey(key, -offset);
};

export const endOfWeek = (key: string) => addDaysToDateKey(startOfWeek(key), 6);

export const startOfMonth = (key: string) => `${key.slice(0, 7)}-01`;

export const endOfMonth = (key: string) => {
  const date = noonOf(key);
  // 翌月の 0 日目 = 当月の末日。
  return localDateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12));
};

export const startOfYear = (key: string) => `${key.slice(0, 4)}-01-01`;

export const formatLongDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(new Date(y, m - 1, d));
};

export const formatHeaderDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).format(new Date(y, m - 1, d));
};

export const formatHolidayNames = (national?: string | null, custom?: string | null) => [national, custom].filter(Boolean).join("／");

export const formatExportFileName = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][new Date(year, month - 1, day, 12).getDay()];
  return `${String(year).padStart(4, "0")}年${String(month).padStart(2, "0")}月${String(day).padStart(2, "0")}日(${weekday}).md`;
};

export const formatNoteExportFileName = (title: string) => {
  // Windows のファイル名に使えない文字を落とす。制御文字の除去は意図したもの。
  // eslint-disable-next-line no-control-regex
  let stem = title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[ .]+$/g, "").trim();
  if (!stem) stem = "無題のメモ";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem += "_";
  return `${stem}.md`;
};
