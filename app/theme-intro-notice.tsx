"use client";

import { useSyncExternalStore } from "react";
import { setVisualTheme, THEME_EVENT, THEME_STORAGE_KEY } from "./theme-state";

const INTRO_STORAGE_KEY = "aiyiba-cyber-theme-intro-v1";
const INTRO_EVENT = "aiyiba:cyber-theme-intro-change";
let dismissedForPage = false;

function readIntroVisibility() {
  if (dismissedForPage) return false;
  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const hasThemePreference = savedTheme === "classic" || savedTheme === "cyber";
    const hasSeenIntro = window.localStorage.getItem(INTRO_STORAGE_KEY) === "seen";
    return !hasThemePreference && !hasSeenIntro;
  } catch {
    return true;
  }
}

function subscribeIntro(listener: () => void) {
  window.addEventListener(INTRO_EVENT, listener);
  window.addEventListener(THEME_EVENT, listener);
  return () => {
    window.removeEventListener(INTRO_EVENT, listener);
    window.removeEventListener(THEME_EVENT, listener);
  };
}

function getServerIntroVisibility() {
  return false;
}

export default function ThemeIntroNotice() {
  const visible = useSyncExternalStore(
    subscribeIntro,
    readIntroVisibility,
    getServerIntroVisibility,
  );

  function dismiss() {
    dismissedForPage = true;
    try {
      window.localStorage.setItem(INTRO_STORAGE_KEY, "seen");
    } catch {
      // The notice still closes for the current page when storage is blocked.
    }
    window.dispatchEvent(new Event(INTRO_EVENT));
  }

  function switchToClassic() {
    setVisualTheme("classic");
    dismiss();
  }

  if (!visible) return null;

  return (
    <aside className="theme-intro-notice" aria-label="主题更新提示" aria-live="polite">
      <button
        className="theme-intro-close"
        type="button"
        aria-label="关闭主题更新提示"
        onClick={dismiss}
      >
        ×
      </button>
      <div className="theme-intro-copy">
        <strong>默认主题已更新</strong>
        <p>现在默认使用赛博主题。如果看不习惯，可以随时切回经典主题。</p>
      </div>
      <button className="theme-intro-action" type="button" onClick={switchToClassic}>
        切回经典主题
      </button>
    </aside>
  );
}
