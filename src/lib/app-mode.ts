import { useEffect, useState } from "react";

export type AppMode = "quotation" | "purchase";

const KEY = "app-mode";
const EVENT = "app-mode-change";

export function getAppMode(): AppMode {
  if (typeof window === "undefined") return "quotation";
  return (localStorage.getItem(KEY) as AppMode) || "quotation";
}

export function setAppMode(mode: AppMode) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, mode);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: mode }));
}

export function useAppMode(): [AppMode, (m: AppMode) => void] {
  const [mode, setMode] = useState<AppMode>("quotation");
  useEffect(() => {
    setMode(getAppMode());
    const onChange = () => setMode(getAppMode());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return [mode, setAppMode];
}
