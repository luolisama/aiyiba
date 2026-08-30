"use client";

import { useSyncExternalStore } from "react";
import {
  getServerVisualTheme,
  readVisualTheme,
  setVisualTheme,
  subscribeVisualTheme,
} from "./theme-state";

export default function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeVisualTheme,
    readVisualTheme,
    getServerVisualTheme,
  );

  function toggleTheme() {
    setVisualTheme(theme === "cyber" ? "classic" : "cyber");
  }

  const nextLabel = theme === "cyber" ? "经典主题" : "赛博主题";
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label={`切换到${nextLabel}`}
      title={`切换到${nextLabel}`}
    >
      {nextLabel}
    </button>
  );
}
