import { AlertCircle, X } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { PlayerBar } from "./components/PlayerBar";
import { HomeView } from "./components/HomeView";
import { ExploreView } from "./components/ExploreView";
import { LibraryView } from "./components/LibraryView";
import { LyricsView } from "./components/LyricsView";
import { SearchResultsView } from "./components/SearchResultsView";
import { QueuePanel } from "./components/QueuePanel";
import { AmbientBackdrop } from "./components/AmbientBackdrop";
import { NowPlayingOverlay } from "./components/NowPlayingOverlay";
import { SleepTimerModal } from "./components/SleepTimerModal";
import { CreatePlaylistModal } from "./components/CreatePlaylistModal";
import { TrackContextMenu } from "./components/TrackContextMenu";
import { ArtistView } from "./components/ArtistView";
import { SettingsView } from "./components/SettingsView";
import { ToastContainer } from "./components/ToastContainer";
import { useYTMusicSearch } from "./hooks/useYTMusicSearch";
import { useYTMusicFeeds } from "./hooks/useYTMusicFeeds";
import { useYTMusicAuth } from "./hooks/useYTMusicAuth";
import { useAudioPlayer } from "./hooks/useAudioPlayer";
import { useSleepTimer } from "./hooks/useSleepTimer";
import { useMediaSession } from "./hooks/useMediaSession";
import { useDynamicTheme } from "./hooks/useDynamicTheme";
import { useLibraryPersistence } from "./hooks/useLibraryPersistence";
import { useTraySync } from "./hooks/useTraySync";
import { useDiscordPresence } from "./hooks/useDiscordPresence";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { usePlayerStore } from "./store/playerStore";

export default function App() {
  useLibraryPersistence();
  useYTMusicSearch();
  const { reloadHome, selectHomeFilter, reloadExplore } = useYTMusicFeeds();
  const { startLogin, logout, refreshRemotePlaylists, handleAuthError } =
    useYTMusicAuth({ reloadHome });
  useAudioPlayer();
  useSleepTimer();
  useMediaSession();
  useDynamicTheme();
  useTraySync();
  useDiscordPresence();
  useGlobalShortcuts();
  useKeyboardShortcuts();

  const activeView = usePlayerStore((s) => s.activeView);
  const searchQuery = usePlayerStore((s) => s.searchQuery);
  const isQueueOpen = usePlayerStore((s) => s.isQueueOpen);
  const isCinemaMode = usePlayerStore((s) => s.isCinemaMode);
  const themePalette = usePlayerStore((s) => s.themePalette);
  const authNotice = usePlayerStore((s) => s.authNotice);
  const setAuthNotice = usePlayerStore((s) => s.setAuthNotice);

  const isSearching =
    searchQuery.trim().length > 0 || activeView === "search";
  const viewKey = isSearching ? "search" : activeView;
  const isLyricsFullHeight = !isSearching && activeView === "lyrics";
  const isCinemaActive = isCinemaMode && isLyricsFullHeight;

  return (
    <div
      className="relative flex flex-col h-screen w-screen overflow-hidden select-none at-tonal"
      style={{
        backgroundColor: "rgb(var(--md-surface-base-rgb))",
        color: "rgb(var(--md-on-surface-rgb))",
      }}
    >
      {/* Sfondo dinamico estratto dalla copertina con cross-fade GPU */}
      <AmbientBackdrop palette={themePalette} />

      {/* Corpo superiore: Sidebar glass a sinistra + Area centrale */}
      <div
        className={`relative z-10 flex flex-1 min-h-0 ${
          isLyricsFullHeight ? "overflow-visible" : "overflow-hidden"
        }`}
      >
        {isCinemaActive && (
          <div
            className="absolute top-0 left-0 right-0 h-9 z-20 pointer-events-auto"
            data-tauri-drag-region
          />
        )}

        <div
          className={`h-full shrink-0 overflow-hidden transition-[width,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            isCinemaActive
              ? "w-0 opacity-0 pointer-events-none"
              : "w-[244px] opacity-100"
          }`}
        >
          <Sidebar onLogin={startLogin} onLogout={logout} />
        </div>

        <div className="relative flex-1 flex flex-col min-w-0 min-h-0 bg-transparent">
          <div
            className={`shrink-0 overflow-hidden transition-[height,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              isCinemaActive
                ? "h-0 opacity-0 pointer-events-none"
                : "h-[54px] opacity-100"
            }`}
          >
            <Header />
          </div>

          {authNotice && (
            <div
              className="mx-8 mt-3 px-4 py-2.5 rounded-2xl backdrop-blur-xl flex items-center justify-between gap-3 shrink-0 at-tonal"
              style={{
                backgroundColor: "rgb(var(--md-surface-container-high-rgb) / 0.9)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.28)",
              }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <AlertCircle
                  className="w-4 h-4 shrink-0"
                  style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
                />
                <p
                  className="text-[12.5px] font-medium truncate"
                  style={{ color: "rgb(var(--md-on-surface-rgb))" }}
                >
                  {authNotice}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void startLogin()}
                  className="px-3.5 py-1 rounded-full text-[12px] font-semibold transition-transform active:scale-95"
                  style={{
                    backgroundColor: "rgb(var(--md-accent-primary-rgb))",
                    color: "rgb(var(--md-on-accent-rgb))",
                  }}
                >
                  Accedi
                </button>
                <button
                  type="button"
                  onClick={() => setAuthNotice(null)}
                  aria-label="Chiudi avviso"
                  className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          <div
            className={`flex-1 flex min-h-0 relative ${
              isLyricsFullHeight ? "overflow-visible" : "overflow-hidden"
            }`}
          >
            <main
              className={`flex-1 min-w-0 min-h-0 ${
                isLyricsFullHeight
                  ? isCinemaActive
                    ? "px-10 py-0 overflow-visible"
                    : "px-8 py-4 overflow-visible"
                  : "px-8 pt-6 pb-8 overflow-y-auto"
              }`}
            >
              <div
                key={viewKey}
                className={`at-view-fade ${
                  isLyricsFullHeight ? "h-full min-h-0" : ""
                }`}
              >
                {isSearching ? (
                  <SearchResultsView />
                ) : (
                  <>
                    {activeView === "home" && (
                      <HomeView
                        onReload={reloadHome}
                        onSelectFilter={selectHomeFilter}
                      />
                    )}
                    {activeView === "explore" && (
                      <ExploreView onReload={reloadExplore} />
                    )}
                    {activeView === "library" && (
                      <LibraryView
                        onLogin={startLogin}
                        onRefreshRemotePlaylists={refreshRemotePlaylists}
                        onAuthError={handleAuthError}
                      />
                    )}
                    {activeView === "lyrics" && <LyricsView />}
                    {activeView === "artist" && <ArtistView />}
                    {activeView === "settings" && (
                      <SettingsView onLogin={startLogin} onLogout={logout} />
                    )}
                  </>
                )}
              </div>
            </main>

            {isQueueOpen && <QueuePanel />}
          </div>
        </div>
      </div>

      {/* Barra player dock glass flottante in basso */}
      <div className="relative z-20 shrink-0 pt-1.5">
        <PlayerBar />
      </div>

      {/* Overlay Now Playing espanso, modali Fase 10 e Toast notifiche */}
      <NowPlayingOverlay />
      <SleepTimerModal />
      <CreatePlaylistModal />
      <TrackContextMenu />
      <ToastContainer />
    </div>
  );
}
