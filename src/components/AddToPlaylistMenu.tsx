import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Heart,
  ListMusic,
  ListPlus,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";
import { isEditableRemotePlaylist } from "../services/ytmusic";
import { usePlayerStore } from "../store/playerStore";
import { Track } from "../types/music";

interface AddToPlaylistMenuProps {
  track: Track;
  align?: "left" | "right";
  openUpward?: boolean;
  className?: string;
}

interface PopoverCoords {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

const MENU_WIDTH = 288;
const VIEWPORT_MARGIN = 12;

export function AddToPlaylistMenu({
  track,
  align = "right",
  openUpward = false,
  className = "",
}: AddToPlaylistMenuProps) {
  const playlists = usePlayerStore((s) => s.playlists);
  const remotePlaylists = usePlayerStore((s) => s.remotePlaylists);
  const remotePlaylistsStatus = usePlayerStore(
    (s) => s.remotePlaylistsStatus,
  );
  const remotePlaylistsError = usePlayerStore((s) => s.remotePlaylistsError);
  const remotePlaylistTrackIds = usePlayerStore(
    (s) => s.remotePlaylistTrackIds,
  );
  const remotePlaylistMutatingKeys = usePlayerStore(
    (s) => s.remotePlaylistMutatingKeys,
  );
  const likedTracks = usePlayerStore((s) => s.likedTracks);
  const authStatus = usePlayerStore((s) => s.authStatus);

  const createPlaylist = usePlayerStore((s) => s.createPlaylist);
  const addTrackToPlaylist = usePlayerStore((s) => s.addTrackToPlaylist);
  const removeTrackFromPlaylist = usePlayerStore(
    (s) => s.removeTrackFromPlaylist,
  );
  const refreshRemotePlaylists = usePlayerStore(
    (s) => s.refreshRemotePlaylists,
  );
  const addTrackToRemotePlaylistOptimistic = usePlayerStore(
    (s) => s.addTrackToRemotePlaylistOptimistic,
  );
  const removeTrackFromRemotePlaylistOptimistic = usePlayerStore(
    (s) => s.removeTrackFromRemotePlaylistOptimistic,
  );
  const createRemotePlaylistAndAddTrack = usePlayerStore(
    (s) => s.createRemotePlaylistAndAddTrack,
  );

  const [isOpen, setIsOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [createTarget, setCreateTarget] = useState<"remote" | "local">(
    authStatus === "authenticated" ? "remote" : "local",
  );
  const [creatingRemote, setCreatingRemote] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const isAuthenticated = authStatus === "authenticated";

  const editableRemotePlaylists = useMemo(
    () => remotePlaylists.filter((pl) => isEditableRemotePlaylist(pl)),
    [remotePlaylists],
  );

  const likedTrackIds = useMemo(
    () => new Set(likedTracks.map((t) => t.id)),
    [likedTracks],
  );

  useEffect(() => {
    if (!isAuthenticated && createTarget === "remote") {
      setCreateTarget("local");
    } else if (isAuthenticated && !isOpen) {
      setCreateTarget("remote");
    }
  }, [isAuthenticated, isOpen, createTarget]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const rawLeft = align === "right" ? rect.right - MENU_WIDTH : rect.left;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rawLeft, vw - MENU_WIDTH - VIEWPORT_MARGIN),
    );

    const spaceBelow = vh - rect.bottom - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - VIEWPORT_MARGIN;
    const shouldOpenUpward =
      openUpward || (spaceBelow < 320 && spaceAbove > spaceBelow);

    if (shouldOpenUpward) {
      setCoords({
        left,
        bottom: vh - rect.top + 8,
        maxHeight: Math.max(200, Math.min(400, spaceAbove - 8)),
      });
    } else {
      setCoords({
        left,
        top: rect.bottom + 8,
        maxHeight: Math.max(200, Math.min(400, spaceBelow - 8)),
      });
    }
  }, [align, openUpward]);

  useEffect(() => {
    if (!isOpen) return;

    updatePosition();

    if (
      isAuthenticated &&
      (remotePlaylistsStatus === "idle" ||
        (remotePlaylistsStatus === "error" && remotePlaylists.length === 0))
    ) {
      void refreshRemotePlaylists();
    }
  }, [
    isOpen,
    isAuthenticated,
    remotePlaylistsStatus,
    remotePlaylists.length,
    refreshRemotePlaylists,
    updatePosition,
  ]);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    const onScrollOrResize = (e: Event) => {
      if (e.type === "scroll" && menuRef.current?.contains(e.target as Node)) {
        return;
      }
      updatePosition();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [isOpen, updatePosition]);

  const handleCreateAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const trimmed = newName.trim();
    if (!trimmed || creatingRemote) return;

    if (isAuthenticated && createTarget === "remote") {
      setCreatingRemote(true);
      try {
        const ok = await createRemotePlaylistAndAddTrack(trimmed, track);
        if (ok) {
          setNewName("");
        }
      } finally {
        setCreatingRemote(false);
      }
      return;
    }

    const id = createPlaylist(trimmed);
    addTrackToPlaylist(id, track);
    setNewName("");
  };

  const popover =
    isOpen && coords && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="fixed z-[55] w-72 rounded-2xl backdrop-blur-2xl shadow-2xl shadow-black/75 p-2.5 flex flex-col gap-2 at-tonal"
            style={{
              left: coords.left,
              top: coords.top,
              bottom: coords.bottom,
              maxHeight: coords.maxHeight,
              backgroundColor:
                "rgb(var(--md-surface-container-high-rgb) / 0.97)",
              border: "1px solid rgb(var(--md-outline-rgb) / 0.3)",
            }}
          >
            <div className="flex items-center justify-between px-2 pt-0.5 shrink-0">
              <span
                className="text-[11px] font-semibold tracking-wide"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                Aggiungi a playlist
              </span>
              {isAuthenticated && (
                <button
                  type="button"
                  onClick={() => void refreshRemotePlaylists()}
                  disabled={remotePlaylistsStatus === "loading"}
                  title="Sincronizza playlist YouTube Music"
                  className="p-1 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.08] disabled:opacity-50 transition-colors"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${
                      remotePlaylistsStatus === "loading" ? "animate-spin" : ""
                    }`}
                  />
                </button>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-0.5">
              {isAuthenticated && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between px-2">
                    <span
                      className="text-[10.5px] font-semibold uppercase tracking-wider"
                      style={{
                        color: "rgb(var(--md-on-surface-variant-rgb))",
                      }}
                    >
                      YouTube Music
                    </span>
                    {editableRemotePlaylists.length > 0 && (
                      <span
                        className="text-[10.5px] tabular-nums"
                        style={{
                          color: "rgb(var(--md-on-surface-variant-rgb))",
                        }}
                      >
                        {editableRemotePlaylists.length}
                      </span>
                    )}
                  </div>

                  {remotePlaylistsStatus === "loading" &&
                  editableRemotePlaylists.length === 0 ? (
                    <div className="flex items-center gap-2 px-2.5 py-2 text-[11.5px] text-zinc-300">
                      <Loader2
                        className="w-3.5 h-3.5 animate-spin shrink-0"
                        style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
                      />
                      <span>Sincronizzazione playlist...</span>
                    </div>
                  ) : remotePlaylistsStatus === "error" &&
                    editableRemotePlaylists.length === 0 ? (
                    <div className="px-2.5 py-2 space-y-1.5 rounded-xl bg-white/[0.04]">
                      <p className="text-[11px] text-zinc-300 leading-snug">
                        {remotePlaylistsError ||
                          "Impossibile sincronizzare le playlist."}
                      </p>
                      <button
                        type="button"
                        onClick={() => void refreshRemotePlaylists()}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-transform active:scale-95"
                        style={{
                          backgroundColor:
                            "rgb(var(--md-primary-container-rgb))",
                          color: "rgb(var(--md-on-primary-container-rgb))",
                        }}
                      >
                        <RefreshCw className="w-3 h-3" />
                        Riprova
                      </button>
                    </div>
                  ) : editableRemotePlaylists.length === 0 ? (
                    <p className="px-2.5 py-1.5 text-[11.5px] text-zinc-400">
                      Nessuna playlist YouTube Music modificabile.
                    </p>
                  ) : (
                    <div className="space-y-0.5">
                      {editableRemotePlaylists.map((pl) => {
                        const cleanId = pl.id.trim().replace(/^VL/, "");
                        const isLikedPlaylist = Boolean(
                          pl.isLikedSongs || cleanId === "LM",
                        );
                        const contains = isLikedPlaylist
                          ? likedTrackIds.has(track.id) ||
                            (remotePlaylistTrackIds["LM"]?.includes(track.id) ??
                              false)
                          : (remotePlaylistTrackIds[cleanId]?.includes(
                              track.id,
                            ) ?? false);
                        const isPending = Boolean(
                          remotePlaylistMutatingKeys[`${cleanId}:${track.id}`],
                        );

                        return (
                          <button
                            key={pl.id}
                            type="button"
                            disabled={isPending}
                            onClick={() => {
                              if (contains) {
                                void removeTrackFromRemotePlaylistOptimistic(
                                  pl,
                                  track,
                                );
                              } else {
                                void addTrackToRemotePlaylistOptimistic(
                                  pl,
                                  track,
                                );
                              }
                            }}
                            className="flex items-center justify-between gap-2 w-full px-2 py-1.5 rounded-xl text-left text-[12px] hover:bg-white/[0.08] disabled:opacity-65 transition-colors"
                            style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="w-6 h-6 rounded-lg overflow-hidden bg-white/[0.07] shrink-0 flex items-center justify-center">
                                {pl.cover ? (
                                  <img
                                    src={pl.cover}
                                    alt=""
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                  />
                                ) : isLikedPlaylist ? (
                                  <Heart
                                    className="w-3.5 h-3.5 fill-current"
                                    style={{
                                      color: "rgb(var(--md-accent-primary-rgb))",
                                    }}
                                  />
                                ) : (
                                  <ListMusic className="w-3.5 h-3.5 text-zinc-400" />
                                )}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate font-medium">
                                  {pl.title}
                                </span>
                                {pl.trackCount && (
                                  <span
                                    className="block text-[10px] truncate tabular-nums"
                                    style={{
                                      color:
                                        "rgb(var(--md-on-surface-variant-rgb))",
                                    }}
                                  >
                                    {pl.trackCount}
                                  </span>
                                )}
                              </span>
                            </span>

                            {isPending ? (
                              <Loader2
                                className="w-3.5 h-3.5 animate-spin shrink-0"
                                style={{
                                  color: "rgb(var(--md-accent-primary-rgb))",
                                }}
                              />
                            ) : contains ? (
                              <Check
                                className="w-3.5 h-3.5 shrink-0"
                                style={{
                                  color: "rgb(var(--md-accent-primary-rgb))",
                                }}
                              />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1">
                {isAuthenticated && (
                  <div className="flex items-center justify-between px-2 pt-1">
                    <span
                      className="text-[10.5px] font-semibold uppercase tracking-wider"
                      style={{
                        color: "rgb(var(--md-on-surface-variant-rgb))",
                      }}
                    >
                      Playlist locali
                    </span>
                    {playlists.length > 0 && (
                      <span
                        className="text-[10.5px] tabular-nums"
                        style={{
                          color: "rgb(var(--md-on-surface-variant-rgb))",
                        }}
                      >
                        {playlists.length}
                      </span>
                    )}
                  </div>
                )}

                {playlists.length === 0 ? (
                  !isAuthenticated && (
                    <p className="px-2 py-2 text-[11.5px] text-zinc-400">
                      Nessuna playlist creata. Creane una qui sotto.
                    </p>
                  )
                ) : (
                  <div className="space-y-0.5">
                    {playlists.map((pl) => {
                      const contains = pl.tracks.some((t) => t.id === track.id);
                      return (
                        <button
                          key={pl.id}
                          type="button"
                          onClick={() => {
                            if (contains) {
                              removeTrackFromPlaylist(pl.id, track.id);
                            } else {
                              addTrackToPlaylist(pl.id, track);
                            }
                          }}
                          className="flex items-center justify-between gap-2 w-full px-2 py-1.5 rounded-xl text-left text-[12px] hover:bg-white/[0.08] transition-colors"
                          style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {pl.name}
                            </span>
                            <span
                              className="block text-[10px] tabular-nums"
                              style={{
                                color: "rgb(var(--md-on-surface-variant-rgb))",
                              }}
                            >
                              {pl.tracks.length}{" "}
                              {pl.tracks.length === 1 ? "brano" : "brani"}
                            </span>
                          </span>
                          {contains && (
                            <Check
                              className="w-3.5 h-3.5 shrink-0"
                              style={{
                                color: "rgb(var(--md-accent-primary-rgb))",
                              }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div
              className="pt-2 space-y-1.5 shrink-0"
              style={{ borderTop: "1px solid rgb(var(--md-outline-rgb) / 0.2)" }}
            >
              {isAuthenticated && (
                <div className="flex items-center gap-1 px-0.5">
                  <button
                    type="button"
                    onClick={() => setCreateTarget("remote")}
                    className="flex-1 py-1 rounded-full text-[10.5px] font-semibold transition-colors"
                    style={
                      createTarget === "remote"
                        ? {
                            backgroundColor:
                              "rgb(var(--md-primary-container-rgb))",
                            color: "rgb(var(--md-on-primary-container-rgb))",
                          }
                        : { color: "rgb(var(--md-on-surface-variant-rgb))" }
                    }
                  >
                    YouTube Music
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateTarget("local")}
                    className="flex-1 py-1 rounded-full text-[10.5px] font-semibold transition-colors"
                    style={
                      createTarget === "local"
                        ? {
                            backgroundColor:
                              "rgb(var(--md-primary-container-rgb))",
                            color: "rgb(var(--md-on-primary-container-rgb))",
                          }
                        : { color: "rgb(var(--md-on-surface-variant-rgb))" }
                    }
                  >
                    Locale
                  </button>
                </div>
              )}

              <form
                onSubmit={(e) => void handleCreateAndAdd(e)}
                className="flex items-center gap-1.5"
              >
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={creatingRemote}
                  placeholder={
                    isAuthenticated && createTarget === "remote"
                      ? "Nuova playlist YouTube Music..."
                      : "Nuova playlist locale..."
                  }
                  className="flex-1 min-w-0 h-7 px-3 rounded-full text-[11.5px] placeholder-zinc-400/75 focus:outline-none focus:ring-2 focus:ring-[rgb(var(--md-accent-primary-rgb)/0.5)] disabled:opacity-60"
                  style={{
                    backgroundColor: "rgb(var(--md-surface-container-rgb))",
                    border: "1px solid rgb(var(--md-outline-rgb) / 0.25)",
                    color: "rgb(var(--md-on-surface-rgb))",
                  }}
                />
                <button
                  type="submit"
                  disabled={!newName.trim() || creatingRemote}
                  title="Crea e aggiungi"
                  className="h-7 w-7 rounded-full disabled:opacity-40 flex items-center justify-center transition-transform active:scale-95 shrink-0"
                  style={{
                    backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                    color: "rgb(var(--md-on-accent-rgb))",
                  }}
                >
                  {creatingRemote ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                </button>
              </form>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={containerRef}
      className={`relative ${className} ${isOpen ? "!opacity-100" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        title="Aggiungi a una playlist"
        aria-label="Aggiungi a una playlist"
        aria-expanded={isOpen}
        className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.08] transition-colors"
      >
        <ListPlus className="w-4 h-4" />
      </button>

      {popover}
    </div>
  );
}
