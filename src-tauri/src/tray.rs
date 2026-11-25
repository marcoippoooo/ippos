use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, Wry};

const TRAY_ID: &str = "main-tray";
const MAX_LABEL_CHARS: usize = 42;

pub struct TrayMenuHandles {
    pub now_playing_item: MenuItem<Wry>,
    pub play_pause_item: MenuItem<Wry>,
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    let mut chars = text.chars();
    let collected: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{collected}…")
    } else {
        collected
    }
}

pub fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let now_playing_item = MenuItem::with_id(
        app,
        "tray_now_playing",
        "Nessun brano in riproduzione",
        false,
        None::<&str>,
    )?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let play_pause_item =
        MenuItem::with_id(app, "tray_play_pause", "Riproduci", true, None::<&str>)?;
    let next_item = MenuItem::with_id(app, "tray_next", "Traccia successiva", true, None::<&str>)?;
    let prev_item =
        MenuItem::with_id(app, "tray_prev", "Traccia precedente", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let toggle_window_item = MenuItem::with_id(
        app,
        "tray_toggle_window",
        "Mostra / Nascondi IPPOS",
        true,
        None::<&str>,
    )?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit_item =
        MenuItem::with_id(app, "tray_quit", "Esci da IPPOS", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &now_playing_item,
            &sep1,
            &play_pause_item,
            &next_item,
            &prev_item,
            &sep2,
            &toggle_window_item,
            &sep3,
            &quit_item,
        ],
    )?;

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(false)
        .tooltip("IPPOS")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_play_pause" => {
                let _ = app.emit("tray:toggle-play", ());
            }
            "tray_next" => {
                let _ = app.emit("tray:next", ());
            }
            "tray_prev" => {
                let _ = app.emit("tray:previous", ());
            }
            "tray_toggle_window" => {
                if let Some(win) = app.get_webview_window("main") {
                    let is_visible = win.is_visible().unwrap_or(false);
                    let is_focused = win.is_focused().unwrap_or(false);
                    if is_visible && is_focused {
                        let _ = win.hide();
                    } else {
                        let _ = win.unminimize();
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            }
            "tray_quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    app.manage(TrayMenuHandles {
        now_playing_item,
        play_pause_item,
    });

    Ok(())
}

#[tauri::command]
pub fn update_tray_state(
    app: tauri::AppHandle,
    handles: tauri::State<'_, TrayMenuHandles>,
    title: Option<String>,
    artist: Option<String>,
    is_playing: bool,
) -> Result<(), String> {
    let now_playing_label = match title.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
        Some(t) => {
            let full = match artist.map(|a| a.trim().to_string()).filter(|a| !a.is_empty()) {
                Some(a) => format!("{t} — {a}"),
                None => t,
            };
            truncate_chars(&full, MAX_LABEL_CHARS)
        }
        None => "Nessun brano in riproduzione".to_string(),
    };

    handles
        .now_playing_item
        .set_text(&now_playing_label)
        .map_err(|e| format!("Failed to update tray track title: {e}"))?;

    handles
        .play_pause_item
        .set_text(if is_playing { "Pausa" } else { "Riproduci" })
        .map_err(|e| format!("Failed to update tray play/pause label: {e}"))?;

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let tooltip = if now_playing_label == "Nessun brano in riproduzione" {
            "IPPOS".to_string()
        } else {
            format!("IPPOS — {now_playing_label}")
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }

    Ok(())
}
