import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createListenerBag } from "../utils/tauriListeners";
import {
  clearAuthSession,
  loadSavedAuthSession,
  saveAuthSession,
} from "../services/authStorage";
import {
  fetchAccountProfile,
  formatNetworkError,
  isAuthExpiredError,
  setYTMusicAuthCookie,
} from "../services/ytmusic";
import { usePlayerStore } from "../store/playerStore";
import { AuthUser } from "../types/music";

interface LoginSuccessPayload {
  cookie: string;
}

const SESSION_EXPIRED_MESSAGE = "Sessione scaduta, effettua nuovamente l'accesso";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function useYTMusicAuth({
  reloadHome,
}: {
  reloadHome: () => Promise<void>;
}) {
  const sessionGenRef = useRef(0);
  const reloadHomeRef = useRef(reloadHome);

  useEffect(() => {
    reloadHomeRef.current = reloadHome;
  }, [reloadHome]);

  const handleSessionExpired = useCallback(async () => {
    sessionGenRef.current += 1;
    await clearAuthSession();
    setYTMusicAuthCookie(null);
    const store = usePlayerStore.getState();
    store.resetAuthToGuest(SESSION_EXPIRED_MESSAGE);
    store.setExploreFeedState({ exploreStatus: "idle" });
    void reloadHomeRef.current();
  }, []);

  const syncRemotePlaylists = useCallback(
    async (expectedGen?: number) => {
      const gen = expectedGen ?? sessionGenRef.current;
      await usePlayerStore.getState().refreshRemotePlaylists();
      if (gen !== sessionGenRef.current) return;
      const storeState = usePlayerStore.getState();
      if (
        storeState.authStatus === "guest" &&
        storeState.authNotice === SESSION_EXPIRED_MESSAGE
      ) {
        void reloadHomeRef.current();
      }
    },
    [],
  );

  const activateSession = useCallback(
    async (
      cookie: string,
      cachedUser: AuthUser | null,
      options: { reloadFeeds: boolean },
    ) => {
      const gen = ++sessionGenRef.current;
      setYTMusicAuthCookie(cookie);

      const store = usePlayerStore.getState();
      store.setAuthState({
        authStatus: "authenticated",
        authUser: cachedUser ?? { name: "Account Google" },
        authNotice: null,
        authHydrated: true,
      });

      try {
        const profile = await fetchAccountProfile();
        if (gen !== sessionGenRef.current) return;

        usePlayerStore.getState().setAuthState({
          authStatus: "authenticated",
          authUser: profile,
          authNotice: null,
        });

        await saveAuthSession(cookie, profile);
        if (gen !== sessionGenRef.current) return;

        if (options.reloadFeeds) {
          usePlayerStore
            .getState()
            .setExploreFeedState({ exploreStatus: "idle" });
          void reloadHomeRef.current();
        }

        await syncRemotePlaylists(gen);
      } catch (err: unknown) {
        if (gen !== sessionGenRef.current) return;

        if (isAuthExpiredError(err)) {
          await handleSessionExpired();
          return;
        }

        if (cachedUser) {
          // Anche se il profilo fallisce temporaneamente per rete, tenta comunque la sincronizzazione delle playlist
          await syncRemotePlaylists(gen);
          return;
        }

        setYTMusicAuthCookie(null);
        usePlayerStore.getState().resetAuthToGuest(formatNetworkError(err));
      }
    },
    [handleSessionExpired, syncRemotePlaylists],
  );

  useEffect(() => {
    let disposed = false;
    const bag = createListenerBag();

    const hydrate = async () => {
      const saved = await loadSavedAuthSession();
      if (disposed) return;

      if (saved) {
        await activateSession(saved.cookie, saved.user, {
          reloadFeeds: false,
        });
      } else {
        usePlayerStore.getState().setAuthState({ authHydrated: true });
      }
    };

    if (isTauriRuntime()) {
      bag.add(
        listen<LoginSuccessPayload>("auth:login-success", (event) => {
          const cookie = event.payload?.cookie?.trim();
          if (!cookie) return;
          void activateSession(cookie, null, { reloadFeeds: true });
        }),
      );
      bag.add(
        listen("auth:login-cancelled", () => {
          const store = usePlayerStore.getState();
          if (store.authStatus === "authenticating") {
            store.setAuthState({ authStatus: "guest" });
          }
        }),
      );
    }

    void hydrate();

    return () => {
      disposed = true;
      bag.dispose();
    };
  }, [activateSession]);

  const startLogin = useCallback(async () => {
    if (!isTauriRuntime()) {
      usePlayerStore
        .getState()
        .setAuthNotice(
          "L'accesso con account Google richiede la finestra nativa macOS.",
        );
      return;
    }

    const store = usePlayerStore.getState();
    store.setAuthState({ authStatus: "authenticating", authNotice: null });

    try {
      await invoke("open_ytm_login");
    } catch (err: unknown) {
      usePlayerStore.getState().setAuthState({
        authStatus: "guest",
        authNotice:
          err instanceof Error
            ? err.message
            : "Impossibile avviare la finestra di accesso Google.",
      });
    }
  }, []);

  const logout = useCallback(async () => {
    sessionGenRef.current += 1;

    if (isTauriRuntime()) {
      await invoke("close_ytm_login").catch(() => {});
    }

    await clearAuthSession();
    setYTMusicAuthCookie(null);

    const store = usePlayerStore.getState();
    store.resetAuthToGuest(null);
    store.setExploreFeedState({ exploreStatus: "idle" });
    void reloadHomeRef.current();
  }, []);

  const refreshRemotePlaylists = useCallback(() => {
    if (usePlayerStore.getState().authStatus !== "authenticated") return;
    void syncRemotePlaylists();
  }, [syncRemotePlaylists]);

  const handleAuthError = useCallback(
    (err: unknown) => {
      if (isAuthExpiredError(err)) {
        void handleSessionExpired();
      }
    },
    [handleSessionExpired],
  );

  return {
    startLogin,
    logout,
    refreshRemotePlaylists,
    handleAuthError,
  };
}
