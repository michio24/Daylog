import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function WindowControls() {
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const appWindow = useMemo(() => isTauri ? getCurrentWindow() : null, [isTauri]);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!appWindow) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const syncMaximized = async () => {
      const maximized = await appWindow.isMaximized();
      if (!disposed) setIsMaximized(maximized);
    };

    void syncMaximized();
    void appWindow.onResized(() => { void syncMaximized(); }).then((stop) => {
      if (disposed) stop(); else unlisten = stop;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [appWindow]);

  if (!appWindow) return null;

  const toggleMaximize = async () => {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  };

  return <div className="window-controls" role="group" aria-label="ウィンドウ操作">
    <button className="window-control" type="button" aria-label="最小化" onClick={() => { void appWindow.minimize(); }}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.75 8.5h8.5"/></svg>
    </button>
    <button className="window-control" type="button" aria-label={isMaximized ? "元のサイズに戻す" : "最大化"} onClick={() => { void toggleMaximize(); }}>
      {isMaximized
        ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 5.25v-1.5h6.25V10H10.5M3.75 5.5h6.75v6.75H3.75z"/></svg>
        : <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.75" y="3.75" width="8.5" height="8.5" rx=".75"/></svg>}
    </button>
    <button className="window-control window-control-close" type="button" aria-label="閉じる" onClick={() => { void appWindow.close(); }}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.25 4.25 7.5 7.5m0-7.5-7.5 7.5"/></svg>
    </button>
  </div>;
}
