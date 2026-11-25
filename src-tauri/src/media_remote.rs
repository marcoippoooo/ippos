use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};

pub const DIST_NOTIF_PLAYBACK_CHANGED: &str = "com.archivetune.playbackStateChanged";
pub const DIST_NOTIF_COMMAND: &str = "com.archivetune.command";
pub const DIST_NOTIF_SENDER_OBJECT: &str = "com.marcoippolito.archivetune-mac";
pub const IPC_EVENT_PLAYER_COMMAND: &str = "player:command";

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaMetadataPayload {
    #[serde(default)]
    pub track_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    pub current_time: f64,
    pub playback_state: String,
    pub artwork_url: String,
    #[serde(default)]
    pub shuffle: bool,
    #[serde(default)]
    pub repeat: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerCommandPayload {
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<f64>,
}

struct MediaRemoteInner {
    last_payload: Option<MediaMetadataPayload>,
    artwork_url: String,
    artwork_generation: u64,
}

pub struct MediaRemoteState {
    inner: Mutex<MediaRemoteInner>,
    http_client: reqwest::Client,
}

impl MediaRemoteState {
    fn new() -> Result<Self, String> {
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .build()
            .map_err(|e| format!("Impossibile inizializzare HTTP client artwork: {e}"))?;

        Ok(Self {
            inner: Mutex::new(MediaRemoteInner {
                last_payload: None,
                artwork_url: String::new(),
                artwork_generation: 0,
            }),
            http_client,
        })
    }

    pub(crate) fn snapshot_or_default(&self) -> MediaMetadataPayload {
        self.inner
            .lock()
            .ok()
            .and_then(|guard| guard.last_payload.clone())
            .unwrap_or_else(default_stopped_payload)
    }
}

pub fn default_stopped_payload() -> MediaMetadataPayload {
    MediaMetadataPayload {
        track_id: String::new(),
        title: String::new(),
        artist: String::new(),
        album: String::new(),
        duration: 0.0,
        current_time: 0.0,
        playback_state: "stopped".to_string(),
        artwork_url: String::new(),
        shuffle: false,
        repeat: "off".to_string(),
    }
}

pub fn normalize_repeat_mode(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "all" => "all",
        "one" => "one",
        _ => "off",
    }
}

pub fn normalize_playback_state(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "playing" => "playing",
        "paused" => "paused",
        _ => "stopped",
    }
}

pub fn sanitize_seconds(value: f64) -> f64 {
    if value.is_finite() && value >= 0.0 {
        value
    } else {
        0.0
    }
}

pub fn parse_command_name(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "play" => Some("play"),
        "pause" | "stop" => Some("pause"),
        "toggleplaypause" | "toggle" | "playpause" | "play_pause" => Some("togglePlayPause"),
        "next" | "nexttrack" | "next_track" => Some("next"),
        "previous" | "prev" | "previoustrack" | "previous_track" => Some("previous"),
        "seekto" | "seek" | "seek_to" | "changeposition" => Some("seekTo"),
        "requeststate" | "request_state" | "sync" => Some("requestState"),
        "toggleshuffle" | "shuffle" | "toggle_shuffle" => Some("toggleShuffle"),
        "togglerepeat" | "cyclerepeat" | "repeat" | "toggle_repeat" => Some("toggleRepeat"),
        _ => None,
    }
}

pub fn is_allowed_artwork_url(url_str: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url_str.trim()) else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }
    let Some(host) = parsed.host_str().map(|h| h.to_ascii_lowercase()) else {
        return false;
    };
    ["googleusercontent.com", "ytimg.com", "ggpht.com"]
        .iter()
        .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
}

fn normalize_payload(payload: MediaMetadataPayload) -> MediaMetadataPayload {
    MediaMetadataPayload {
        track_id: payload.track_id.trim().to_string(),
        title: payload.title.trim().to_string(),
        artist: payload.artist.trim().to_string(),
        album: payload.album.trim().to_string(),
        duration: sanitize_seconds(payload.duration),
        current_time: sanitize_seconds(payload.current_time),
        playback_state: normalize_playback_state(&payload.playback_state).to_string(),
        artwork_url: payload.artwork_url.trim().to_string(),
        shuffle: payload.shuffle,
        repeat: normalize_repeat_mode(&payload.repeat).to_string(),
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use block2::RcBlock;
    use objc2::rc::{Allocated, Retained};
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::{define_class, msg_send, sel, AnyThread, DefinedClass};
    use objc2_app_kit::NSImage;
    use objc2_foundation::{
        ns_string, NSData, NSDictionary, NSDistributedNotificationCenter, NSMutableDictionary,
        NSNotification, NSNotificationSuspensionBehavior, NSNumber, NSObject, NSObjectProtocol,
        NSSize, NSString,
    };
    use std::cell::RefCell;
    use std::ptr::NonNull;

    const MAX_ARTWORK_BYTES: usize = 5 * 1024 * 1024;

    #[link(name = "MediaPlayer", kind = "framework")]
    unsafe extern "C" {
        static MPMediaItemPropertyTitle: &'static NSString;
        static MPMediaItemPropertyArtist: &'static NSString;
        static MPMediaItemPropertyAlbumTitle: &'static NSString;
        static MPMediaItemPropertyPlaybackDuration: &'static NSString;
        static MPMediaItemPropertyArtwork: &'static NSString;
        static MPNowPlayingInfoPropertyElapsedPlaybackTime: &'static NSString;
        static MPNowPlayingInfoPropertyPlaybackRate: &'static NSString;
        static MPNowPlayingInfoPropertyDefaultPlaybackRate: &'static NSString;
        static MPNowPlayingInfoPropertyMediaType: &'static NSString;
    }

    pub(super) struct CommandObserverIvars {
        app_handle: tauri::AppHandle,
    }

    define_class!(
        // SAFETY:
        // - `NSObject` ha nessuna restrizione specifica sulle sottoclassi.
        // - `ArchiveTuneCommandObserver` non implementa `Drop`.
        #[unsafe(super(NSObject))]
        #[name = "ArchiveTuneCommandObserver"]
        #[ivars = CommandObserverIvars]
        pub(super) struct ArchiveTuneCommandObserver;

        impl ArchiveTuneCommandObserver {
            #[unsafe(method(handleCommandNotification:))]
            fn handle_command_notification(&self, notification: &NSNotification) {
                let Some(payload) = extract_command_from_notification(notification) else {
                    return;
                };
                let app_handle = &self.ivars().app_handle;

                if payload.command == "requestState" {
                    let snapshot = app_handle.state::<MediaRemoteState>().snapshot_or_default();
                    post_distributed_playback_state(&snapshot);
                    return;
                }

                let _ = app_handle.emit(IPC_EVENT_PLAYER_COMMAND, payload);
            }
        }

        unsafe impl NSObjectProtocol for ArchiveTuneCommandObserver {}
    );

    impl ArchiveTuneCommandObserver {
        fn new(app_handle: tauri::AppHandle) -> Retained<Self> {
            let this = Self::alloc().set_ivars(CommandObserverIvars { app_handle });
            unsafe { msg_send![super(this), init] }
        }
    }

    struct NativeMediaHandles {
        observer: Retained<ArchiveTuneCommandObserver>,
        _command_targets: Vec<Retained<AnyObject>>,
    }

    thread_local! {
        static NATIVE_HANDLES: RefCell<Option<NativeMediaHandles>> = const { RefCell::new(None) };
        static ARTWORK_CACHE: RefCell<Option<(String, Retained<AnyObject>)>> = const { RefCell::new(None) };
    }

    #[inline]
    fn insert_obj<T: objc2::Message>(
        dict: &NSMutableDictionary<NSString, AnyObject>,
        key: &NSString,
        val: &T,
    ) {
        let obj: &AnyObject = unsafe { &*((val as *const T).cast::<AnyObject>()) };
        dict.insert(key, obj);
    }

    #[inline]
    fn insert_str(dict: &NSMutableDictionary<NSString, AnyObject>, key: &NSString, val: &str) {
        let ns_val = NSString::from_str(val);
        insert_obj(dict, key, &*ns_val);
    }

    #[inline]
    fn insert_f64(dict: &NSMutableDictionary<NSString, AnyObject>, key: &NSString, val: f64) {
        let num = NSNumber::numberWithDouble(sanitize_seconds(val));
        insert_obj(dict, key, &*num);
    }

    #[inline]
    fn insert_bool(dict: &NSMutableDictionary<NSString, AnyObject>, key: &NSString, val: bool) {
        let num = NSNumber::numberWithBool(val);
        insert_obj(dict, key, &*num);
    }

    pub(super) fn build_user_info_dict(
        payload: &MediaMetadataPayload,
    ) -> Retained<NSDictionary<NSString, AnyObject>> {
        let dict = NSMutableDictionary::<NSString, AnyObject>::new();
        insert_str(&dict, ns_string!("trackId"), &payload.track_id);
        insert_str(&dict, ns_string!("title"), &payload.title);
        insert_str(&dict, ns_string!("artist"), &payload.artist);
        insert_str(&dict, ns_string!("album"), &payload.album);
        insert_f64(&dict, ns_string!("duration"), payload.duration);
        insert_f64(&dict, ns_string!("currentTime"), payload.current_time);
        insert_str(
            &dict,
            ns_string!("playbackState"),
            normalize_playback_state(&payload.playback_state),
        );
        insert_str(&dict, ns_string!("artworkUrl"), &payload.artwork_url);
        insert_bool(&dict, ns_string!("shuffle"), payload.shuffle);
        insert_str(
            &dict,
            ns_string!("repeat"),
            normalize_repeat_mode(&payload.repeat),
        );

        // SAFETY: `NSMutableDictionary` è sottoclasse di `NSDictionary`; `into_super()` restituisce `&NSDictionary<NSString, AnyObject>`.
        Retained::into_super(dict)
    }

    pub(super) fn post_distributed_playback_state(payload: &MediaMetadataPayload) {
        let user_info = build_user_info_dict(payload);
        let untyped: &NSDictionary = unsafe { user_info.cast_unchecked::<AnyObject, AnyObject>() };
        let center = NSDistributedNotificationCenter::defaultCenter();
        let notif_name = ns_string!(DIST_NOTIF_PLAYBACK_CHANGED);
        let sender_obj = ns_string!(DIST_NOTIF_SENDER_OBJECT);

        unsafe {
            center.postNotificationName_object_userInfo_deliverImmediately(
                notif_name,
                Some(sender_obj),
                Some(untyped),
                true,
            );
        }
    }

    fn read_string_from_dict(dict: &NSDictionary, key: &NSString) -> Option<String> {
        let key_obj: &AnyObject = unsafe { &*((key as *const NSString).cast::<AnyObject>()) };
        let value = dict.objectForKey(key_obj)?;
        let ns_str = value.downcast::<NSString>().ok()?;
        let text = ns_str.to_string();
        if text.trim().is_empty() {
            None
        } else {
            Some(text)
        }
    }

    fn read_f64_from_dict(dict: &NSDictionary, key: &NSString) -> Option<f64> {
        let key_obj: &AnyObject = unsafe { &*((key as *const NSString).cast::<AnyObject>()) };
        let value = dict.objectForKey(key_obj)?;

        if let Ok(num) = value.clone().downcast::<NSNumber>() {
            let v = num.doubleValue();
            return (v.is_finite() && v >= 0.0).then_some(v);
        }

        if let Ok(ns_str) = value.downcast::<NSString>()
            && let Ok(v) = ns_str.to_string().trim().parse::<f64>()
        {
            return (v.is_finite() && v >= 0.0).then_some(v);
        }

        None
    }

    pub(super) fn extract_command_from_notification(
        notification: &NSNotification,
    ) -> Option<PlayerCommandPayload> {
        let user_info = notification.userInfo();

        let raw_command = user_info
            .as_ref()
            .and_then(|dict| {
                read_string_from_dict(dict, ns_string!("command"))
                    .or_else(|| read_string_from_dict(dict, ns_string!("action")))
            })
            .or_else(|| {
                notification
                    .object()
                    .and_then(|obj| obj.downcast::<NSString>().ok())
                    .map(|s| s.to_string())
            })?;

        let command = parse_command_name(&raw_command)?;
        let position = if command == "seekTo" {
            user_info.as_ref().and_then(|dict| {
                read_f64_from_dict(dict, ns_string!("position"))
                    .or_else(|| read_f64_from_dict(dict, ns_string!("time")))
                    .or_else(|| read_f64_from_dict(dict, ns_string!("currentTime")))
            })
        } else {
            None
        };

        Some(PlayerCommandPayload {
            command: command.to_string(),
            position,
        })
    }

    fn update_now_playing_info(payload: &MediaMetadataPayload) {
        let Some(center_cls) = AnyClass::get(c"MPNowPlayingInfoCenter") else {
            return;
        };
        let center: Retained<AnyObject> = unsafe { msg_send![center_cls, defaultCenter] };
        let state_str = normalize_playback_state(&payload.playback_state);

        if state_str == "stopped" && payload.title.is_empty() {
            let _: () = unsafe { msg_send![&center, setNowPlayingInfo: Option::<&NSDictionary>::None] };
            let _: () = unsafe { msg_send![&center, setPlaybackState: 3usize] };
            return;
        }

        let dict = NSMutableDictionary::<NSString, AnyObject>::new();
        let album = if payload.album.is_empty() {
            "IPPOS"
        } else {
            payload.album.as_str()
        };

        unsafe {
            insert_str(&dict, MPMediaItemPropertyTitle, &payload.title);
            insert_str(&dict, MPMediaItemPropertyArtist, &payload.artist);
            insert_str(&dict, MPMediaItemPropertyAlbumTitle, album);
            insert_f64(&dict, MPMediaItemPropertyPlaybackDuration, payload.duration);
            insert_f64(
                &dict,
                MPNowPlayingInfoPropertyElapsedPlaybackTime,
                payload.current_time,
            );

            let rate = if state_str == "playing" { 1.0 } else { 0.0 };
            let rate_num = NSNumber::numberWithDouble(rate);
            let default_rate_num = NSNumber::numberWithDouble(1.0);
            let media_type_audio = NSNumber::numberWithUnsignedInteger(1);

            insert_obj(&dict, MPNowPlayingInfoPropertyPlaybackRate, &*rate_num);
            insert_obj(
                &dict,
                MPNowPlayingInfoPropertyDefaultPlaybackRate,
                &*default_rate_num,
            );
            insert_obj(&dict, MPNowPlayingInfoPropertyMediaType, &*media_type_audio);

            if !payload.artwork_url.is_empty() {
                ARTWORK_CACHE.with(|cache| {
                    if let Some((cached_url, artwork)) = cache.borrow().as_ref()
                        && cached_url == &payload.artwork_url
                    {
                        insert_obj(&dict, MPMediaItemPropertyArtwork, &**artwork);
                    }
                });
            }
        }

        let untyped: &NSDictionary = unsafe { dict.cast_unchecked::<AnyObject, AnyObject>() };
        let _: () = unsafe { msg_send![&center, setNowPlayingInfo: Some(untyped)] };

        // MPNowPlayingPlaybackState: 1 = Playing, 2 = Paused, 3 = Stopped
        let playback_state_enum: usize = match state_str {
            "playing" => 1,
            "paused" => 2,
            _ => 3,
        };
        let _: () = unsafe { msg_send![&center, setPlaybackState: playback_state_enum] };
    }

    fn bind_simple_remote_command(
        center: &AnyObject,
        selector_name: &str,
        app_handle: &tauri::AppHandle,
        command_name: &'static str,
    ) -> Option<Retained<AnyObject>> {
        let cmd: Retained<AnyObject> = match selector_name {
            "playCommand" => unsafe { msg_send![center, playCommand] },
            "pauseCommand" => unsafe { msg_send![center, pauseCommand] },
            "togglePlayPauseCommand" => unsafe { msg_send![center, togglePlayPauseCommand] },
            "stopCommand" => unsafe { msg_send![center, stopCommand] },
            "nextTrackCommand" => unsafe { msg_send![center, nextTrackCommand] },
            "previousTrackCommand" => unsafe { msg_send![center, previousTrackCommand] },
            _ => return None,
        };

        let _: () = unsafe { msg_send![&cmd, setEnabled: true] };

        let app = app_handle.clone();
        let block = RcBlock::new(move |_event: NonNull<AnyObject>| -> isize {
            let _ = app.emit(
                IPC_EVENT_PLAYER_COMMAND,
                PlayerCommandPayload {
                    command: command_name.to_string(),
                    position: None,
                },
            );
            0 // MPRemoteCommandHandlerStatusSuccess
        });

        let target: Retained<AnyObject> =
            unsafe { msg_send![&cmd, addTargetWithHandler: &*block] };
        Some(target)
    }

    fn register_remote_commands(app_handle: &tauri::AppHandle) -> Vec<Retained<AnyObject>> {
        let Some(cls) = AnyClass::get(c"MPRemoteCommandCenter") else {
            return Vec::new();
        };
        let center: Retained<AnyObject> = unsafe { msg_send![cls, sharedCommandCenter] };

        let mut targets = Vec::new();
        for (selector, cmd_name) in [
            ("playCommand", "play"),
            ("pauseCommand", "pause"),
            ("togglePlayPauseCommand", "togglePlayPause"),
            ("stopCommand", "pause"),
            ("nextTrackCommand", "next"),
            ("previousTrackCommand", "previous"),
        ] {
            if let Some(target) = bind_simple_remote_command(&center, selector, app_handle, cmd_name)
            {
                targets.push(target);
            }
        }

        let seek_cmd: Retained<AnyObject> =
            unsafe { msg_send![&center, changePlaybackPositionCommand] };
        let _: () = unsafe { msg_send![&seek_cmd, setEnabled: true] };

        let app = app_handle.clone();
        let seek_block = RcBlock::new(move |event: NonNull<AnyObject>| -> isize {
            let pos: f64 = unsafe { msg_send![event.as_ref(), positionTime] };
            let _ = app.emit(
                IPC_EVENT_PLAYER_COMMAND,
                PlayerCommandPayload {
                    command: "seekTo".to_string(),
                    position: Some(sanitize_seconds(pos)),
                },
            );
            0 // MPRemoteCommandHandlerStatusSuccess
        });
        let seek_target: Retained<AnyObject> =
            unsafe { msg_send![&seek_cmd, addTargetWithHandler: &*seek_block] };
        targets.push(seek_target);

        targets
    }

    pub(super) fn init(app_handle: &tauri::AppHandle) {
        let observer = ArchiveTuneCommandObserver::new(app_handle.clone());
        let center = NSDistributedNotificationCenter::defaultCenter();
        unsafe {
            center.addObserver_selector_name_object_suspensionBehavior(
                &observer,
                sel!(handleCommandNotification:),
                Some(ns_string!(DIST_NOTIF_COMMAND)),
                None,
                NSNotificationSuspensionBehavior::DeliverImmediately,
            );
        }

        let command_targets = register_remote_commands(app_handle);

        NATIVE_HANDLES.with(|slot| {
            *slot.borrow_mut() = Some(NativeMediaHandles {
                observer,
                _command_targets: command_targets,
            });
        });
    }

    pub(super) fn apply_metadata_on_main(payload: &MediaMetadataPayload) {
        post_distributed_playback_state(payload);
        update_now_playing_info(payload);
    }

    pub(super) fn install_artwork_bytes_on_main(
        app_handle: &tauri::AppHandle,
        artwork_url: String,
        generation: u64,
        bytes: Vec<u8>,
    ) {
        let still_current = app_handle
            .state::<MediaRemoteState>()
            .inner
            .lock()
            .map(|guard| {
                guard.artwork_generation == generation && guard.artwork_url == artwork_url
            })
            .unwrap_or(false);

        if !still_current {
            return;
        }

        let Some(artwork_cls) = AnyClass::get(c"MPMediaItemArtwork") else {
            return;
        };

        let ns_data = NSData::with_bytes(&bytes);
        let Some(image) = NSImage::initWithData(NSImage::alloc(), &ns_data) else {
            return;
        };

        let size: NSSize = image.size();
        if size.width <= 0.0 || size.height <= 0.0 {
            return;
        }

        let handler = RcBlock::new(move |_requested_size: NSSize| -> NonNull<NSImage> {
            NonNull::from(&*image)
        });

        let allocated: Allocated<AnyObject> = unsafe { msg_send![artwork_cls, alloc] };
        let artwork: Option<Retained<AnyObject>> = unsafe {
            msg_send![allocated, initWithBoundsSize: size, requestHandler: &*handler]
        };

        let Some(artwork) = artwork else {
            return;
        };

        ARTWORK_CACHE.with(|cache| {
            *cache.borrow_mut() = Some((artwork_url.clone(), artwork));
        });

        let latest = app_handle.state::<MediaRemoteState>().snapshot_or_default();
        if latest.artwork_url == artwork_url {
            update_now_playing_info(&latest);
        }
    }

    pub(super) fn spawn_artwork_fetch(
        app_handle: tauri::AppHandle,
        client: reqwest::Client,
        artwork_url: String,
        generation: u64,
    ) {
        tauri::async_runtime::spawn(async move {
            let Ok(resp) = client.get(&artwork_url).send().await else {
                return;
            };
            if !resp.status().is_success() {
                return;
            }
            if let Some(len) = resp.content_length()
                && len as usize > MAX_ARTWORK_BYTES
            {
                return;
            }
            let Ok(bytes) = resp.bytes().await else {
                return;
            };
            if bytes.is_empty() || bytes.len() > MAX_ARTWORK_BYTES {
                return;
            }

            let bytes_vec = bytes.to_vec();
            let app_for_main = app_handle.clone();
            let _ = app_handle.run_on_main_thread(move || {
                install_artwork_bytes_on_main(&app_for_main, artwork_url, generation, bytes_vec);
            });
        });
    }

    pub(super) fn shutdown() {
        let stopped = default_stopped_payload();
        post_distributed_playback_state(&stopped);
        update_now_playing_info(&stopped);

        NATIVE_HANDLES.with(|slot| {
            if let Some(handles) = slot.borrow_mut().take() {
                let center = NSDistributedNotificationCenter::defaultCenter();
                unsafe {
                    center.removeObserver_name_object(
                        &handles.observer,
                        Some(ns_string!(DIST_NOTIF_COMMAND)),
                        None,
                    );
                }
            }
        });

        ARTWORK_CACHE.with(|cache| {
            *cache.borrow_mut() = None;
        });
    }
}

#[cfg(target_os = "macos")]
pub fn setup_media_remote(app: &tauri::App) -> tauri::Result<()> {
    let state = MediaRemoteState::new()
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?;
    app.manage(state);
    macos::init(app.handle());
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn setup_media_remote(app: &tauri::App) -> tauri::Result<()> {
    let state = MediaRemoteState::new()
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?;
    app.manage(state);
    Ok(())
}

#[tauri::command]
pub fn update_media_metadata(
    app: tauri::AppHandle,
    state: tauri::State<'_, MediaRemoteState>,
    payload: MediaMetadataPayload,
) -> Result<(), String> {
    let normalized = normalize_payload(payload);

    #[cfg(target_os = "macos")]
    {
        let artwork_to_fetch: Option<(String, u64)> = {
            let mut guard = state
                .inner
                .lock()
                .map_err(|_| "Impossibile acquisire lock stato media".to_string())?;

            let url_changed = normalized.artwork_url != guard.artwork_url;
            guard.last_payload = Some(normalized.clone());

            if url_changed {
                guard.artwork_url = normalized.artwork_url.clone();
                guard.artwork_generation += 1;
                if is_allowed_artwork_url(&normalized.artwork_url) {
                    Some((normalized.artwork_url.clone(), guard.artwork_generation))
                } else {
                    None
                }
            } else {
                None
            }
        };

        let payload_for_main = normalized;
        app.run_on_main_thread(move || {
            macos::apply_metadata_on_main(&payload_for_main);
        })
        .map_err(|e| format!("Impossibile aggiornare media center macOS: {e}"))?;

        if let Some((artwork_url, generation)) = artwork_to_fetch {
            macos::spawn_artwork_fetch(
                app,
                state.http_client.clone(),
                artwork_url,
                generation,
            );
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        if let Ok(mut guard) = state.inner.lock() {
            guard.last_payload = Some(normalized);
        }
    }

    Ok(())
}

pub fn emit_stopped_on_exit() {
    #[cfg(target_os = "macos")]
    {
        macos::shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_commands_and_aliases() {
        assert_eq!(parse_command_name("play"), Some("play"));
        assert_eq!(parse_command_name("PAUSE"), Some("pause"));
        assert_eq!(parse_command_name("stop"), Some("pause"));
        assert_eq!(parse_command_name("togglePlayPause"), Some("togglePlayPause"));
        assert_eq!(parse_command_name("toggle"), Some("togglePlayPause"));
        assert_eq!(parse_command_name("play_pause"), Some("togglePlayPause"));
        assert_eq!(parse_command_name("next"), Some("next"));
        assert_eq!(parse_command_name("nextTrack"), Some("next"));
        assert_eq!(parse_command_name("previous"), Some("previous"));
        assert_eq!(parse_command_name("prev"), Some("previous"));
        assert_eq!(parse_command_name("seekTo"), Some("seekTo"));
        assert_eq!(parse_command_name("seek"), Some("seekTo"));
        assert_eq!(parse_command_name("requestState"), Some("requestState"));
        assert_eq!(parse_command_name("unknownCommand"), None);
        assert_eq!(parse_command_name(""), None);
    }

    #[test]
    fn normalizes_playback_state_and_seconds() {
        assert_eq!(normalize_playback_state("playing"), "playing");
        assert_eq!(normalize_playback_state(" PLAYING "), "playing");
        assert_eq!(normalize_playback_state("paused"), "paused");
        assert_eq!(normalize_playback_state("stopped"), "stopped");
        assert_eq!(normalize_playback_state("idle"), "stopped");

        assert_eq!(sanitize_seconds(124.5), 124.5);
        assert_eq!(sanitize_seconds(-3.0), 0.0);
        assert_eq!(sanitize_seconds(f64::NAN), 0.0);
        assert_eq!(sanitize_seconds(f64::INFINITY), 0.0);
    }

    #[test]
    fn validates_allowed_https_artwork_hosts_only() {
        assert!(is_allowed_artwork_url(
            "https://lh3.googleusercontent.com/abc=w544-h544"
        ));
        assert!(is_allowed_artwork_url(
            "https://i.ytimg.com/vi/xyz/hqdefault.jpg"
        ));
        assert!(is_allowed_artwork_url(
            "https://yt3.ggpht.com/avatar=s120"
        ));
        assert!(!is_allowed_artwork_url("http://lh3.googleusercontent.com/a"));
        assert!(!is_allowed_artwork_url("https://evil.example.com/a.jpg"));
        assert!(!is_allowed_artwork_url("data:image/svg+xml;utf8,<svg/>"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn builds_user_info_and_parses_distributed_notifications() {
        use objc2::rc::Retained;
        use objc2::runtime::AnyObject;
        use objc2_foundation::{ns_string, NSDictionary, NSMutableDictionary, NSNotification, NSNumber, NSString};

        let payload = MediaMetadataPayload {
            track_id: "dQw4w9WgXcQ".to_string(),
            title: "Test Track".to_string(),
            artist: "Test Artist".to_string(),
            album: "Test Album".to_string(),
            duration: 215.5,
            current_time: 42.25,
            playback_state: "playing".to_string(),
            artwork_url: "https://lh3.googleusercontent.com/cover=w544-h544".to_string(),
            shuffle: true,
            repeat: "all".to_string(),
        };

        let dict = macos::build_user_info_dict(&payload);
        assert_eq!(
            dict.objectForKey(ns_string!("title"))
                .unwrap()
                .downcast::<NSString>()
                .unwrap()
                .to_string(),
            "Test Track"
        );
        assert_eq!(
            dict.objectForKey(ns_string!("playbackState"))
                .unwrap()
                .downcast::<NSString>()
                .unwrap()
                .to_string(),
            "playing"
        );
        assert_eq!(
            dict.objectForKey(ns_string!("duration"))
                .unwrap()
                .downcast::<NSNumber>()
                .unwrap()
                .doubleValue(),
            215.5
        );
        assert!(
            dict.objectForKey(ns_string!("shuffle"))
                .unwrap()
                .downcast::<NSNumber>()
                .unwrap()
                .boolValue()
        );
        assert_eq!(
            dict.objectForKey(ns_string!("repeat"))
                .unwrap()
                .downcast::<NSString>()
                .unwrap()
                .to_string(),
            "all"
        );

        let cmd_dict = NSMutableDictionary::<NSString, AnyObject>::new();
        let cmd_str = NSString::from_str("seekTo");
        let pos_num = NSNumber::numberWithDouble(88.5);
        unsafe {
            cmd_dict.insert(
                ns_string!("command"),
                &*((&*cmd_str as *const NSString).cast::<AnyObject>()),
            );
            cmd_dict.insert(
                ns_string!("position"),
                &*((&*pos_num as *const NSNumber).cast::<AnyObject>()),
            );
        }
        let untyped: &NSDictionary = unsafe { cmd_dict.cast_unchecked::<AnyObject, AnyObject>() };
        let notif = unsafe {
            NSNotification::notificationWithName_object_userInfo(
                ns_string!(DIST_NOTIF_COMMAND),
                None,
                Some(untyped),
            )
        };
        let parsed = macos::extract_command_from_notification(&notif)
            .expect("expected parsed seekTo command");
        assert_eq!(
            parsed,
            PlayerCommandPayload {
                command: "seekTo".to_string(),
                position: Some(88.5),
            }
        );

        let fallback_obj = Retained::into_super(NSString::from_str("togglePlayPause"));
        let obj_notif = unsafe {
            NSNotification::notificationWithName_object(
                ns_string!(DIST_NOTIF_COMMAND),
                Some(&fallback_obj),
            )
        };
        assert_eq!(
            macos::extract_command_from_notification(&obj_notif),
            Some(PlayerCommandPayload {
                command: "togglePlayPause".to_string(),
                position: None,
            })
        );
    }
}
