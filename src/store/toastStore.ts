import { create } from "zustand";

export interface ToastItem {
  id: string;
  message: string;
  leaving?: boolean;
}

interface ToastTimers {
  exitTimer: number;
  removeTimer: number;
}

const MAX_TOASTS = 3;
const DEFAULT_TOAST_DURATION_MS = 2000;
const EXIT_ANIMATION_MS = 180;

const timers = new Map<string, ToastTimers>();
let toastSeq = 0;

function clearToastTimers(id: string): void {
  const entry = timers.get(id);
  if (!entry) return;
  window.clearTimeout(entry.exitTimer);
  window.clearTimeout(entry.removeTimer);
  timers.delete(id);
}

interface ToastState {
  toasts: ToastItem[];
  showToast: (message: string, durationMs?: number) => void;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  showToast: (message, durationMs = DEFAULT_TOAST_DURATION_MS) => {
    const trimmed = message.trim();
    if (!trimmed) return;

    const id = `toast-${++toastSeq}-${Date.now()}`;
    const safeDuration = Math.max(400, durationMs);
    const exitDelay = Math.max(0, safeDuration - EXIT_ANIMATION_MS);

    set((state) => {
      const next = [...state.toasts, { id, message: trimmed }];
      while (next.length > MAX_TOASTS) {
        const evicted = next.shift();
        if (evicted) {
          clearToastTimers(evicted.id);
        }
      }
      return { toasts: next };
    });

    const exitTimer = window.setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.map((t) =>
          t.id === id ? { ...t, leaving: true } : t,
        ),
      }));
    }, exitDelay);

    const removeTimer = window.setTimeout(() => {
      get().dismissToast(id);
    }, safeDuration);

    timers.set(id, { exitTimer, removeTimer });
  },

  dismissToast: (id) => {
    clearToastTimers(id);
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  clearToasts: () => {
    for (const id of Array.from(timers.keys())) {
      clearToastTimers(id);
    }
    set({ toasts: [] });
  },
}));
