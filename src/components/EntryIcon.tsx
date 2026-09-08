import type { CSSProperties } from "react";

export const ENTRY_ICONS = [
  { value: "message", label: "会話" },
  { value: "done", label: "完了" },
  { value: "break", label: "休憩" },
  { value: "idea", label: "ひらめき" },
  { value: "alert", label: "注意" },
  { value: "work", label: "作業" },
  { value: "meeting", label: "会議" },
  { value: "study", label: "学習" },
  { value: "write", label: "執筆" },
  { value: "code", label: "開発" },
  { value: "meal", label: "食事" },
  { value: "walk", label: "散歩" },
  { value: "exercise", label: "運動" },
  { value: "health", label: "体調" },
  { value: "sleep", label: "睡眠" },
  { value: "travel", label: "移動" },
  { value: "shopping", label: "買い物" },
  { value: "home", label: "家事" },
  { value: "happy", label: "うれしいこと" },
  { value: "goal", label: "目標" },
  { value: "beer", label: "飲み会" },
  { value: "music", label: "音楽" },
  { value: "movie", label: "映画" },
  { value: "photo", label: "写真" },
  { value: "gift", label: "お祝い" },
] as const;

export type EntryIconName = typeof ENTRY_ICONS[number]["value"];

export const ENTRY_COLORS = [
  { value: "blue", label: "ブルー", ink: "#315fb5", dark: "#a3bfff", soft: "#e7eeff" },
  { value: "teal", label: "ティール", ink: "#226e70", dark: "#82d5cd", soft: "#e0f2ed" },
  { value: "green", label: "リーフ", ink: "#467137", dark: "#afd59a", soft: "#eaf2e1" },
  { value: "amber", label: "ハニー", ink: "#886014", dark: "#f1cf80", soft: "#fbefd2" },
  { value: "orange", label: "テラコッタ", ink: "#a24e2e", dark: "#f0ae8d", soft: "#fae9de" },
  { value: "rose", label: "ローズ", ink: "#a13f64", dark: "#efa6c2", soft: "#f9e4ed" },
  { value: "violet", label: "ラベンダー", ink: "#7151a5", dark: "#c7aff0", soft: "#eee7fa" },
  { value: "slate", label: "スレート", ink: "#566477", dark: "#bcc8db", soft: "#e9edf3" },
  { value: "cyan", label: "アクア", ink: "#16718a", dark: "#86d6eb", soft: "#dff3f8" },
  // Keep stored palette IDs stable when refining their displayed colors.
  { value: "indigo", label: "ライム", ink: "#596600", dark: "#d5eb65", soft: "#f2f7cf" },
  { value: "red", label: "プラム", ink: "#98209e", dark: "#ef9bf3", soft: "#f8def9" },
  { value: "brown", label: "グラファイト", ink: "#292b2f", dark: "#f0f0eb", soft: "#e9e9e6" },
] as const;

// Preserve legacy names; new selections use a validated name:palette pair in the existing icon field.
export function parseEntryIcon(value: string) {
  const [name, color] = value.split(":");
  const item = ENTRY_ICONS.find((item) => item.value === name);
  const palette = ENTRY_COLORS.find((item) => item.value === color);
  return { name: item?.value ?? "", label: item?.label ?? "記録", color: palette?.value ?? "blue", palette };
}

export function entryColorStyle(color: string): CSSProperties {
  const palette = ENTRY_COLORS.find((item) => item.value === color) ?? ENTRY_COLORS[0];
  return { "--entry-color": palette.ink, "--entry-color-dark": palette.dark, "--entry-soft": palette.soft } as CSSProperties;
}

const extraPaths: Record<string, string> = {
  beer: "M5 8v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8 M17 10h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2 M5 8a3 3 0 0 1 0-6q2-2 4 0a3 3 0 0 1 5 0 3 3 0 0 1 3 6Z M9 11v6 M13 11v6",
  music: "M9 17V5l11-2v12 M9 8l11-2 M9 17a3 2 0 1 0-6 0 3 2 0 0 0 6 0 M20 15a3 2 0 1 0-6 0 3 2 0 0 0 6 0",
  movie: "M3 8h18v13H3Z M3 8l-1-4 18-3 1 4Z M7 3l3 4 M14 2l3 4 M10 12l5 3-5 3Z",
  photo: "M3 7h4l2-3h6l2 3h4v14H3Z M12 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M18 10h.1",
  gift: "M3 8h18v5H3Z M5 13v8h14v-8 M12 8v13 M12 8H8a3 3 0 1 1 3-3Z M12 8h4a3 3 0 1 0-3-3Z",
  work: "M4 7h16v13H4Z M9 7V4h6v3 M4 12h16 M10 12v3h4v-3",
  meeting: "M4 20v-3a4 4 0 0 1 8 0v3 M14 14a4 4 0 0 1 6 3v3 M8 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M16 5a3 3 0 0 1 0 6",
  study: "M12 6Q7 3 3 5v15q4-2 9 1 5-3 9-1V5q-4-2-9 1Z M12 6v15",
  write: "m4 16 12-12 4 4-12 12-5 1Z M13 7l4 4 M4 16l4 4",
  code: "m8 6-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18",
  meal: "M5 3v7 M2 3v5q0 3 3 3t3-3V3 M5 11v10 M19 21V3q-6 4-4 10h4",
  walk: "M14 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4 M7 12l3-4 4 1 3 4h3 M12 9l-2 6-4 6 M10 15l5 2 1 4",
  exercise: "M3 8v8 M6 5v14 M18 5v14 M21 8v8 M6 12h12",
  health: "M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z",
  sleep: "M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z M16 3h5l-5 5h5",
  travel: "M6 3h12v14H6Z M6 8h12 M6 13h12 M8 17l-3 4 M16 17l3 4 M8 20h8 M9 15h.1 M15 15h.1",
  shopping: "M5 7h14l2 14H3Z M8 8V6a4 4 0 0 1 8 0v2",
  home: "m2 11 10-8 10 8 M5 9v12h14V9 M9 21v-8h6v8",
  happy: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M8 9h.1 M16 9h.1 M7 14q5 7 10 0",
  goal: "M12 3a9 9 0 1 0 9 9 M12 7a5 5 0 1 0 5 5 M12 12l9-9 M16 3h5v5",
};

interface Props {
  icon: string;
}

export function EntryIcon({ icon: value }: Props) {
  const { name: icon, palette } = parseEntryIcon(value);
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const shape = icon === "message"
    ? <svg {...common}><path d="M5.5 6.5h13a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H11l-4.5 3v-3h-1a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"/><circle cx="9" cy="12" r=".7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r=".7" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r=".7" fill="currentColor" stroke="none"/></svg>
    : icon === "done"
      ? <svg {...common}><circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.2 2.5 2.5 5.3-6"/><path d="M15.8 5.2 18 3"/></svg>
      : icon === "break"
        ? <svg {...common}><path d="M6 9h10v5.2A3.8 3.8 0 0 1 12.2 18H9.8A3.8 3.8 0 0 1 6 14.2V9Z"/><path d="M16 10h1.5a2 2 0 0 1 0 4H16M5 20h13M9 6c-1-1 .8-1.8 0-3M13 6c-1-1 .8-1.8 0-3"/></svg>
        : icon === "idea"
          ? <svg {...common}><path d="M8.8 15.3A6 6 0 1 1 15.2 15c-1 .7-1.2 1.4-1.2 2H10c0-.7-.2-1.2-1.2-1.7ZM10 20h4M12 2V.8M4.9 4.9 4 4M19.1 4.9l.9-.9"/></svg>
          : icon === "alert"
            ? <svg {...common}><path d="M12 3.5 21 20H3L12 3.5Z"/><path d="M12 9v5M12 17.2v.1"/></svg>
            : extraPaths[icon] ? <svg {...common}><path d={extraPaths[icon]}/></svg> : null;

  return shape ? <span className={`entry-icon-glyph entry-icon-glyph--${icon}${palette ? " entry-icon-glyph--colored" : ""}`} style={palette ? entryColorStyle(palette.value) : undefined}>{shape}</span> : null;
}
