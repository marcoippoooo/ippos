import { useEffect, useState } from "react";
import { Clock, Moon, Music, Volume2, X } from "lucide-react";
import {
  formatSleepCountdown,
  formatStopTime,
  useSleepTimerDisplay,
} from "../hooks/useSleepTimer";
import { usePlayerStore } from "../store/playerStore";

const TIMER_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 5, label: "5m" },
  { minutes: 10, label: "10m" },
  { minutes: 15, label: "15m" },
  { minutes: 30, label: "30m" },
  { minutes: 45, label: "45m" },
  { minutes: 60, label: "1h" },
];

export function SleepTimerModal() {
  const isOpen = usePlayerStore((s) => s.isSleepTimerOpen);
  const sleepTimer = usePlayerStore((s) => s.sleepTimer);
  const fadeSeconds = usePlayerStore(
    (s) => s.preferences.sleepTimerFadeSeconds,
  );
  const closeSleepTimer = usePlayerStore((s) => s.closeSleepTimer);
  const startSleepTimer = usePlayerStore((s) => s.startSleepTimer);
  const cancelSleepTimer = usePlayerStore((s) => s.cancelSleepTimer);

  const display = useSleepTimerDisplay();

  const [selectedMinutes, setSelectedMinutes] = useState(
    sleepTimer.durationMinutes,
  );
  const [finishCurrentSong, setFinishCurrentSong] = useState(
    sleepTimer.finishCurrentSong,
  );
  const [fadeOut, setFadeOut] = useState(sleepTimer.fadeOut);
  const [clockNow, setClockNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isOpen) return;
    setSelectedMinutes(sleepTimer.durationMinutes);
    setFinishCurrentSong(sleepTimer.finishCurrentSong);
    setFadeOut(sleepTimer.fadeOut);
    setClockNow(Date.now());

    const intervalId = window.setInterval(() => {
      setClockNow(Date.now());
    }, 15_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    isOpen,
    sleepTimer.durationMinutes,
    sleepTimer.finishCurrentSong,
    sleepTimer.fadeOut,
  ]);

  if (!isOpen) return null;

  const estimatedStopEpoch =
    sleepTimer.active && sleepTimer.endsAt
      ? sleepTimer.endsAt
      : clockNow + selectedMinutes * 60_000;

  const handleStart = () => {
    startSleepTimer({
      minutes: selectedMinutes,
      finishCurrentSong,
      fadeOut,
    });
    closeSleepTimer();
  };

  const handleStop = () => {
    cancelSleepTimer();
    closeSleepTimer();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md select-none"
      onClick={closeSleepTimer}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sleep-timer-title"
    >
      <div
        className="at-modal-pop w-full max-w-[420px] rounded-3xl p-6 space-y-5 shadow-2xl shadow-black/75 at-tonal"
        style={{
          backgroundColor: "rgb(var(--md-surface-container-high-rgb) / 0.96)",
          border: "1px solid rgb(var(--md-outline-rgb) / 0.30)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-primary-container-rgb))",
                color: "rgb(var(--md-on-primary-container-rgb))",
              }}
            >
              <Moon className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="sleep-timer-title"
                className="text-[16px] font-bold tracking-tight"
                style={{ color: "rgb(var(--md-on-surface-rgb))" }}
              >
                Temporizzatore di sonno
              </h2>
              <p
                className="text-[12px]"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                {sleepTimer.active
                  ? sleepTimer.waitingForTrackEnd
                    ? "Si ferma al termine del brano corrente"
                    : `Rimanente: ${formatSleepCountdown(display.remainingMs)}`
                  : "Scegli tra quanto mettere in pausa"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closeSleepTimer}
            aria-label="Chiudi temporizzatore"
            className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Banner orario stimato di interruzione */}
        <div
          className="rounded-2xl px-4 py-3 flex items-center justify-between gap-3 at-tonal"
          style={{
            backgroundColor: sleepTimer.active
              ? "rgb(var(--md-primary-container-rgb) / 0.65)"
              : "rgb(var(--md-surface-container-rgb) / 0.85)",
            border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Clock
              className="w-4 h-4 shrink-0"
              style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
            />
            <span
              className="text-[12.5px] font-medium truncate"
              style={{ color: "rgb(var(--md-on-surface-rgb))" }}
            >
              {sleepTimer.waitingForTrackEnd
                ? "In attesa della fine del brano"
                : `Si interrompe alle ${formatStopTime(estimatedStopEpoch)}`}
            </span>
          </div>

          {sleepTimer.active && (
            <span
              className="px-2.5 py-0.5 rounded-full text-[11.5px] font-semibold tabular-nums shrink-0"
              style={{
                backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                color: "rgb(var(--md-on-accent-rgb))",
              }}
            >
              {display.label}
            </span>
          )}
        </div>

        {/* Preset rapidi a pillola */}
        <div className="space-y-2">
          <div
            className="text-[11.5px] font-medium px-0.5"
            style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
          >
            Durata preset
          </div>
          <div className="grid grid-cols-3 gap-2">
            {TIMER_PRESETS.map((preset) => {
              const active = selectedMinutes === preset.minutes;
              return (
                <button
                  key={preset.minutes}
                  type="button"
                  onClick={() => setSelectedMinutes(preset.minutes)}
                  className="py-2.5 rounded-full text-[13px] font-semibold tabular-nums transition-all duration-200 active:scale-95 at-tonal"
                  style={
                    active
                      ? {
                          backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                          color: "rgb(var(--md-on-accent-rgb))",
                        }
                      : {
                          backgroundColor:
                            "rgb(var(--md-surface-container-rgb) / 0.9)",
                          border: "1px solid rgb(var(--md-outline-rgb) / 0.22)",
                          color: "rgb(var(--md-on-surface-rgb))",
                        }
                  }
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Toggle opzioni avanzate */}
        <div className="space-y-2.5">
          <button
            type="button"
            role="switch"
            aria-checked={finishCurrentSong}
            onClick={() => setFinishCurrentSong((v) => !v)}
            className="w-full rounded-2xl p-3.5 flex items-center justify-between gap-3 text-left hover:brightness-110 transition at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.82)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
            }}
          >
            <div className="flex items-start gap-3 min-w-0">
              <Music
                className="w-4 h-4 mt-0.5 shrink-0"
                style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
              />
              <div className="min-w-0">
                <p
                  className="text-[13px] font-semibold"
                  style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                >
                  Finisci il brano corrente
                </p>
                <p
                  className="text-[11.5px] leading-snug mt-0.5"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  Attende la fine naturale della traccia allo scadere del timer
                </p>
              </div>
            </div>

            <span
              className="w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 flex items-center"
              style={{
                backgroundColor: finishCurrentSong
                  ? "rgb(var(--md-accent-primary-rgb))"
                  : "rgb(var(--md-outline-rgb) / 0.45)",
              }}
            >
              <span
                className={`w-5 h-5 rounded-full transition-transform duration-200 ${
                  finishCurrentSong ? "translate-x-5" : "translate-x-0"
                }`}
                style={{
                  backgroundColor: finishCurrentSong
                    ? "rgb(var(--md-on-accent-rgb))"
                    : "rgb(var(--md-on-surface-rgb))",
                }}
              />
            </span>
          </button>

          <button
            type="button"
            role="switch"
            aria-checked={fadeOut}
            onClick={() => setFadeOut((v) => !v)}
            className="w-full rounded-2xl p-3.5 flex items-center justify-between gap-3 text-left hover:brightness-110 transition at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.82)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.2)",
            }}
          >
            <div className="flex items-start gap-3 min-w-0">
              <Volume2
                className="w-4 h-4 mt-0.5 shrink-0"
                style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
              />
              <div className="min-w-0">
                <p
                  className="text-[13px] font-semibold"
                  style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                >
                  Fade out negli ultimi {fadeSeconds} secondi
                </p>
                <p
                  className="text-[11.5px] leading-snug mt-0.5"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  Abbassa gradualmente il volume senza modificare quello impostato
                </p>
              </div>
            </div>

            <span
              className="w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 flex items-center"
              style={{
                backgroundColor: fadeOut
                  ? "rgb(var(--md-accent-primary-rgb))"
                  : "rgb(var(--md-outline-rgb) / 0.45)",
              }}
            >
              <span
                className={`w-5 h-5 rounded-full transition-transform duration-200 ${
                  fadeOut ? "translate-x-5" : "translate-x-0"
                }`}
                style={{
                  backgroundColor: fadeOut
                    ? "rgb(var(--md-on-accent-rgb))"
                    : "rgb(var(--md-on-surface-rgb))",
                }}
              />
            </span>
          </button>
        </div>

        {/* Footer azioni */}
        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={closeSleepTimer}
            className="px-4 py-2 rounded-full text-[12.5px] font-medium hover:bg-white/[0.08] transition"
            style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
          >
            Annulla
          </button>

          {sleepTimer.active && (
            <button
              type="button"
              onClick={handleStop}
              className="px-4 py-2 rounded-full text-[12.5px] font-semibold hover:brightness-110 transition at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-secondary-container-rgb))",
                color: "rgb(var(--md-on-secondary-container-rgb))",
              }}
            >
              Ferma timer
            </button>
          )}

          <button
            type="button"
            onClick={handleStart}
            className="px-5 py-2 rounded-full text-[12.5px] font-semibold shadow-md transition-transform active:scale-95 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-accent-primary-rgb))",
              color: "rgb(var(--md-on-accent-rgb))",
            }}
          >
            {sleepTimer.active ? "Aggiorna" : "Avvia timer"}
          </button>
        </div>
      </div>
    </div>
  );
}
