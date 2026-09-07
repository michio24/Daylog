export const ENTRY_ICONS = [
  { value: "message", label: "会話" },
  { value: "done", label: "完了" },
  { value: "break", label: "休憩" },
  { value: "idea", label: "ひらめき" },
  { value: "alert", label: "注意" },
] as const;

export type EntryIconName = typeof ENTRY_ICONS[number]["value"];

interface Props {
  icon: string;
}

export function EntryIcon({ icon }: Props) {
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
            : null;

  return shape ? <span className={`entry-icon-glyph entry-icon-glyph--${icon}`}>{shape}</span> : null;
}
