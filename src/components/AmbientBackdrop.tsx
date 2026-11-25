import { useEffect, useRef, useState } from "react";
import { usePlayerStore } from "../store/playerStore";
import { ThemePalette, VibrancyIntensity } from "../types/music";

interface AmbientBackdropProps {
  palette: ThemePalette;
}

function getAlphaScale(intensity: VibrancyIntensity, isDynamic: boolean): number {
  const base = intensity === "subtle" ? 0.62 : intensity === "vivid" ? 1.38 : 1;
  return isDynamic ? base : base * 0.78;
}

function getPaletteKey(palette: ThemePalette): string {
  return `${palette.isDynamic}-${palette.primaryRgb}-${palette.secondaryRgb}-${palette.accentPrimaryRgb}-${palette.surfaceBaseRgb}`;
}

/**
 * Ambient mesh gradient lento e sfocato derivato dai colori dominanti della copertina,
 * con cross-fade GPU a doppio layer tra un brano e il successivo.
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
          !pureBlackOled && dynamicThemeEnabled && activeSlot === slot;
        const mul = getAlphaScale(vibrancyIntensity, layerPalette.isDynamic);
        const a1 = Math.min(0.56, Number((0.40 * mul).toFixed(3)));
        const a2 = Math.min(0.46, Number((0.32 * mul).toFixed(3)));
        const a3 = Math.min(0.34, Number((0.22 * mul).toFixed(3)));

        return (
          <div
            key={slot}
            className="absolute inset-0 will-change-[opacity] transition-opacity duration-[1100ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ opacity: isActive ? 1 : 0 }}
          >
            <div
              className="at-ambient-blob-1 absolute -top-[18%] -left-[12%] w-[68vw] h-[64vh] rounded-full blur-[115px]"
              style={{
                background: `radial-gradient(circle, rgb(${layerPalette.primaryRgb} / ${a1}) 0%, transparent 72%)`,
              }}
            />
            <div
              className="at-ambient-blob-2 absolute -top-[10%] -right-[14%] w-[62vw] h-[66vh] rounded-full blur-[120px]"
              style={{
                background: `radial-gradient(circle, rgb(${layerPalette.secondaryRgb} / ${a2}) 0%, transparent 72%)`,
              }}
            />
            <div
              className="at-ambient-blob-3 absolute -bottom-[22%] left-[14%] w-[70vw] h-[56vh] rounded-full blur-[120px]"
              style={{
                background: `radial-gradient(circle, rgb(${layerPalette.accentPrimaryRgb} / ${a3}) 0%, transparent 74%)`,
              }}
            />
          </div>
        );
      })}

      {/* Vignette scura per garantire contrasto e profondità costante sui testi */}
      {!pureBlackOled && (
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(10,10,14,0.18) 0%, rgba(10,10,14,0.34) 55%, rgba(8,8,11,0.52) 100%)",
          }}
        />
      )}
    </div>
  );
}
