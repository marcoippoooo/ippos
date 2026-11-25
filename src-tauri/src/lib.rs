mod audio_proxy;
mod auth;
mod discord;
mod media_remote;
mod offline_cache;
mod tray;

use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let offline_cache = Arc::new(
                offline_cache::OfflineCacheState::init(app.handle())
                    .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?,
            );
            let proxy = audio_proxy::AudioProxyState::start(Arc::clone(&offline_cache))
                .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?;
            app.manage(offline_cache);
            app.manage(proxy);
            app.manage(discord::DiscordRpcState::new());
            media_remote::setup_media_remote(app)?;
            tray::setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            audio_proxy::register_audio_stream,
            auth::open_ytm_login,
            auth::close_ytm_login,
            discord::init_discord_rpc,
            discord::set_discord_activity,
            discord::clear_discord_activity,
            media_remote::update_media_metadata,
            offline_cache::download_audio_to_cache,
            offline_cache::is_audio_cached,
            offline_cache::list_cached_audio_ids,
            offline_cache::remove_cached_audio,
            offline_cache::clear_offline_audio_cache,
            offline_cache::get_offline_cache_stats,
            tray::update_tray_state
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            if let Some(win) = app_handle.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
        if let tauri::RunEvent::Exit = event {
            app_handle.state::<discord::DiscordRpcState>().shutdown();
            media_remote::emit_stopped_on_exit();
        }
    });
}
