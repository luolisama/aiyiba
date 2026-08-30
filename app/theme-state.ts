export type VisualTheme = "classic" | "cyber";

export const THEME_STORAGE_KEY = "aiyiba-visual-theme";
export const THEME_EVENT = "aiyiba:visual-theme-change";

export function readVisualTheme(): VisualTheme {
  return document.documentElement.dataset.visualTheme === "classic" ? "classic" : "cyber";
}

export function subscribeVisualTheme(listener: () => void) {
  window.addEventListener(THEME_EVENT, listener);
  return () => window.removeEventListener(THEME_EVENT, listener);
}

export function getServerVisualTheme(): VisualTheme {
  return "cyber";
}

export function setVisualTheme(theme: VisualTheme) {
  document.documentElement.dataset.visualTheme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // A blocked storage context can still switch themes for this page.
  }
  window.dispatchEvent(new CustomEvent<VisualTheme>(THEME_EVENT, { detail: theme }));
}
