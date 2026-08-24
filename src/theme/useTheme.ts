import { useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "renderlaunch:theme";

export function readThemePreference(): ThemePreference {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

export function resolveTheme(preference: ThemePreference) {
  return preference === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
    : preference;
}

export function applyTheme(preference: ThemePreference) {
  document.documentElement.dataset.theme = resolveTheme(preference);
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.style.colorScheme = resolveTheme(preference);
}

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
      readThemePreference(),
    ),
    [resolved, setResolved] = useState<"light" | "dark">(() =>
      resolveTheme(readThemePreference()),
    );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)"),
      update = () => {
        applyTheme(preference);
        setResolved(resolveTheme(preference));
      };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preference]);
  const setPreference = (value: ThemePreference) => {
    localStorage.setItem(STORAGE_KEY, value);
    setPreferenceState(value);
    applyTheme(value);
    setResolved(resolveTheme(value));
  };
  return { preference, setPreference, resolved };
}
