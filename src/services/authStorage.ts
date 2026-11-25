import { load, Store } from "@tauri-apps/plugin-store";
import { AuthUser } from "../types/music";

const AUTH_STORE_FILENAME = "auth_session.json";
const LOCAL_STORAGE_AUTH_KEY = "ippos.auth.v1";
const LEGACY_LOCAL_STORAGE_AUTH_KEY = "archivetune.auth.v1";

export interface PersistedAuthSession {
  cookie: string;
  user: AuthUser | null;
  savedAt: number;
}

let authStorePromise: Promise<Store | null> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeAuthUser(raw: unknown): AuthUser | null {
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;

  const handle =
    typeof raw.handle === "string" && raw.handle.trim()
      ? raw.handle.trim()
      : undefined;
  const avatar =
    typeof raw.avatar === "string" && raw.avatar.trim()
      ? raw.avatar.trim()
      : undefined;

  return { name, handle, avatar };
}

function validateAuthSession(raw: unknown): PersistedAuthSession | null {
  if (!isRecord(raw)) return null;
  const cookie = typeof raw.cookie === "string" ? raw.cookie.trim() : "";
  if (!cookie || !cookie.includes("SAPISID=")) return null;

  const savedAt =
    typeof raw.savedAt === "number" && Number.isFinite(raw.savedAt)
      ? raw.savedAt
      : Date.now();

  return {
    cookie,
    user: sanitizeAuthUser(raw.user),
    savedAt,
  };
}

async function getAuthStore(): Promise<Store | null> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return null;
  }
  if (!authStorePromise) {
    authStorePromise = load(AUTH_STORE_FILENAME, {
      autoSave: false,
      defaults: {},
    }).catch(() => null);
  }
  return authStorePromise;
}

export async function loadSavedAuthSession(): Promise<PersistedAuthSession | null> {
  try {
    const store = await getAuthStore();
    if (store) {
      const [cookie, user, savedAt] = await Promise.all([
        store.get<unknown>("cookie"),
        store.get<unknown>("user"),
        store.get<unknown>("savedAt"),
      ]);
      return validateAuthSession({ cookie, user, savedAt });
    }

    const raw =
      window.localStorage.getItem(LOCAL_STORAGE_AUTH_KEY) ??
      window.localStorage.getItem(LEGACY_LOCAL_STORAGE_AUTH_KEY);
    if (!raw) return null;
    const validated = validateAuthSession(JSON.parse(raw));
    if (validated && !window.localStorage.getItem(LOCAL_STORAGE_AUTH_KEY)) {
      window.localStorage.setItem(
        LOCAL_STORAGE_AUTH_KEY,
        JSON.stringify(validated),
      );
    }
    return validated;
  } catch {
    return null;
  }
}

export async function saveAuthSession(
  cookie: string,
  user: AuthUser | null,
): Promise<void> {
  const session: PersistedAuthSession = {
    cookie: cookie.trim(),
    user,
    savedAt: Date.now(),
  };

  try {
    const store = await getAuthStore();
    if (store) {
      await Promise.all([
        store.set("cookie", session.cookie),
        store.set("user", session.user),
        store.set("savedAt", session.savedAt),
      ]);
      await store.save();
      return;
    }

    window.localStorage.setItem(LOCAL_STORAGE_AUTH_KEY, JSON.stringify(session));
  } catch {
    // Non bloccare la sessione attiva per errori di I/O su disco
  }
}

export async function clearAuthSession(): Promise<void> {
  try {
    const store = await getAuthStore();
    if (store) {
      await Promise.all([
        store.delete("cookie"),
        store.delete("user"),
        store.delete("savedAt"),
      ]);
      await store.save();
    }
  } catch {
    // Best-effort cleanup
  }

  try {
    window.localStorage.removeItem(LOCAL_STORAGE_AUTH_KEY);
    window.localStorage.removeItem(LEGACY_LOCAL_STORAGE_AUTH_KEY);
  } catch {
    // Ignore outside browser/storage contexts
  }
}
