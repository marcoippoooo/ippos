import { ListMusic } from "lucide-react";
import { useToastStore } from "../store/toastStore";

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed bottom-[106px] left-1/2 -translate-x-1/2 z-[60] pointer-events-none flex flex-col items-center gap-2 max-w-[min(90vw,460px)]"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`pointer-events-none backdrop-blur-2xl shadow-xl shadow-black/50 rounded-full px-4 py-2.5 flex items-center gap-2.5 text-[12.5px] font-medium max-w-full at-tonal ${
            toast.leaving ? "at-toast-out" : "at-toast-in"
          }`}
          style={{
            backgroundColor: "rgb(var(--md-surface-container-high-rgb) / 0.95)",
            border: "1px solid rgb(var(--md-accent-primary-rgb) / 0.35)",
            color: "rgb(var(--md-on-surface-rgb))",
          }}
        >
          <ListMusic
            className="w-3.5 h-3.5 shrink-0 text-accent"
            aria-hidden="true"
          />
          <span className="truncate">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
