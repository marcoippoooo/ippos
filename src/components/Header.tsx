import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { usePlayerStore } from "../store/playerStore";
import { ViewMode } from "../types/music";

const VIEW_LABELS: Record<ViewMode, string> = {
  home: "Ascolta ora",
  explore: "Esplora",
  library: "Libreria",
  lyrics: "Testo",
  artist: "Artista",
  search: "Ricerca",
  settings: "Impostazioni",
};

export function Header() {
  const activeView = usePlayerStore((s) => s.activeView);
  const searchQuery = usePlayerStore((s) => s.searchQuery);
  const searchStatus = usePlayerStore((s) => s.searchStatus);
  const setSearchQuery = usePlayerStore((s) => s.setSearchQuery);
  const triggerSearchNow = usePlayerStore((s) => s.triggerSearchNow);
  const clearSearch = usePlayerStore((s) => s.clearSearch);
  const setActiveView = usePlayerStore((s) => s.setActiveView);
  const closeArtistView = usePlayerStore((s) => s.closeArtistView);

  const isSearching =
    searchQuery.trim().length > 0 || activeView === "search";

  return (
    <header
      className="h-[54px] shrink-0 flex items-center gap-4 px-6 backdrop-blur-2xl border-b border-white/[0.08] z-10 select-none at-tonal"
      style={{
        backgroundColor: "rgb(var(--md-surface-base-rgb) / 0.44)",
      }}
      data-tauri-drag-region
    >
      {/* Pulsanti navigazione */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => {
            if (isSearching) {
              clearSearch();
            } else if (activeView === "artist") {
              closeArtistView();
            } else {
              setActiveView("home");
            }
          }}
          disabled={!isSearching && activeView === "home"}
          title="Indietro"
          className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-white/[0.08] disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          disabled
          title="Avanti"
          className="p-2 rounded-full text-zinc-400 disabled:opacity-30 disabled:pointer-events-none"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Campo ricerca YouTube Music a pillola */}
      <div className="relative w-80 shrink-0">
        <Search
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
          style={{ color: "rgb(var(--md-on-surface-variant-rgb))" }}
        />
        <input
          id="ippos-search-input"
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && searchQuery.trim().length > 0) {
              triggerSearchNow();
            }
          }}
          placeholder="Cerca su YouTube Music..."
          className="w-full h-9 rounded-full pl-9 pr-14 text-[12.5px] border border-white/[0.08] shadow-sm shadow-black/20 focus:outline-none focus:ring-2 focus:ring-[rgb(var(--md-accent-primary-rgb)/0.55)] placeholder:text-zinc-400/75 at-tonal"
          style={{
            backgroundColor: "rgb(var(--md-surface-container-rgb) / 0.78)",
            color: "rgb(var(--md-on-surface-rgb))",
          }}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
          {searchStatus === "loading" && (
            <Loader2
              className="w-3.5 h-3.5 animate-spin"
              style={{ color: "rgb(var(--md-accent-primary-rgb))" }}
            />
          )}
          {!searchQuery && searchStatus !== "loading" && (
            <kbd
              className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold tracking-tight pointer-events-none select-none"
              style={{
                backgroundColor:
                  "rgb(var(--md-surface-container-high-rgb) / 0.9)",
                border: "1px solid rgb(var(--md-outline-rgb) / 0.25)",
                color: "rgb(var(--md-on-surface-variant-rgb))",
              }}
            >
              ⌘K
            </kbd>
          )}
          {searchQuery && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Cancella ricerca"
              className="p-0.5 rounded-full text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Zona trascinabile libera */}
      <div className="flex-1 h-full" data-tauri-drag-region />

      {/* Pillola vista corrente */}
      <div
        className="px-3 py-1 rounded-full text-[11.5px] font-medium shrink-0 pointer-events-none at-tonal"
        style={{
          backgroundColor: "rgb(var(--md-secondary-container-rgb) / 0.65)",
          color: "rgb(var(--md-on-secondary-container-rgb))",
        }}
        data-tauri-drag-region
      >
        {isSearching ? "Ricerca" : VIEW_LABELS[activeView]}
      </div>
    </header>
  );
}
