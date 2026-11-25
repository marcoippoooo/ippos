import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  Heart,
  ListMusic,
  ListPlus,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  fetchRemotePlaylistTracks,
  isEditableRemotePlaylist,
} from "../services/ytmusic";
import { usePlayerStore } from "../store/playerStore";
import { RemotePlaylist, Track, UserPlaylist } from "../types/music";

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

  const openCreatePlaylistModal = usePlayerStore(
    (s) => s.openCreatePlaylistModal,
  );
  const addTrackToPlaylist = usePlayerStore((s) => s.addTrackToPlaylist);
  const refreshRemotePlaylists = usePlayerStore(
    (s) => s.refreshRemotePlaylists,
  );
  const setRemotePlaylistTrackIds = usePlayerStore(
    (s) => s.setRemotePlaylistTrackIds,
  );
  const addTrackToRemotePlaylistOptimistic = usePlayerStore(
    (s) => s.addTrackToRemotePlaylistOptimistic,
  );

  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] = useState<
    | { kind: "remote"; playlist: RemotePlaylist }
    | { kind: "local"; playlist: UserPlaylist }
    | null
  >(null);
  const [checkingRemoteId, setCheckingRemoteId] = useState<string | null>(null);

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
    if (!isOpen) {
      setDuplicatePrompt(null);
      setCheckingRemoteId(null);
      return;
    }

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

  useEffect(() => {
    setDuplicatePrompt(null);
    setCheckingRemoteId(null);
  }, [track.id]);

  const handleSelectRemotePlaylist = async (pl: RemotePlaylist) => {
    const cleanId = pl.id.trim().replace(/^VL/, "");
    if (!cleanId || checkingRemoteId === cleanId) return;

    const isLikedPlaylist = Boolean(pl.isLikedSongs || cleanId === "LM");
    if (isLikedPlaylist) {
      const alreadyLiked =
        likedTrackIds.has(track.id) ||
        (remotePlaylistTrackIds["LM"]?.includes(track.id) ?? false);
      if (alreadyLiked) {
        setDuplicatePrompt({ kind: "remote", playlist: pl });
        return;
      }
      setDuplicatePrompt(null);
      void addTrackToRemotePlaylistOptimistic(pl, track);
      return;
    }

    const hasCachedIds = Object.prototype.hasOwnProperty.call(
      remotePlaylistTrackIds,
      cleanId,
    );
    if (hasCachedIds) {
      const alreadyPresent =
        remotePlaylistTrackIds[cleanId]?.includes(track.id) ?? false;
      if (alreadyPresent) {
        setDuplicatePrompt({ kind: "remote", playlist: pl });
        return;
      }
      setDuplicatePrompt(null);
      void addTrackToRemotePlaylistOptimistic(pl, track);
      return;
    }

    setCheckingRemoteId(cleanId);
    setDuplicatePrompt(null);
    try {
      const tracks = await fetchRemotePlaylistTracks(pl.id);
      setRemotePlaylistTrackIds(
        cleanId,
        tracks.map((t) => t.id),
      );
      if (tracks.some((t) => t.id === track.id)) {
        setDuplicatePrompt({ kind: "remote", playlist: pl });
        return;
      }
      void addTrackToRemotePlaylistOptimistic(pl, track);
    } catch {
      void addTrackToRemotePlaylistOptimistic(pl, track);
    } finally {
      setCheckingRemoteId((prev) => (prev === cleanId ? null : prev));
    }
  };

  const handleSelectLocalPlaylist = (pl: UserPlaylist) => {
    if (pl.tracks.some((t) => t.id === track.id)) {
      setDuplicatePrompt({ kind: "local", playlist: pl });
      return;
    }
    setDuplicatePrompt(null);
    addTrackToPlaylist(pl.id, track);
  };

  const handleConfirmDuplicateAdd = () => {
    if (!duplicatePrompt) return;
    const target = duplicatePrompt;
    setDuplicatePrompt(null);
    if (target.kind === "local") {
      addTrackToPlaylist(target.playlist.id, track, { allowDuplicate: true });
    } else {
      void addTrackToRemotePlaylistOptimistic(target.playlist, track, {
        allowDuplicate: true,
      });
    }
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

            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                openCreatePlaylistModal(track);
              }}
              className="flex items-center justify-between gap-2 w-full px-2.5 py-2 rounded-xl text-left text-[12px] font-semibold transition-all hover:brightness-110 active:scale-[0.99] shrink-0 at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-primary-container-rgb) / 0.88)",
                color: "rgb(var(--md-on-primary-container-rgb))",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.25)",
              }}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                    color: "rgb(var(--md-on-accent-rgb))",
                  }}
                >
                  <Plus className="w-3 h-3" />
                </span>
                <span className="truncate">Nuova playlist</span>
              </span>
              <span className="text-[10.5px] opacity-80 shrink-0">
                + brano
              </span>
            </button>

            {duplicatePrompt && (
              <div
                className="rounded-xl p-2.5 space-y-2 shrink-0 at-tonal"
                style={{
                  backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.95)",
                  border: "1px solid rgb(var(--md-accent-primary-rgb) / 0.45)",
                }}
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle
                    className="w-3.5 h-3.5 mt-0.5 shrink-0"
                    style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
                  />
                  <div className="min-w-0">
                    <p
                      className="text-[11px] font-medium leading-snug"
                      style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                    >
                      Questo brano è già nella playlist. Vuoi aggiungerlo comunque?
                    </p>
                    <p
                      className="text-[10px] truncate mt-0.5"
                      style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                    >
                      {duplicatePrompt.kind === "remote"
                        ? duplicatePrompt.playlist.title
                        : duplicatePrompt.playlist.name}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDuplicatePrompt(null)}
                    className="px-2.5 py-1 rounded-full text-[10.5px] font-medium hover:bg-white/[0.08] transition"
                    style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
                  >
                    Annulla
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmDuplicateAdd}
                    className="px-2.5 py-1 rounded-full text-[10.5px] font-semibold transition-transform active:scale-95"
                    style={{
                      backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                      color: "rgb(var(--md-on-accent-rgb))",
                    }}
                  >
                    Aggiungi comunque
                  </button>
                </div>
              </div>
            )}

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
                          remotePlaylistMutatingKeys[`${cleanId}:${track.id}`] ||
                            checkingRemoteId === cleanId,
                        );

                        return (
                          <button
                            key={pl.id}
                            type="button"
                            disabled={isPending}
                            onClick={() => void handleSelectRemotePlaylist(pl)}
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
                      Nessuna playlist creata. Usa Nuova playlist qui sopra.
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
                          onClick={() => handleSelectLocalPlaylist(pl)}
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
