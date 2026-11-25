import { useEffect, useRef, useState } from "react";
import {
  Cloud,
  Globe,
  Link2,
  ListPlus,
  Loader2,
  Lock,
  Music,
  X,
} from "lucide-react";
import { usePlayerStore } from "../store/playerStore";
import { PlaylistPrivacyStatus } from "../types/music";
import { M3ExpressiveSwitch } from "./SettingsPrimitives";

const PRIVACY_OPTIONS: {
  id: PlaylistPrivacyStatus;
  label: string;
  hint: string;
  icon: typeof Lock;
}[] = [
  {
    id: "PRIVATE",
    label: "Privata",
    hint: "Visibile solo a te sul tuo account",
    icon: Lock,
  },
  {
    id: "UNLISTED",
    label: "Non in elenco",
    hint: "Accessibile solo tramite link diretto",
    icon: Link2,
  },
  {
    id: "PUBLIC",
    label: "Pubblica",
    hint: "Chiunque può trovarla e ascoltarla",
    icon: Globe,
  },
];

export function CreatePlaylistModal() {
  const isOpen = usePlayerStore((s) => s.isCreatePlaylistModalOpen);
  const initialTrack = usePlayerStore((s) => s.createPlaylistInitialTrack);
  const authStatus = usePlayerStore((s) => s.authStatus);
  const closeModal = usePlayerStore((s) => s.closeCreatePlaylistModal);
  const createPlaylist = usePlayerStore((s) => s.createPlaylist);

  const isAuthenticated = authStatus === "authenticated";

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacyStatus, setPrivacyStatus] =
    useState<PlaylistPrivacyStatus>("PRIVATE");
  const [syncWithYTMusic, setSyncWithYTMusic] = useState(isAuthenticated);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTitle("");
    setDescription("");
    setPrivacyStatus("PRIVATE");
    setSyncWithYTMusic(authStatus === "authenticated");
    setIsSubmitting(false);
    setErrorMsg(null);

    const frameId = window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [isOpen, authStatus]);

  useEffect(() => {
    if (!isAuthenticated && syncWithYTMusic) {
      setSyncWithYTMusic(false);
    }
  }, [isAuthenticated, syncWithYTMusic]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!isSubmitting) {
          closeModal();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, isSubmitting, closeModal]);

  if (!isOpen) return null;

  const activePrivacyMeta =
    PRIVACY_OPTIONS.find((opt) => opt.id === privacyStatus) ??
    PRIVACY_OPTIONS[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setErrorMsg("Inserisci un titolo per la playlist.");
      titleInputRef.current?.focus();
      return;
    }

    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      const result = await createPlaylist({
        title: trimmedTitle,
        description: description.trim() || undefined,
        privacyStatus,
        syncWithYTMusic: isAuthenticated ? syncWithYTMusic : false,
        initialTrack: initialTrack ?? undefined,
      });

      if (result) {
        closeModal();
        return;
      }

      if (usePlayerStore.getState().authStatus !== "authenticated") {
        closeModal();
        return;
      }

      setErrorMsg(
        "Impossibile creare la playlist su YouTube Music. Riprova.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[58] flex items-center justify-center p-4 bg-black/55 backdrop-blur-xl select-none"
      onClick={() => {
        if (!isSubmitting) closeModal();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-playlist-title"
    >
      <div
        className="at-modal-pop w-full max-w-[460px] rounded-[28px] p-6 space-y-5 backdrop-blur-3xl shadow-[0_28px_72px_rgba(0,0,0,0.68),inset_0_1px_0_rgba(255,255,255,0.16)] at-tonal"
        style={{
          backgroundColor:
            "rgb(var(--md-surface-container-high-rgb) / 0.86)",
          backgroundImage:
            "linear-gradient(160deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.025) 38%, rgba(0,0,0,0.18) 100%)",
          border: "1px solid rgb(var(--md-outline-rgb) / 0.36)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-inner at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-primary-container-rgb))",
                color: "rgb(var(--md-on-primary-container-rgb))",
              }}
            >
              <ListPlus className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2
                id="create-playlist-title"
                className="text-[16px] font-bold tracking-tight truncate"
                style={{ color: "rgb(var(--md-on-surface-rgb))" }}
              >
                Nuova playlist
              </h2>
              <p
                className="text-[12px] truncate"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                {isAuthenticated && syncWithYTMusic
                  ? "Verrà sincronizzata con YouTube Music"
                  : "Salvata nella tua libreria locale"}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={closeModal}
            aria-label="Chiudi creazione playlist"
            className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-white/[0.08] disabled:opacity-40 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Anteprima traccia iniziale (se aperta da AddToPlaylistMenu / ContextMenu) */}
        {initialTrack && (
          <div
            className="rounded-2xl p-2.5 flex items-center gap-3 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.78)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
            }}
          >
            <div className="w-10 h-10 rounded-xl overflow-hidden bg-white/[0.06] ring-1 ring-white/10 shrink-0 flex items-center justify-center">
              {initialTrack.cover ? (
                <img
                  src={initialTrack.cover}
                  alt={initialTrack.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <Music className="w-4 h-4 text-zinc-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p
                className="text-[12.5px] font-semibold truncate"
                style={{ color: "rgb(var(--md-on-surface-rgb))" }}
              >
                {initialTrack.title}
              </p>
              <p
                className="text-[11px] truncate"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                {initialTrack.artist}
              </p>
            </div>
            <span
              className="px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold shrink-0"
              style={{
                backgroundColor:
                  "rgb(var(--md-secondary-container-rgb) / 0.9)",
                color: "rgb(var(--md-on-secondary-container-rgb))",
              }}
            >
              Verrà aggiunto
            </span>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {/* Titolo (obbligatorio) */}
          <div className="space-y-1.5">
            <label
              htmlFor="create-playlist-name"
              className="block text-[11.5px] font-semibold px-0.5"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              Titolo <span style={{ color: "rgb(var(--md-accent-primary-rgb))" }}>*</span>
            </label>
            <input
              ref={titleInputRef}
              id="create-playlist-name"
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              disabled={isSubmitting}
              maxLength={150}
              required
              placeholder="Es. Viaggio notturno, Allenamento..."
              className="w-full h-10 px-4 rounded-2xl text-[13.5px] placeholder-zinc-400/70 focus:outline-none focus:ring-2 focus:ring-[rgb(var(--md-accent-primary-rgb)/0.55)] disabled:opacity-60 transition at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.78)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.28)",
                color: "rgb(var(--md-on-surface-rgb))",
              }}
            />
          </div>

          {/* Descrizione (opzionale) */}
          <div className="space-y-1.5">
            <label
              htmlFor="create-playlist-description"
              className="block text-[11.5px] font-semibold px-0.5"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              Descrizione{" "}
              <span className="font-normal opacity-75">(opzionale)</span>
            </label>
            <textarea
              id="create-playlist-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isSubmitting}
              rows={2}
              maxLength={500}
              placeholder="Aggiungi una breve descrizione..."
              className="w-full px-4 py-2.5 rounded-2xl text-[13px] placeholder-zinc-400/70 resize-none focus:outline-none focus:ring-2 focus:ring-[rgb(var(--md-accent-primary-rgb)/0.55)] disabled:opacity-60 transition at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.78)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.28)",
                color: "rgb(var(--md-on-surface-rgb))",
              }}
            />
          </div>

          {/* Privacy */}
          <div className="space-y-1.5">
            <span
              className="block text-[11.5px] font-semibold px-0.5"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              Privacy
            </span>
            <div
              className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.78)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
              }}
            >
              {PRIVACY_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = privacyStatus === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setPrivacyStatus(opt.id)}
                    className="inline-flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-[12px] font-semibold transition-all duration-200 disabled:opacity-60"
                    style={
                      active
                        ? {
                            backgroundColor:
                              "rgb(var(--md-primary-container-rgb))",
                            color: "rgb(var(--md-on-primary-container-rgb))",
                          }
                        : { color: "rgb(var(--md-on-surface-variant-rgb))" }
                    }
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>
            <p
              className="text-[11px] px-1"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              {activePrivacyMeta.hint}
            </p>
          </div>

          {/* Toggle Sincronizza con YouTube Music */}
          <div
            className="rounded-2xl p-3.5 flex items-center justify-between gap-3 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.78)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.24)",
            }}
          >
            <div className="flex items-start gap-3 min-w-0">
              <Cloud
                className="w-4 h-4 mt-0.5 shrink-0"
                style={{
                  color:
                    isAuthenticated && syncWithYTMusic
                      ? "rgb(var(--md-accent-primary-rgb))"
                      : "rgb(var(--md-on-surface-variant-rgb))",
                }}
              />
              <div className="min-w-0">
                <p
                  className="text-[13px] font-semibold"
                  style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                >
                  Sincronizza con YouTube Music
                </p>
                <p
                  className="text-[11.5px] leading-snug mt-0.5"
                  style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                >
                  {isAuthenticated
                    ? syncWithYTMusic
                      ? "Crea la playlist direttamente sul tuo account Google"
                      : "Salva solo in locale su questo Mac"
                    : "Accedi con Google per sincronizzare sul tuo account"}
                </p>
              </div>
            </div>

            <M3ExpressiveSwitch
              checked={isAuthenticated ? syncWithYTMusic : false}
              onChange={(next) => setSyncWithYTMusic(next)}
              ariaLabel="Sincronizza con YouTube Music"
              disabled={!isAuthenticated || isSubmitting}
            />
          </div>

          {errorMsg && (
            <p className="text-[12px] font-medium text-rose-300 px-1">
              {errorMsg}
            </p>
          )}

          {/* Footer azioni */}
          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={closeModal}
              className="px-4 py-2 rounded-full text-[12.5px] font-medium hover:bg-white/[0.08] disabled:opacity-45 transition"
              style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
            >
              Annulla
            </button>

            <button
              type="submit"
              disabled={!title.trim() || isSubmitting}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-[12.5px] font-semibold shadow-md disabled:opacity-45 transition-transform active:scale-95 at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                color: "rgb(var(--md-on-accent-rgb))",
              }}
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {initialTrack ? "Crea e aggiungi" : "Crea playlist"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
