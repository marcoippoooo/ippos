import { useEffect } from "react";
import {
  DEFAULT_THEME_PALETTE,
  NEUTRAL_DARK_PALETTE,
  extractTrackPalette,
} from "../services/colorExtractor";
import { usePlayerStore } from "../store/playerStore";

export function useDynamicTheme() {
  const trackId = usePlayerStore((s) => s.currentTrack?.id ?? null);
  const trackCover = usePlayerStore((s) => s.currentTrack?.cover ?? "");
  const dynamicThemeEnabled = usePlayerStore(
    (s) => s.preferences.dynamicThemeEnabled,
  );
  const vibrancyIntensity = usePlayerStore(
    (s) => s.preferences.vibrancyIntensity,
  );
  const darkThemeMode = usePlayerStore((s) => s.preferences.darkThemeMode);
  const pureBlackOled = usePlayerStore((s) => s.preferences.pureBlackOled);
  const disableBlur = usePlayerStore((s) => s.preferences.disableBlur);
  const disableAnimations = usePlayerStore(
    (s) => s.preferences.disableAnimations,
  );
  const themePalette = usePlayerStore((s) => s.themePalette);
  const setThemePalette = usePlayerStore((s) => s.setThemePalette);

  useEffect(() => {
    if (!dynamicThemeEnabled) {
      setThemePalette(NEUTRAL_DARK_PALETTE);
      return;
    }

    if (!trackId || !trackCover) {
      setThemePalette(DEFAULT_THEME_PALETTE);
      return;
    }

    let cancelled = false;

    void extractTrackPalette(trackId, trackCover).then((palette) => {
      if (!cancelled) {
        setThemePalette(palette);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [trackId, trackCover, dynamicThemeEnabled, setThemePalette]);

  useEffect(() => {
    const scale =
      vibrancyIntensity === "subtle"
        ? "0.45"
        : vibrancyIntensity === "vivid"
          ? "1.45"
          : "1";
    document.documentElement.style.setProperty("--at-vibrancy-scale", scale);
  }, [vibrancyIntensity]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("at-no-blur", disableBlur);
    root.classList.toggle("at-no-animations", disableAnimations);
    root.classList.toggle("at-oled", pureBlackOled);
    root.dataset.themeMode = darkThemeMode;
    root.style.backgroundColor = pureBlackOled ? "#000000" : "";
  }, [darkThemeMode, pureBlackOled, disableBlur, disableAnimations]);

  useEffect(() => {
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--theme-primary-rgb", themePalette.primaryRgb);
    rootStyle.setProperty("--theme-secondary-rgb", themePalette.secondaryRgb);
    rootStyle.setProperty("--theme-accent-rgb", themePalette.accentRgb);
    rootStyle.setProperty(
      "--md-surface-base-rgb",
      pureBlackOled ? "0 0 0" : themePalette.surfaceBaseRgb,
    );
    rootStyle.setProperty(
      "--md-surface-container-low-rgb",
      pureBlackOled ? "8 8 10" : themePalette.surfaceContainerLowRgb,
    );
    rootStyle.setProperty(
      "--md-surface-container-rgb",
      pureBlackOled ? "14 14 17" : themePalette.surfaceContainerRgb,
    );
    rootStyle.setProperty(
      "--md-surface-container-high-rgb",
      pureBlackOled ? "22 22 26" : themePalette.surfaceContainerHighRgb,
    );
    rootStyle.setProperty(
      "--md-primary-container-rgb",
      themePalette.primaryContainerRgb,
    );
    rootStyle.setProperty(
      "--md-on-primary-container-rgb",
      themePalette.onPrimaryContainerRgb,
    );
    rootStyle.setProperty(
      "--md-secondary-container-rgb",
      themePalette.secondaryContainerRgb,
    );
    rootStyle.setProperty(
      "--md-on-secondary-container-rgb",
      themePalette.onSecondaryContainerRgb,
    );
    rootStyle.setProperty(
      "--md-accent-primary-rgb",
      themePalette.accentPrimaryRgb,
    );
    rootStyle.setProperty("--md-on-accent-rgb", themePalette.onAccentRgb);
    rootStyle.setProperty("--md-outline-rgb", themePalette.outlineRgb);
    rootStyle.setProperty("--md-on-surface-rgb", themePalette.onSurfaceRgb);
    rootStyle.setProperty(
      "--md-on-surface-variant-rgb",
      themePalette.onSurfaceVariantRgb,
    );
  }, [themePalette, pureBlackOled]);
}
