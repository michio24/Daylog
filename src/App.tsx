import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Header } from "./components/Header";
import { HistoryPage } from "./pages/HistoryPage";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TodayPage, type TodayPageHandle } from "./pages/TodayPage";
import { api } from "./services/api";
import type { DayData, Screen, Settings } from "./types";
import { localDateKey } from "./utils/date";

const defaults: Settings = { aiEnabled: false, modelPath: "", backend: "Auto", contextSize: null, generationLength: "標準", backupGenerations: 30, theme: "light", layout: "one" };

export default function App() {
  const [screen, setScreen] = useState<Screen>("today");
  const [day, setDay] = useState<DayData | null>(null);
  const [settings, setSettings] = useState<Settings>(defaults);
  const [error, setError] = useState("");
  const taskInput = useRef<HTMLInputElement | null>(null);
  const todayPage = useRef<TodayPageHandle>(null);
  const loadDay = useCallback(async (date?: string) => { try { setDay(date ? await api.getDay(date) : await api.getToday()); setScreen("today"); } catch (e) { setError(`データを読み込めませんでした: ${String(e)}`); } }, []);
  useEffect(() => { void Promise.all([loadDay(), api.getSettings().then(setSettings).catch(() => undefined)]); }, [loadDay]);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      try {
        await todayPage.current?.flush();
        await appWindow.destroy();
      } catch (closeError) {
        setError(`終了前にデータを保存できませんでした: ${String(closeError)}`);
      }
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; }).catch((closeError) => setError(`終了処理を準備できませんでした: ${String(closeError)}`));
    return () => { disposed = true; unlisten?.(); };
  }, []);
  const updateSettings = (next: Settings) => { setSettings(next); void api.saveSettings(next).catch((e) => setError(`設定を保存できませんでした: ${String(e)}`)); };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      if (e.key.toLowerCase() === "f") { e.preventDefault(); void (async () => { try { await todayPage.current?.flush(); setScreen("search"); } catch (saveError) { setError(`データを保存できないため画面を移動しませんでした: ${String(saveError)}`); } })(); }
      if (e.key.toLowerCase() === "m") { e.preventDefault(); setScreen("today"); window.setTimeout(() => document.querySelector<HTMLButtonElement>("#daily-note .note-add")?.focus()); }
      if (e.key.toLowerCase() === "r") { e.preventDefault(); setScreen("today"); window.setTimeout(() => document.getElementById("daily-review")?.scrollIntoView({ behavior: "smooth" })); }
      if (e.key.toLowerCase() === "t") { e.preventDefault(); setScreen("today"); window.setTimeout(() => { taskInput.current = document.querySelector<HTMLInputElement>(".task-section input"); taskInput.current?.focus(); }); }
      if (e.key.toLowerCase() === "s") { e.preventDefault(); (document.activeElement as HTMLElement)?.blur(); }
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, []);
  const activeDate = day?.dayDate || localDateKey();
  return <div data-theme={settings.theme} className="app-shell">
    <Header screen={screen} date={activeDate} settings={settings} onNavigate={(next) => { void (async () => { try { await todayPage.current?.flush(); if (next === "today" && activeDate !== localDateKey()) await loadDay(); else setScreen(next); } catch (navigationError) { setError(`データを保存できないため画面を移動しませんでした: ${String(navigationError)}`); } })(); }} onSettings={updateSettings}/>
    {error && <div className="toast" role="alert">{error}<button onClick={() => setError("")}>×</button></div>}
    {!day ? <main className="loading">記録を読み込んでいます…</main> : <>
      {screen === "today" && <TodayPage ref={todayPage} key={day.dayDate} day={day} settings={settings} onDay={setDay} onOpenDate={loadDay} onError={setError}/>}
      {screen === "history" && <HistoryPage onOpenDay={(selected) => { setDay(selected); setScreen("today"); }}/>} 
      {screen === "search" && <SearchPage onOpen={(date) => void loadDay(date)}/>} 
      {screen === "settings" && <SettingsPage settings={settings} onChange={updateSettings} onHolidayUpdated={async () => setDay(await api.getDay(activeDate))}/>}
    </>}
  </div>;
}
