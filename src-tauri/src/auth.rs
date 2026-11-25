use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const LOGIN_WINDOW_LABEL: &str = "ytm-login";
const MAIN_WINDOW_LABEL: &str = "main";
const LOGIN_URL: &str =
    "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F";
const SAFARI_USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

const EVENT_LOGIN_SUCCESS: &str = "auth:login-success";
const EVENT_LOGIN_CANCELLED: &str = "auth:login-cancelled";

const PRIMARY_SESSION_COOKIES: [&str; 6] = [
    "SID",
    "HSID",
    "SSID",
    "LOGIN_INFO",
    "__Secure-1PSID",
    "__Secure-3PSID",
];

const COOKIE_POLL_DELAYS_MS: [u64; 4] = [200, 450, 750, 1200];

#[derive(Clone, Serialize)]
pub struct LoginSuccessPayload {
    pub cookie: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RawCookie {
    name: String,
    value: String,
    domain: String,
}

fn normalize_domain(domain: &str) -> String {
    domain.trim().trim_start_matches('.').to_ascii_lowercase()
}

fn is_youtube_domain(domain: &str) -> bool {
    let normalized = normalize_domain(domain);
    normalized == "youtube.com" || normalized.ends_with(".youtube.com")
}

fn domain_priority(domain: &str) -> u8 {
    match normalize_domain(domain).as_str() {
        "music.youtube.com" => 3,
        "youtube.com" => 2,
        "www.youtube.com" => 1,
        _ => 0,
    }
}

/// Filtra e normalizza i cookie di YouTube, restituendo un header `Cookie` valido
/// solo se sono presenti i marker di una sessione autenticata (`SAPISID` /
/// `__Secure-3PAPISID` e almeno un cookie di sessione principale).
fn build_youtube_cookie_header(cookies: &[RawCookie]) -> Option<String> {
    let mut deduped: BTreeMap<String, (u8, String)> = BTreeMap::new();

    for cookie in cookies {
        let name = cookie.name.trim();
        let value = cookie.value.trim();
        if name.is_empty() || value.is_empty() || !is_youtube_domain(&cookie.domain) {
            continue;
        }

        let priority = domain_priority(&cookie.domain);
        match deduped.get(name) {
            Some((existing_priority, _)) if *existing_priority >= priority => {}
            _ => {
                deduped.insert(name.to_string(), (priority, value.to_string()));
            }
        }
    }

    let sapisid = deduped
        .get("SAPISID")
        .or_else(|| deduped.get("__Secure-3PAPISID"))
        .map(|(_, v)| v.clone())
        .filter(|v| !v.is_empty())?;

    let has_session_cookie = PRIMARY_SESSION_COOKIES
        .iter()
        .any(|key| deduped.contains_key(*key));
    if !has_session_cookie {
        return None;
    }

    // `youtubei.js` cerca esplicitamente `SAPISID` per calcolare `SAPISIDHASH`:
    // garantiamo che sia sempre il primo cookie nell'header (anche se Google ha
    // impostato solo `__Secure-3PAPISID`).
    let mut parts = Vec::with_capacity(deduped.len() + 1);
    parts.push(format!("SAPISID={sapisid}"));

    for (name, (_, value)) in &deduped {
        if name == "SAPISID" {
            continue;
        }
        parts.push(format!("{name}={value}"));
    }

    Some(parts.join("; "))
}

fn focus_window(window: &tauri::WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// Apre una Webview modale effimera (`incognito(true)`) per l'accesso locale
/// con account Google su YouTube Music senza salvare password nell'app.
#[tauri::command]
pub async fn open_ytm_login(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(LOGIN_WINDOW_LABEL) {
        focus_window(&existing);
        return Ok(());
    }

    let url = Url::parse(LOGIN_URL).map_err(|e| format!("URL login non valido: {e}"))?;
    let completed = Arc::new(AtomicBool::new(false));
    let polling = Arc::new(AtomicBool::new(false));

    let completed_load = Arc::clone(&completed);
    let polling_load = Arc::clone(&polling);
    let app_load = app.clone();

    let login_window =
        WebviewWindowBuilder::new(&app, LOGIN_WINDOW_LABEL, WebviewUrl::External(url))
            .title("Accedi a YouTube Music")
            .inner_size(520.0, 680.0)
            .min_inner_size(420.0, 560.0)
            .center()
            .resizable(true)
            .focused(true)
            .incognito(true)
            .user_agent(SAFARI_USER_AGENT)
            .on_page_load(move |window, payload| {
                if payload.event() != PageLoadEvent::Finished {
                    return;
                }
                if payload.url().host_str() != Some("music.youtube.com") {
                    return;
                }
                if completed_load.load(Ordering::SeqCst) {
                    return;
                }
                if polling_load
                    .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                    .is_err()
                {
                    return;
                }

                let completed_task = Arc::clone(&completed_load);
                let polling_task = Arc::clone(&polling_load);
                let app_task = app_load.clone();

                tauri::async_runtime::spawn(async move {
                    for delay_ms in COOKIE_POLL_DELAYS_MS {
                        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                        if completed_task.load(Ordering::SeqCst) {
                            break;
                        }

                        // Usiamo `window.cookies()` anziché `cookies_for_url()` perché su macOS
                        // `wry` confronta `cookie.domain() == url.domain()` in modo stretto,
                        // escludendo i cookie `.youtube.com` quando si interroga `music.youtube.com`.
                        let Ok(cookies) = window.cookies() else {
                            continue;
                        };
                        let raw: Vec<RawCookie> = cookies
                            .into_iter()
                            .map(|c| RawCookie {
                                name: c.name().to_string(),
                                value: c.value().to_string(),
                                domain: c.domain().unwrap_or("").to_string(),
                            })
                            .collect();

                        if let Some(cookie_header) = build_youtube_cookie_header(&raw) {
                            if !completed_task.swap(true, Ordering::SeqCst) {
                                let _ = app_task.emit_to(
                                    MAIN_WINDOW_LABEL,
                                    EVENT_LOGIN_SUCCESS,
                                    LoginSuccessPayload {
                                        cookie: cookie_header,
                                    },
                                );
                                let _ = window.close();
                                if let Some(main_win) =
                                    app_task.get_webview_window(MAIN_WINDOW_LABEL)
                                {
                                    focus_window(&main_win);
                                }
                            }
                            break;
                        }
                    }

                    polling_task.store(false, Ordering::SeqCst);
                });
            })
            .build()
            .map_err(|e| format!("Impossibile aprire la finestra di accesso: {e}"))?;

    let completed_close = Arc::clone(&completed);
    let app_close = app.clone();
    login_window.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event
            && !completed_close.load(Ordering::SeqCst)
        {
            let _ = app_close.emit_to(MAIN_WINDOW_LABEL, EVENT_LOGIN_CANCELLED, ());
        }
    });

    Ok(())
}

/// Chiude la finestra di accesso YouTube Music se attualmente aperta.
#[tauri::command]
pub fn close_ytm_login(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(LOGIN_WINDOW_LABEL) {
        existing
            .close()
            .map_err(|e| format!("Impossibile chiudere la finestra di accesso: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cookie(name: &str, value: &str, domain: &str) -> RawCookie {
        RawCookie {
            name: name.to_string(),
            value: value.to_string(),
            domain: domain.to_string(),
        }
    }

    #[test]
    fn domain_filter_matches_only_youtube_domains() {
        assert!(is_youtube_domain(".youtube.com"));
        assert!(is_youtube_domain("youtube.com"));
        assert!(is_youtube_domain("music.youtube.com"));
        assert!(is_youtube_domain(".music.youtube.com"));
        assert!(!is_youtube_domain("google.com"));
        assert!(!is_youtube_domain("accounts.google.com"));
        assert!(!is_youtube_domain("notyoutube.com"));
        assert!(!is_youtube_domain(""));
    }

    #[test]
    fn builds_cookie_header_for_authenticated_session_and_drops_foreign_cookies() {
        let cookies = vec![
            cookie("NID", "google-only", ".google.com"),
            cookie("HSID", "hsid-val", ".youtube.com"),
            cookie("SID", "sid-val", ".youtube.com"),
            cookie("SAPISID", "sapi-val", ".youtube.com"),
            cookie("LOGIN_INFO", "login-val", ".youtube.com"),
        ];

        let header = build_youtube_cookie_header(&cookies).expect("expected valid cookie header");
        assert!(header.starts_with("SAPISID=sapi-val; "));
        assert!(header.contains("SID=sid-val"));
        assert!(header.contains("HSID=hsid-val"));
        assert!(header.contains("LOGIN_INFO=login-val"));
        assert!(!header.contains("NID=google-only"));
    }

    #[test]
    fn synthesizes_sapisid_from_secure_3papisid_when_missing() {
        let cookies = vec![
            cookie("__Secure-3PAPISID", "sec3p-val", ".youtube.com"),
            cookie("__Secure-3PSID", "psid-val", ".youtube.com"),
        ];

        let header = build_youtube_cookie_header(&cookies).expect("expected valid cookie header");
        assert!(header.starts_with("SAPISID=sec3p-val; "));
        assert!(header.contains("__Secure-3PAPISID=sec3p-val"));
        assert!(header.contains("__Secure-3PSID=psid-val"));
    }

    #[test]
    fn rejects_guest_only_cookies() {
        let guest_cookies = vec![
            cookie("VISITOR_INFO1_LIVE", "visitor123", ".youtube.com"),
            cookie("CONSENT", "YES+1", ".youtube.com"),
            cookie("PREF", "tz=Europe.Rome", ".youtube.com"),
        ];
        assert!(build_youtube_cookie_header(&guest_cookies).is_none());

        let missing_session = vec![cookie("SAPISID", "only-sapisid", ".youtube.com")];
        assert!(build_youtube_cookie_header(&missing_session).is_none());
    }

    #[test]
    fn deduplicates_cookies_by_domain_priority() {
        let cookies = vec![
            cookie("SAPISID", "www-val", "www.youtube.com"),
            cookie("SAPISID", "root-val", ".youtube.com"),
            cookie("SAPISID", "music-val", "music.youtube.com"),
            cookie("SID", "sid-root", ".youtube.com"),
            cookie("SID", "sid-www", "www.youtube.com"),
        ];

        let header = build_youtube_cookie_header(&cookies).expect("expected valid cookie header");
        assert!(header.contains("SAPISID=music-val"));
        assert!(!header.contains("www-val"));
        assert!(!header.contains("root-val"));
        assert!(header.contains("SID=sid-root"));
        assert!(!header.contains("sid-www"));
    }
}
