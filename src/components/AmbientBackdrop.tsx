import { useEffect, useRef, useState } from "react";
import { usePlayerStore } from "../store/playerStore";
import { ThemePalette, VibrancyIntensity } from "../types/music";

interface AmbientBackdropProps {
  palette: ThemePalette;
}

function getAlphaScale(intensity: VibrancyIntensity): number {
  if (intensity === "subtle") return 0.55;
  if (intensity === "vivid") return 1.45;
  return 1;
}

function buildMeshStyle(
  palette: ThemePalette,
  intensity: VibrancyIntensity,
): string {
  const mul = getAlphaScale(intensity);
  const a1 = Math.min(0.46, Number((0.28 * mul).toFixed(3)));
  const a2 = Math.min(0.36, Number((0.2 * mul).toFixed(3)));
  const a3 = Math.min(0.24, Number((0.12 * mul).toFixed(3)));
  return [
    `radial-gradient(ellipse 68% 58% at 16% 6%, rgb(${palette.primaryRgb} / ${a1}), transparent 72%)`,
    `radial-gradient(ellipse 62% 52% at 80% 10%, rgb(${palette.secondaryRgb} / ${a2}), transparent 70%)`,
    `radial-gradient(ellipse 72% 45% at 50% 100%, rgb(${palette.accentPrimaryRgb} / ${a3}), transparent 75%)`,
  ].join(", ");
}

function getPaletteKey(palette: ThemePalette): string {
  return `${palette.isDynamic}-${palette.primaryRgb}-${palette.secondaryRgb}-${palette.accentPrimaryRgb}-${palette.surfaceBaseRgb}`;
}

/**
 * Sfondo mesh con cross-fade a doppio layer GPU (solo su `opacity`) per
 * garantire dissolvenza morbida tra le palette dei brani senza ricalcoli continui.
 */
export function AmbientBackdrop({ palette }: AmbientBackdropProps) {
  const dynamicThemeEnabled = usePlayerStore(
    (s) => s.preferences.dynamicThemeEnabled,
  );
  const vibrancyIntensity = usePlayerStore(
    (s) => s.preferences.vibrancyIntensity,
  );
  const pureBlackOled = usePlayerStore((s) => s.preferences.pureBlackOled);

  const [layers, setLayers] = useState<[ThemePalette, ThemePalette]>([
    palette,
    palette,
  ]);
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const lastKeyRef = useRef(getPaletteKey(palette));

  useEffect(() => {
    const nextKey = getPaletteKey(palette);
    if (nextKey === lastKeyRef.current) return;
    lastKeyRef.current = nextKey;

    setActiveSlot((prevSlot) => {
      const nextSlot: 0 | 1 = prevSlot === 0 ? 1 : 0;
      setLayers((prevLayers) => {
        const updated: [ThemePalette, ThemePalette] = [
          prevLayers[0],
          prevLayers[1],
        ];
        updated[nextSlot] = palette;
        return updated;
      });
      return nextSlot;
    });
  }, [palette]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 overflow-hidden z-0"
    >
      {[0, 1].map((slot) => {
        const layerPalette = layers[slot];
        const isActive =
          !pureBlackOled &&
          dynamicThemeEnabled &&
          activeSlot === slot &&
          layerPalette.isDynamic;
        return (
          <div
            key={slot}
            className="absolute inset-0 will-change-[opacity] transition-opacity duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{
              opacity: isActive ? 1 : 0,
              backgroundImage: buildMeshStyle(layerPalette, vibrancyIntensity),
            }}
          />
        );
      })}
    </div>
  );
}
