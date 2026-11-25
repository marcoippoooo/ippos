import {
  Clock,
  Compass,
  Disc3,
  Heart,
  Home,
  Library,
  ListMusic,
  Loader2,
  LogIn,
  LogOut,
  Settings,
} from "lucide-react";
import { usePlayerStore } from "../store/playerStore";
import { LibraryTab, ViewMode } from "../types/music";
import { ScallopedArtwork } from "./ScallopedArtwork";

interface SidebarProps {
  onLogin: () => void;
  onLogout: () => void;
}

interface PrimaryNavItem {
  id: ViewMode;
  label: string;
  icon: typeof Home;
}

interface LibraryShortcut {
  tab: LibraryTab;
  label: string;
  icon: typeof Heart;
}

const PRIMARY_NAV: PrimaryNavItem[] = [
  { id: "home", label: "Ascolta ora", icon: Home },
  { id: "explore", label: "Esplora", icon: Compass },
  { id: "library", label: "Libreria", icon: Library },
];

const LIBRARY_SHORTCUTS: LibraryShortcut[] = [
  { tab: "liked", label: "Brani piaciuti", icon: Heart },
  { tab: "recent", label: "Recenti", icon: Clock },
  { tab: "playlists", label: "Playlist", icon: ListMusic },
];

export function Sidebar({ onLogin, onLogout }: SidebarProps) {
  const activeView = usePlayerStore((s) => s.activeView);
  const libraryTab = usePlayerStore((s) => s.libraryTab);
  const likedCount = usePlayerStore((s) => s.likedTracks.length);
  const playlistsCount = usePlayerStore((s) => s.playlists.length);
  const remotePlaylistsCount = usePlayerStore(
    (s) => s.remotePlaylists.length,
  );
  const authStatus = usePlayerStore((s) => s.authStatus);
  const authUser = usePlayerStore((s) => s.authUser);
  const setActiveView = usePlayerStore((s) => s.setActiveView);
  const setLibraryTab = usePlayerStore((s) => s.setLibraryTab);
  const clearSearch = usePlayerStore((s) => s.clearSearch);

  const totalPlaylistsCount = playlistsCount + remotePlaylistsCount;
  const displayName = authUser?.name || "Account Google";

  return (
    <aside
      className="w-[244px] shrink-0 h-full flex flex-col backdrop-blur-2xl border-r border-white/[0.08] shadow-[4px_0_32px_rgba(0,0,0,0.34)] select-none at-tonal"
      style={{
        backgroundColor: "rgb(var(--md-surface-container-low-rgb) / 0.58)",
        backgroundImage:
          "linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.01) 32%, rgba(0,0,0,0.12) 100%)",
      }}
    >
      {/* Fascia dedicata ai semafori della Titlebar Overlay macOS */}
      <div className="h-[48px] shrink-0" data-tauri-drag-region />

      {/* Identità discreta dell'app */}
      <div
        className="px-4 pb-5 flex items-center gap-2.5 shrink-0"
        data-tauri-drag-region
      >
        <div
          className="w-7 h-7 rounded-xl flex items-center justify-center shadow-sm shadow-black/40 pointer-events-none at-tonal"
          style={{
            background:
              "linear-gradient(135deg, rgb(var(--md-accent-primary-rgb)), rgb(var(--theme-primary-rgb)))",
            color: "rgb(var(--md-on-accent-rgb))",
          }}
        >
          <Disc3 className="w-4 h-4" />
        </div>
        <span
          className="text-[15px] font-bold tracking-[0.14em] pointer-events-none"
          style={{ color: "rgb(var(--md-on-surface-rgb))" }}
        >
          IPPOS
        </span>
      </div>

      {/* Navigazione principale */}
      <div className="flex-1 overflow-y-auto px-3 space-y-6">
        <nav className="space-y-1" aria-label="Navigazione principale">
          {PRIMARY_NAV.map((item) => {
            const Icon = item.icon;
            const isActive =
              activeView === item.id &&
              (item.id !== "library" || libraryTab === "overview");
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  clearSearch();
                  if (item.id === "library") {
                    setLibraryTab("overview");
                  }
                  setActiveView(item.id);
                }}
                className={`flex items-center gap-3 w-full px-3.5 py-2.5 rounded-full text-[13px] font-medium transition-all duration-300 active:scale-[0.98] ${
                  isActive
                    ? "shadow-xs"
                    : "hover:bg-white/[0.06]"
                }`}
                style={
                  isActive
                    ? {
                        backgroundColor: "rgb(var(--md-primary-container-rgb))",
                        color: "rgb(var(--md-on-primary-container-rgb))",
                      }
                    : {
                        color: "rgb(var(--md-on-surface-variant-rgb))",
                      }
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Sezione Libreria */}
        <div className="pt-4 space-y-1.5 border-t border-white/[0.08]">
          <div
            className="px-3.5 pb-1 text-[11px] font-medium"
            style={{ color: "rgb(var(--md-on-surface-variant-rgb) / 0.85)" }}
          >
            La tua libreria
          </div>
          <nav className="space-y-1" aria-label="Scorciatoie libreria">
            {LIBRARY_SHORTCUTS.map((item) => {
              const Icon = item.icon;
              const isSelected =
                activeView === "library" && libraryTab === item.tab;
              const badgeCount =
                item.tab === "liked"
                  ? likedCount
                  : item.tab === "playlists"
                    ? totalPlaylistsCount
                    : 0;
              return (
                <button
                  key={item.tab}
                  type="button"
                  onClick={() => {
                    clearSearch();
                    setLibraryTab(item.tab);
                    setActiveView("library");
                  }}
                  className={`flex items-center justify-between w-full px-3.5 py-2 rounded-full text-[13px] font-medium transition-all duration-300 active:scale-[0.98] ${
                    isSelected ? "shadow-xs" : "hover:bg-white/[0.06]"
                  }`}
                  style={
                    isSelected
                      ? {
                          backgroundColor: "rgb(var(--md-primary-container-rgb))",
                          color: "rgb(var(--md-on-primary-container-rgb))",
                        }
                      : {
                          color: "rgb(var(--md-on-surface-variant-rgb))",
                        }
                  }
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {badgeCount > 0 && (
                    <span
                      className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold tabular-nums at-tonal"
                      style={
                        isSelected
                          ? {
                              backgroundColor:
                                "rgb(var(--md-on-primary-container-rgb) / 0.16)",
                              color: "rgb(var(--md-on-primary-container-rgb))",
                            }
                          : {
                              backgroundColor:
                                "rgb(var(--md-secondary-container-rgb))",
                              color: "rgb(var(--md-on-secondary-container-rgb))",
                            }
                      }
                    >
                      {badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Impostazioni & Stato Account YouTube Music */}
      <div className="p-3 space-y-2 shrink-0 border-t border-white/[0.08]">
        <button
          type="button"
          onClick={() => {
            clearSearch();
            setActiveView("settings");
          }}
          className={`flex items-center gap-3 w-full px-3.5 py-2 rounded-full text-[13px] font-medium transition-all duration-300 active:scale-[0.98] ${
            activeView === "settings" ? "shadow-xs" : "hover:bg-white/[0.06]"
          }`}
          style={
            activeView === "settings"
              ? {
                  backgroundColor: "rgb(var(--md-primary-container-rgb))",
                  color: "rgb(var(--md-on-primary-container-rgb))",
                }
              : {
                  color: "rgb(var(--md-on-surface-variant-rgb))",
                }
          }
        >
          <Settings className="w-4 h-4 shrink-0" />
          <span className="truncate">Impostazioni</span>
        </button>
        {authStatus === "authenticated" ? (
          <div
            className="flex items-center gap-2.5 p-2 rounded-2xl border border-white/[0.08] shadow-sm shadow-black/25 at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.72)",
            }}
          >
            <ScallopedArtwork
              src={authUser?.avatar}
              alt={displayName}
              size={32}
              variant="cookie8"
              fallback={
                <span
                  className="w-full h-full flex items-center justify-center text-[11.5px] font-bold"
                  style={{
                    backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                    color: "rgb(var(--md-on-accent-rgb))",
                  }}
                >
                  {displayName.charAt(0).toUpperCase()}
                </span>
              }
            />

            <div className="min-w-0 flex-1">
              <p
                className="text-[12px] font-semibold truncate"
                style={{ color: "rgb(var(--md-on-surface-rgb))" }}
              >
                Connesso come {displayName}
              </p>
              <p
                className="text-[11px] truncate"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                {authUser?.handle || "YouTube Music"}
              </p>
            </div>

            <button
              type="button"
              onClick={onLogout}
              title="Disconnetti"
              aria-label="Disconnetti"
              className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/[0.1] transition-colors shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : authStatus === "authenticating" ? (
          <button
            type="button"
            onClick={onLogin}
            className="flex items-center gap-2.5 w-full px-3.5 py-2.5 rounded-full text-left at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-secondary-container-rgb) / 0.85)",
              color: "rgb(var(--md-on-secondary-container-rgb))",
            }}
          >
            <Loader2
              className="w-4 h-4 animate-spin shrink-0"
              style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
            />
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium truncate">
                Accesso in corso...
              </p>
              <p className="text-[10.5px] opacity-80 truncate">
                Completa nella finestra Google
              </p>
            </div>
          </button>
        ) : (
          <button
            type="button"
            onClick={onLogin}
            className="flex items-center gap-2.5 w-full px-3.5 py-2.5 rounded-full text-left border border-white/[0.08] shadow-sm shadow-black/25 transition-transform active:scale-[0.98] at-tonal"
            style={{
              backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.72)",
            }}
          >
            <LogIn
              className="w-4 h-4 shrink-0"
              style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
            />
            <div className="min-w-0">
              <p
                className="text-[12.5px] font-semibold truncate"
                style={{ color: "rgb(var(--md-on-surface-rgb))" }}
              >
                Accedi con Google
              </p>
              <p
                className="text-[11px] truncate"
                style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
              >
                Sincronizza libreria
              </p>
            </div>
          </button>
        )}
      </div>
    </aside>
  );
}
