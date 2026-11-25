import { fetch as pluginFetch } from "@tauri-apps/plugin-http";

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Adapter di fetch compatibile con la firma standard Fetch API,
 * instradato tramite `@tauri-apps/plugin-http` sul runtime Rust per evitare
 * restrizioni CORS della WKWebView di macOS.
 */
export async function tauriFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();

  // Costruiamo un Headers separato per preservare anche header normalmente
  // filtrati dal browser prima dell'invio verso il backend Rust.
  const headers = new Headers();
  if (input instanceof Request) {
    input.headers.forEach((value, key) => {
      headers.set(key, value);
    });
  }
  if (init?.headers) {
    const initHeaders = new Headers(init.headers);
    initHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  let origin = "https://www.youtube.com";
  try {
    origin = new URL(url).origin;
  } catch {
    // Fallback sicuro se l'URL fosse relativo o malformato
  }

  if (!headers.has("user-agent")) {
    headers.set("user-agent", DESKTOP_USER_AGENT);
  }
  if (method !== "GET" && method !== "HEAD" && !headers.has("origin")) {
    headers.set("origin", origin);
  }
  if (!headers.has("referer")) {
    headers.set("referer", `${origin}/`);
  }
  if (
    headers.get("authorization")?.startsWith("SAPISIDHASH") &&
    !headers.has("x-origin")
  ) {
    headers.set("x-origin", origin);
  }

  let body: BodyInit | undefined = init?.body ?? undefined;
  if (
    body === undefined &&
    input instanceof Request &&
    method !== "GET" &&
    method !== "HEAD"
  ) {
    const buffer = await input.clone().arrayBuffer();
    if (buffer.byteLength > 0) {
      body = buffer;
    }
  }

  const requestInit: RequestInit & { connectTimeout?: number } = {
    method,
    headers,
    redirect: init?.redirect ?? (input instanceof Request ? input.redirect : "follow"),
    signal: init?.signal ?? (input instanceof Request ? input.signal : undefined),
    connectTimeout: 15000,
  };

  if (method !== "GET" && method !== "HEAD" && body !== undefined) {
    requestInit.body = body;
  }

  return pluginFetch(url, requestInit);
}
