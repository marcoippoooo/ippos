use crate::audio_proxy::validate_upstream_url;
use futures_util::TryStreamExt;
use reqwest::Client;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;
use uuid::Uuid;

const DEFAULT_USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineCacheStats {
    pub total_bytes: u64,
    pub track_count: usize,
    pub cache_dir: String,
}

pub struct OfflineCacheState {
    cache_dir: PathBuf,
    client: Client,
    active_downloads: Mutex<HashSet<String>>,
}

struct ActiveDownloadGuard {
    state: Arc<OfflineCacheState>,
    video_id: String,
}

impl Drop for ActiveDownloadGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.state.active_downloads.lock() {
            guard.remove(&self.video_id);
        }
    }
}

pub fn sanitize_video_id(video_id: &str) -> Result<String, String> {
    let trimmed = video_id.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err("Invalid videoId length".to_string());
    }
    if !trimmed
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("Invalid videoId characters".to_string());
    }
    Ok(trimmed.to_string())
}

fn resolve_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = std::env::var_os("HOME") {
            return Ok(PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("IPPOS")
                .join("cache")
                .join("audio"));
        }
    }

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    Ok(app_data.join("cache").join("audio"))
}

fn compute_stats_for_dir(dir: &Path) -> Result<OfflineCacheStats, String> {
    let mut total_bytes: u64 = 0;
    let mut track_count: usize = 0;

    if dir.exists() {
        let entries = fs::read_dir(dir)
            .map_err(|e| format!("Failed to read offline cache directory: {e}"))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if path.extension().and_then(|s| s.to_str()) != Some("m4a") {
                continue;
            }
            if let Ok(meta) = entry.metadata() {
                total_bytes = total_bytes.saturating_add(meta.len());
                track_count += 1;
            }
        }
    }

    Ok(OfflineCacheStats {
        total_bytes,
        track_count,
        cache_dir: dir.to_string_lossy().into_owned(),
    })
}

impl OfflineCacheState {
    pub fn init(app: &tauri::AppHandle) -> Result<Self, String> {
        let cache_dir = resolve_cache_dir(app)?;
        fs::create_dir_all(&cache_dir)
            .map_err(|e| format!("Failed to create offline cache directory: {e}"))?;

        let client = Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(300))
            .build()
            .map_err(|e| format!("Failed to build offline cache HTTP client: {e}"))?;

        Ok(Self {
            cache_dir,
            client,
            active_downloads: Mutex::new(HashSet::new()),
        })
    }

    pub fn cached_file_path(&self, video_id: &str) -> Option<PathBuf> {
        let safe_id = sanitize_video_id(video_id).ok()?;
        let path = self.cache_dir.join(format!("{safe_id}.m4a"));
        match fs::metadata(&path) {
            Ok(meta) if meta.is_file() && meta.len() > 0 => Some(path),
            _ => None,
        }
    }

    pub fn list_cached_ids(&self) -> Result<Vec<String>, String> {
        if !self.cache_dir.exists() {
            return Ok(Vec::new());
        }
        let entries = fs::read_dir(&self.cache_dir)
            .map_err(|e| format!("Failed to read offline cache directory: {e}"))?;
        let mut ids = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if path.extension().and_then(|s| s.to_str()) != Some("m4a") {
                continue;
            }
            if let Ok(meta) = entry.metadata() {
                if meta.len() == 0 {
                    continue;
                }
            }
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                if sanitize_video_id(stem).is_ok() {
                    ids.push(stem.to_string());
                }
            }
        }
        ids.sort();
        Ok(ids)
    }

    pub fn remove_track(&self, video_id: &str) -> Result<bool, String> {
        let safe_id = sanitize_video_id(video_id)?;
        let path = self.cache_dir.join(format!("{safe_id}.m4a"));
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|e| format!("Failed to remove cached audio file: {e}"))?;
            return Ok(true);
        }
        Ok(false)
    }

    pub fn clear_all(&self) -> Result<OfflineCacheStats, String> {
        if self.cache_dir.exists() {
            let entries = fs::read_dir(&self.cache_dir)
                .map_err(|e| format!("Failed to scan offline cache directory: {e}"))?;
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let ext = path.extension().and_then(|s| s.to_str());
                if ext == Some("m4a") || ext == Some("part") {
                    let _ = fs::remove_file(&path);
                }
            }
        }
        compute_stats_for_dir(&self.cache_dir)
    }

    pub fn stats(&self) -> Result<OfflineCacheStats, String> {
        compute_stats_for_dir(&self.cache_dir)
    }

    #[cfg(test)]
    pub fn new_for_test(cache_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&cache_dir);
        Self {
            cache_dir,
            client: Client::new(),
            active_downloads: Mutex::new(HashSet::new()),
        }
    }
}

#[tauri::command]
pub async fn download_audio_to_cache(
    state: tauri::State<'_, Arc<OfflineCacheState>>,
    video_id: String,
    url: String,
    user_agent: Option<String>,
) -> Result<u64, String> {
    let safe_id = sanitize_video_id(&video_id)?;
    let parsed_url = validate_upstream_url(&url)?;
    let cache = Arc::clone(state.inner());

    {
        let mut guard = cache
            .active_downloads
            .lock()
            .map_err(|_| "Offline cache lock poisoned".to_string())?;
        if guard.contains(&safe_id) {
            return Err("Download already in progress".to_string());
        }
        guard.insert(safe_id.clone());
    }
    let _active_guard = ActiveDownloadGuard {
        state: Arc::clone(&cache),
        video_id: safe_id.clone(),
    };

    if let Some(existing) = cache.cached_file_path(&safe_id) {
        if let Ok(meta) = fs::metadata(&existing) {
            return Ok(meta.len());
        }
    }

    fs::create_dir_all(&cache.cache_dir)
        .map_err(|e| format!("Failed to prepare offline cache directory: {e}"))?;

    let ua = user_agent
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_USER_AGENT.to_string());

    let response = cache
        .client
        .get(parsed_url.as_str())
        .header(reqwest::header::USER_AGENT, ua)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Upstream returned HTTP status {}",
            response.status().as_u16()
        ));
    }

    let part_path = cache
        .cache_dir
        .join(format!("{safe_id}.{}.part", Uuid::new_v4().simple()));
    let final_path = cache.cache_dir.join(format!("{safe_id}.m4a"));

    let mut file = fs::File::create(&part_path)
        .map_err(|e| format!("Failed to create temp audio file: {e}"))?;

    let mut byte_stream = response.bytes_stream();
    let mut written: u64 = 0;

    while let Some(chunk_res) = byte_stream.try_next().await.transpose() {
        match chunk_res {
            Ok(chunk) => {
                if let Err(err) = file.write_all(&chunk) {
                    drop(file);
                    let _ = fs::remove_file(&part_path);
                    return Err(format!("Failed to write audio chunk: {err}"));
                }
                written = written.saturating_add(chunk.len() as u64);
            }
            Err(err) => {
                drop(file);
                let _ = fs::remove_file(&part_path);
                return Err(format!("Audio stream interrupted during download: {err}"));
            }
        }
    }

    if written == 0 {
        drop(file);
        let _ = fs::remove_file(&part_path);
        return Err("Downloaded audio stream was empty".to_string());
    }

    if let Err(err) = file.flush().and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&part_path);
        return Err(format!("Failed to flush audio file to disk: {err}"));
    }
    drop(file);

    if let Err(err) = fs::rename(&part_path, &final_path) {
        let _ = fs::remove_file(&part_path);
        return Err(format!("Failed to finalize offline audio file: {err}"));
    }

    Ok(written)
}

#[tauri::command]
pub fn is_audio_cached(
    state: tauri::State<'_, Arc<OfflineCacheState>>,
    video_id: String,
) -> Result<bool, String> {
    sanitize_video_id(&video_id)?;
    Ok(state.cached_file_path(&video_id).is_some())
}

#[tauri::command]
pub fn list_cached_audio_ids(
    state: tauri::State<'_, Arc<OfflineCacheState>>,
) -> Result<Vec<String>, String> {
    state.list_cached_ids()
}

#[tauri::command]
pub fn remove_cached_audio(
    state: tauri::State<'_, Arc<OfflineCacheState>>,
    video_id: String,
) -> Result<bool, String> {
    state.remove_track(&video_id)
}

#[tauri::command]
pub fn clear_offline_audio_cache(
    state: tauri::State<'_, Arc<OfflineCacheState>>,
) -> Result<OfflineCacheStats, String> {
    state.clear_all()
}

#[tauri::command]
pub fn get_offline_cache_stats(
    state: tauri::State<'_, Arc<OfflineCacheState>>,
) -> Result<OfflineCacheStats, String> {
    state.stats()
}
