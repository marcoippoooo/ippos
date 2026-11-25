use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Mutex;
use std::sync::mpsc::{self, Sender};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const DEFAULT_DISCORD_CLIENT_ID: &str = "1312142312142312142";
const RECONNECT_COOLDOWN: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordActivityPayload {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub is_playing: bool,
    pub position_sec: f64,
    pub duration_sec: f64,
    pub artwork_url: String,
}

enum DiscordCommand {
    Init(Option<String>),
    SetActivity(DiscordActivityPayload),
    ClearActivity,
    Shutdown,
}

pub struct DiscordRpcState {
    tx: Mutex<Option<Sender<DiscordCommand>>>,
}

impl DiscordRpcState {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel::<DiscordCommand>();
        thread::Builder::new()
            .name("ippos-discord-rpc".to_string())
            .spawn(move || {
                run_worker(rx);
            })
            .ok();

        Self {
            tx: Mutex::new(Some(tx)),
        }
    }

    fn send(&self, cmd: DiscordCommand) {
        if let Ok(guard) = self.tx.lock() {
            if let Some(tx) = guard.as_ref() {
                let _ = tx.send(cmd);
            }
        }
    }

    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.tx.lock() {
            if let Some(tx) = guard.take() {
                let _ = tx.send(DiscordCommand::Shutdown);
            }
        }
    }
}

#[tauri::command]
pub fn init_discord_rpc(
    state: tauri::State<'_, DiscordRpcState>,
    client_id: Option<String>,
) -> Result<bool, String> {
    state.send(DiscordCommand::Init(client_id));
    Ok(true)
}

#[tauri::command]
pub fn set_discord_activity(
    state: tauri::State<'_, DiscordRpcState>,
    payload: DiscordActivityPayload,
) -> Result<(), String> {
    state.send(DiscordCommand::SetActivity(payload));
    Ok(())
}

#[tauri::command]
pub fn clear_discord_activity(
    state: tauri::State<'_, DiscordRpcState>,
) -> Result<(), String> {
    state.send(DiscordCommand::ClearActivity);
    Ok(())
}

fn resolve_client_id(override_id: Option<&str>) -> String {
    if let Some(id) = override_id.map(str::trim).filter(|s| !s.is_empty()) {
        return id.to_string();
    }
    if let Ok(env_id) = std::env::var("IPPOS_DISCORD_CLIENT_ID") {
        let trimmed = env_id.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    DEFAULT_DISCORD_CLIENT_ID.to_string()
}

fn sanitize_rpc_text(raw: &str, fallback: &str, max_bytes: usize) -> String {
    let trimmed = raw.trim();
    let base = if trimmed.is_empty() { fallback } else { trimmed };
    let mut out = if base.len() <= max_bytes {
        base.to_string()
    } else {
        let mut end = max_bytes;
        while end > 0 && !base.is_char_boundary(end) {
            end -= 1;
        }
        base[..end].trim_end().to_string()
    };

    while out.chars().count() < 2 {
        out.push(' ');
    }
    out
}

fn build_set_activity_payload(payload: &DiscordActivityPayload) -> Value {
    let details = sanitize_rpc_text(&payload.title, "IPPOS", 128);
    let state = sanitize_rpc_text(&payload.artist, "Artista sconosciuto", 128);
    let album_text = sanitize_rpc_text(&payload.album, "IPPOS", 128);

    let artwork = payload.artwork_url.trim();
    let large_image = if artwork.starts_with("https://") || artwork.starts_with("http://") {
        artwork.to_string()
    } else {
        "ippos_logo".to_string()
    };

    let small_text = if payload.is_playing {
        "In riproduzione"
    } else {
        "In pausa"
    };

    let mut activity = json!({
        "type": 2,
        "details": details,
        "state": state,
        "assets": {
            "large_image": large_image,
            "large_text": album_text,
            "small_text": small_text
        }
    });

    if payload.is_playing && payload.duration_sec.is_finite() && payload.duration_sec > 0.0 {
        let now_sec = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let dur_sec = payload.duration_sec.round().max(1.0) as u64;
        let pos_sec = if payload.position_sec.is_finite() && payload.position_sec > 0.0 {
            (payload.position_sec.round() as u64).min(dur_sec)
        } else {
            0
        };
        let start_ts = now_sec.saturating_sub(pos_sec);
        let end_ts = start_ts.saturating_add(dur_sec);

        if let Some(obj) = activity.as_object_mut() {
            obj.insert(
                "timestamps".to_string(),
                json!({
                    "start": start_ts,
                    "end": end_ts
                }),
            );
        }
    }

    json!({
        "cmd": "SET_ACTIVITY",
        "args": {
            "pid": std::process::id(),
            "activity": activity
        },
        "nonce": Uuid::new_v4().to_string()
    })
}

fn build_clear_activity_payload() -> Value {
    json!({
        "cmd": "SET_ACTIVITY",
        "args": {
            "pid": std::process::id()
        },
        "nonce": Uuid::new_v4().to_string()
    })
}

#[cfg(unix)]
mod ipc {
    use super::*;
    use std::io::{Read, Write};
    use std::os::unix::net::UnixStream;
    use std::path::PathBuf;

    pub struct DiscordIpcConnection {
        stream: UnixStream,
    }

    impl DiscordIpcConnection {
        pub fn connect(client_id: &str) -> Result<Self, String> {
            let stream = open_discord_socket()?;
            let _ = stream.set_read_timeout(Some(Duration::from_millis(750)));
            let _ = stream.set_write_timeout(Some(Duration::from_millis(750)));

            let mut conn = Self { stream };
            let handshake = json!({
                "v": 1,
                "client_id": client_id
            });
            conn.send_frame(0, &handshake)?;
            let _ = conn.read_frame()?;
            Ok(conn)
        }

        pub fn send_activity(&mut self, body: &Value) -> Result<(), String> {
            self.send_frame(1, body)?;
            let _ = self.read_frame();
            Ok(())
        }

        fn send_frame(&mut self, opcode: u32, payload: &Value) -> Result<(), String> {
            let json_bytes =
                serde_json::to_vec(payload).map_err(|e| format!("JSON encode error: {e}"))?;
            let len = json_bytes.len() as u32;
            let mut header = [0u8; 8];
            header[0..4].copy_from_slice(&opcode.to_le_bytes());
            header[4..8].copy_from_slice(&len.to_le_bytes());
            self.stream
                .write_all(&header)
                .map_err(|e| format!("IPC header write failed: {e}"))?;
            self.stream
                .write_all(&json_bytes)
                .map_err(|e| format!("IPC payload write failed: {e}"))?;
            Ok(())
        }

        fn read_frame(&mut self) -> Result<(u32, Value), String> {
            let mut header = [0u8; 8];
            self.stream
                .read_exact(&mut header)
                .map_err(|e| format!("IPC header read failed: {e}"))?;
            let opcode = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
            let len = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
            if len > 1024 * 1024 {
                return Err("IPC frame too large".to_string());
            }
            let mut buf = vec![0u8; len];
            self.stream
                .read_exact(&mut buf)
                .map_err(|e| format!("IPC payload read failed: {e}"))?;
            let parsed = serde_json::from_slice::<Value>(&buf)
                .map_err(|e| format!("IPC JSON decode failed: {e}"))?;
            Ok((opcode, parsed))
        }
    }

    fn candidate_dirs() -> Vec<PathBuf> {
        let mut dirs = Vec::new();
        for var in ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"] {
            if let Ok(val) = std::env::var(var) {
                let trimmed = val.trim();
                if !trimmed.is_empty() {
                    dirs.push(PathBuf::from(trimmed));
                }
            }
        }
        dirs.push(PathBuf::from("/tmp"));
        dirs
    }

    fn open_discord_socket() -> Result<UnixStream, String> {
        let suffixes = [
            "",
            "app/com.discordapp.Discord/",
            "snap.discord/",
        ];
        for dir in candidate_dirs() {
            for suffix in suffixes {
                for idx in 0..10 {
                    let path = dir.join(format!("{suffix}discord-ipc-{idx}"));
                    if let Ok(stream) = UnixStream::connect(&path) {
                        return Ok(stream);
                    }
                }
            }
        }
        Err("Discord IPC socket not found".to_string())
    }
}

#[cfg(not(unix))]
mod ipc {
    use super::*;

    pub struct DiscordIpcConnection;

    impl DiscordIpcConnection {
        pub fn connect(_client_id: &str) -> Result<Self, String> {
            Err("Discord IPC non supportato su questa piattaforma".to_string())
        }

        pub fn send_activity(&mut self, _body: &Value) -> Result<(), String> {
            Ok(())
        }
    }
}

fn run_worker(rx: mpsc::Receiver<DiscordCommand>) {
    let mut client_id = resolve_client_id(None);
    let mut conn: Option<ipc::DiscordIpcConnection> = None;
    let mut last_connect_attempt: Option<Instant> = None;

    let ensure_connected = |conn_opt: &mut Option<ipc::DiscordIpcConnection>,
                            last_attempt: &mut Option<Instant>,
                            cid: &str|
     -> bool {
        if conn_opt.is_some() {
            return true;
        }
        if let Some(prev) = last_attempt {
            if prev.elapsed() < RECONNECT_COOLDOWN {
                return false;
            }
        }
        *last_attempt = Some(Instant::now());
        match ipc::DiscordIpcConnection::connect(cid) {
            Ok(c) => {
                *conn_opt = Some(c);
                true
            }
            Err(_) => false,
        }
    };

    while let Ok(cmd) = rx.recv() {
        match cmd {
            DiscordCommand::Init(override_id) => {
                let next_id = resolve_client_id(override_id.as_deref());
                if next_id != client_id {
                    client_id = next_id;
                    conn = None;
                    last_connect_attempt = None;
                }
                let _ = ensure_connected(&mut conn, &mut last_connect_attempt, &client_id);
            }
            DiscordCommand::SetActivity(payload) => {
                if !ensure_connected(&mut conn, &mut last_connect_attempt, &client_id) {
                    continue;
                }
                let body = build_set_activity_payload(&payload);
                if let Some(active) = conn.as_mut() {
                    if active.send_activity(&body).is_err() {
                        conn = None;
                    }
                }
            }
            DiscordCommand::ClearActivity => {
                if let Some(active) = conn.as_mut() {
                    let body = build_clear_activity_payload();
                    if active.send_activity(&body).is_err() {
                        conn = None;
                    }
                }
            }
            DiscordCommand::Shutdown => {
                if let Some(active) = conn.as_mut() {
                    let body = build_clear_activity_payload();
                    let _ = active.send_activity(&body);
                }
                break;
            }
        }
    }
}
