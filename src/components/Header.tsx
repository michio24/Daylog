import { useEffect, useRef, useState } from "react";
import type { Screen, Settings } from "../types";
import { formatHeaderDate } from "../utils/date";

interface Props { screen: Screen; date: string; settings: Settings; onNavigate: (screen: Screen) => void; onSettings: (settings: Settings) => void; }

const themes: Settings["theme"][] = ["light", "mist", "fluent", "sakura", "dark", "circuit"];
const themeLabels: Record<Settings["theme"], string> = { light: "和", mist: "霧", fluent: "流", sakura: "桜", dark: "夜", circuit: "電" };
const themeDescriptions: Record<Settings["theme"], string> = { light: "生成りと墨", mist: "静かな青灰", fluent: "澄んだ水色と青緑", sakura: "ミルク色と桜のピンク", dark: "深い藍と琥珀", circuit: "蛍光色とグリッド" };

export function Header({ screen, date, settings, onNavigate, onSettings }: Props) {
  const [themeOpen, setThemeOpen] = useState(false);
  const themePicker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!themePicker.current?.contains(event.target as Node)) setThemeOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setThemeOpen(false); };
    window.addEventListener("pointerdown", close); window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape); };
  }, []);
  return <header className="app-header">
    <div className="brand"><span>Daylog</span><small>{formatHeaderDate(date)}</small></div>
    <nav aria-label="メインナビゲーション">
      {(["today", "history", "search", "settings"] as Screen[]).map((item) =>
        <button key={item} className={screen === item ? "active" : ""} onClick={() => onNavigate(item)}>
          {{ today: "今日", history: "履歴", search: "検索", settings: "設定" }[item]}
        </button>)}
    </nav>
    <div className="header-actions">
      {screen === "today" && <div className="segmented compact">
        <button className={settings.layout === "one" ? "active" : ""} onClick={() => onSettings({ ...settings, layout: "one" })}>1カラム</button>
        <button className={settings.layout === "two" ? "active" : ""} onClick={() => onSettings({ ...settings, layout: "two" })}>2カラム</button>
        <button className={settings.layout === "three" ? "active" : ""} onClick={() => onSettings({ ...settings, layout: "three" })}>3カラム</button>
      </div>}
      <div className="theme-picker" ref={themePicker}>
        <button className="theme-button" aria-haspopup="menu" aria-expanded={themeOpen} onClick={() => setThemeOpen(!themeOpen)}><span className={`theme-dot ${settings.theme}`}/><span>{themeLabels[settings.theme]}</span><span className="theme-chevron">⌄</span></button>
        {themeOpen && <div className="theme-menu" role="menu" aria-label="テーマを選択">
          {themes.map((theme) => <button key={theme} role="menuitemradio" aria-checked={settings.theme === theme} className={settings.theme === theme ? "active" : ""} onClick={() => { onSettings({ ...settings, theme }); setThemeOpen(false); }}>
            <span className={`theme-swatch ${theme}`}><i/><i/></span><span><strong>{themeLabels[theme]}</strong><small>{themeDescriptions[theme]}</small></span>{settings.theme === theme && <b>✓</b>}
          </button>)}
        </div>}
      </div>
    </div>
  </header>;
}
