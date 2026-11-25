use crate::offline_cache::{sanitize_video_id, OfflineCacheState};
use bytes::Bytes;
use futures_util::TryStreamExt;
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Empty, Full, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::header::{
    ACCEPT_RANGES, ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS,
    ACCESS_CONTROL_ALLOW_ORIGIN, ACCESS_CONTROL_EXPOSE_HEADERS, CACHE_CONTROL, CONTENT_LENGTH,
    CONTENT_RANGE, CONTENT_TYPE, RANGE, USER_AGENT,
};
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use reqwest::Client;
use std::collections::{HashMap, VecDeque};
use std::convert::Infallible;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tokio::net::TcpListener;
use url::Url;
use uuid::Uuid;

const MAX_REGISTRY_ENTRIES: usize = 24;
const LOCAL_STREAM_CHUNK_BYTES: usize = 64 * 1024;
const DEFAULT_USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

type ProxyBody = BoxBody<Bytes, std::io::Error>;

#[derive(Clone)]
struct StreamEntry {
    url: Option<String>,
    video_id: Option<String>,
    user_agent: String,
    content_type: String,
}

#[derive(Default)]
struct StreamRegistry {
    entries: HashMap<String, StreamEntry>,
    order: VecDeque<String>,
}

impl StreamRegistry {
    fn insert(&mut self, stream_id: String, entry: StreamEntry) {
        if self.entries.contains_key(&stream_id) {
            self.entries.insert(stream_id, entry);
            return;
        }
        while self.order.len() >= MAX_REGISTRY_ENTRIES {
            if let Some(oldest) = self.order.pop_front() {
                self.entries.remove(&oldest);
            }
        }
        self.order.push_back(stream_id.clone());
        self.entries.insert(stream_id, entry);
    }

    fn get(&self, stream_id: &str) -> Option<StreamEntry> {
        self.entries.get(stream_id).cloned()
    }
}

#[derive(Clone)]
pub struct AudioProxyState {
    port: u16,
    token: String,
    registry: Arc<RwLock<StreamRegistry>>,
    offline_cache: Arc<OfflineCacheState>,
}

impl AudioProxyState {
    pub fn start(offline_cache: Arc<OfflineCacheState>) -> Result<Self, String> {
        let listener = tauri::async_runtime::block_on(TcpListener::bind("127.0.0.1:0"))
            .map_err(|e| format!("Failed to bind local audio proxy: {e}"))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("Failed to read local proxy address: {e}"))?
            .port();

        let token = Uuid::new_v4().simple().to_string();
        let registry = Arc::new(RwLock::new(StreamRegistry::default()));
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| format!("Failed to build reqwest client for audio proxy: {e}"))?;

        let state = Self {
            port,
            token: token.clone(),
            registry: Arc::clone(&registry),
            offline_cache: Arc::clone(&offline_cache),
        };

        tauri::async_runtime::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    continue;
                };
                let io = TokioIo::new(stream);
                let client_clone = client.clone();
                let registry_clone = Arc::clone(&registry);
                let offline_clone = Arc::clone(&offline_cache);
                let token_clone = token.clone();

                tauri::async_runtime::spawn(async move {
                    let svc = service_fn(move |req| {
                        handle_request(
                            req,
                            client_clone.clone(),
                            Arc::clone(&registry_clone),
                            Arc::clone(&offline_clone),
                            token_clone.clone(),
                        )
                    });
                    let _ = hyper::server::conn::http1::Builder::new()
                        .serve_connection(io, svc)
                        .await;
                });
            }
        });

        Ok(state)
    }

    pub fn register_url(
        &self,
        video_id: Option<String>,
        url: Option<String>,
        user_agent: Option<String>,
        content_type: Option<String>,
    ) -> Result<String, String> {
        let sanitized_video_id = match video_id.filter(|s| !s.trim().is_empty()) {
            Some(vid) => Some(sanitize_video_id(&vid)?),
            None => None,
        };

        let validated_url = match url.filter(|s| !s.trim().is_empty()) {
            Some(raw) => Some(validate_upstream_url(&raw)?.to_string()),
            None => None,
        };

        if validated_url.is_none() {
            let Some(ref vid) = sanitized_video_id else {
                return Err("Either url or cached videoId is required".to_string());
            };
            if self.offline_cache.cached_file_path(vid).is_none() {
                return Err("Cached audio file not found".to_string());
            }
        }

        let stream_id = Uuid::new_v4().simple().to_string();
        let entry = StreamEntry {
            url: validated_url,
            video_id: sanitized_video_id,
            user_agent: user_agent
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_USER_AGENT.to_string()),
            content_type: content_type
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| "audio/mp4".to_string()),
        };

        let mut guard = self
            .registry
            .write()
            .map_err(|_| "Audio proxy registry lock poisoned".to_string())?;
        guard.insert(stream_id.clone(), entry);

        Ok(format!(
            "http://127.0.0.1:{}/stream/{}?token={}",
            self.port, stream_id, self.token
        ))
    }

    #[cfg(test)]
    fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    #[cfg(test)]
    fn token(&self) -> &str {
        &self.token
    }
}

pub fn validate_upstream_url(raw: &str) -> Result<Url, String> {
    let parsed = Url::parse(raw).map_err(|e| format!("Invalid stream URL: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("Only HTTPS stream URLs are permitted".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "Stream URL is missing host".to_string())?;
    if !host.ends_with(".googlevideo.com") {
        return Err(format!("Unsupported stream host: {host}"));
    }
    Ok(parsed)
}

#[tauri::command]
pub fn register_audio_stream(
    state: tauri::State<'_, AudioProxyState>,
    video_id: Option<String>,
    url: Option<String>,
    user_agent: Option<String>,
    content_type: Option<String>,
) -> Result<String, String> {
    state.register_url(video_id, url, user_agent, content_type)
}

fn empty_body() -> ProxyBody {
    Empty::<Bytes>::new()
        .map_err(|never| match never {})
        .boxed()
}

fn text_response(status: StatusCode, msg: &'static str) -> Response<ProxyBody> {
    let mut res = Response::new(
        Full::new(Bytes::from_static(msg.as_bytes()))
            .map_err(|never| match never {})
            .boxed(),
    );
    *res.status_mut() = status;
    attach_cors_headers(res.headers_mut());
    res
}

fn attach_cors_headers(headers: &mut hyper::HeaderMap) {
    headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, "*".parse().unwrap());
    headers.insert(
        ACCESS_CONTROL_ALLOW_METHODS,
        "GET, HEAD, OPTIONS".parse().unwrap(),
    );
    headers.insert(ACCESS_CONTROL_ALLOW_HEADERS, "Range".parse().unwrap());
    headers.insert(
        ACCESS_CONTROL_EXPOSE_HEADERS,
        "Content-Length, Content-Range, Accept-Ranges".parse().unwrap(),
    );
}

fn extract_query_param(query: Option<&str>, key: &str) -> Option<String> {
    let q = query?;
    for pair in q.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == key {
                return Some(v.to_string());
            }
        }
    }
    None
}

fn parse_byte_range(range_header: Option<&str>, total_len: u64) -> Option<Result<(u64, u64), ()>> {
    let header = range_header?.trim();
    let spec = header.strip_prefix("bytes=")?;
    let first_range = spec.split(',').next()?.trim();
    let (start_str, end_str) = first_range.split_once('-')?;

    if total_len == 0 {
        return Some(Err(()));
    }

    if start_str.is_empty() {
        let suffix: u64 = end_str.trim().parse().ok()?;
        if suffix == 0 {
            return Some(Err(()));
        }
        let len = suffix.min(total_len);
        return Some(Ok((total_len - len, total_len - 1)));
    }

    let start: u64 = start_str.trim().parse().ok()?;
    if start >= total_len {
        return Some(Err(()));
    }

    let end = if end_str.trim().is_empty() {
        total_len - 1
    } else {
        let parsed_end: u64 = end_str.trim().parse().ok()?;
        if parsed_end < start {
            return Some(Err(()));
        }
        parsed_end.min(total_len - 1)
    };

    Some(Ok((start, end)))
}

async fn serve_local_file(
    method: &Method,
    path: &Path,
    content_type: &str,
    range_header: Option<&str>,
) -> Response<ProxyBody> {
    let Ok(meta) = std::fs::metadata(path) else {
        return text_response(StatusCode::NOT_FOUND, "Cached audio file not found");
    };
    let total_len = meta.len();
    if total_len == 0 {
        return text_response(StatusCode::NOT_FOUND, "Cached audio file empty");
    }

    let (status, start, end) = match parse_byte_range(range_header, total_len) {
        None => (StatusCode::OK, 0, total_len - 1),
        Some(Ok((s, e))) => (StatusCode::PARTIAL_CONTENT, s, e),
        Some(Err(())) => {
            let mut res = text_response(StatusCode::RANGE_NOT_SATISFIABLE, "Invalid range");
            if let Ok(cr) = format!("bytes */{total_len}").parse() {
                res.headers_mut().insert(CONTENT_RANGE, cr);
            }
            return res;
        }
    };

    let slice_len = end - start + 1;

    if *method == Method::HEAD {
        let mut res = Response::new(empty_body());
        *res.status_mut() = StatusCode::OK;
        let headers = res.headers_mut();
        attach_cors_headers(headers);
        headers.insert(ACCEPT_RANGES, "bytes".parse().unwrap());
        headers.insert(CACHE_CONTROL, "no-store".parse().unwrap());
        if let Ok(cl) = total_len.to_string().parse() {
            headers.insert(CONTENT_LENGTH, cl);
        }
        if let Ok(ct) = content_type.parse() {
            headers.insert(CONTENT_TYPE, ct);
        }
        return res;
    }

    let path_owned = path.to_path_buf();
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Frame<Bytes>, std::io::Error>>(4);

    tauri::async_runtime::spawn_blocking(move || {
        let mut file = match File::open(&path_owned) {
            Ok(f) => f,
            Err(err) => {
                let _ = tx.blocking_send(Err(err));
                return;
            }
        };
        if start > 0 {
            if let Err(err) = file.seek(SeekFrom::Start(start)) {
                let _ = tx.blocking_send(Err(err));
                return;
            }
        }

        let mut remaining = slice_len;
        let mut buf = vec![0u8; LOCAL_STREAM_CHUNK_BYTES];
        while remaining > 0 {
            let to_read = (remaining as usize).min(buf.len());
            match file.read(&mut buf[..to_read]) {
                Ok(0) => break,
                Ok(n) => {
                    remaining -= n as u64;
                    let frame = Frame::data(Bytes::copy_from_slice(&buf[..n]));
                    if tx.blocking_send(Ok(frame)).is_err() {
                        break;
                    }
                }
                Err(err) => {
                    let _ = tx.blocking_send(Err(err));
                    break;
                }
            }
        }
    });

    let stream = futures_util::stream::unfold(rx, |mut rx| async move {
        rx.recv().await.map(|item| (item, rx))
    });
    let body: ProxyBody = BodyExt::boxed(StreamBody::new(stream));

    let mut res = Response::new(body);
    *res.status_mut() = status;
    let headers = res.headers_mut();
    attach_cors_headers(headers);
    headers.insert(ACCEPT_RANGES, "bytes".parse().unwrap());
    headers.insert(CACHE_CONTROL, "no-store".parse().unwrap());
    if let Ok(ct) = content_type.parse() {
        headers.insert(CONTENT_TYPE, ct);
    }
    if let Ok(cl) = slice_len.to_string().parse() {
        headers.insert(CONTENT_LENGTH, cl);
    }
    if status == StatusCode::PARTIAL_CONTENT {
        if let Ok(cr) = format!("bytes {start}-{end}/{total_len}").parse() {
            headers.insert(CONTENT_RANGE, cr);
        }
    }
    res
}

async fn handle_request(
    req: Request<Incoming>,
    client: Client,
    registry: Arc<RwLock<StreamRegistry>>,
    offline_cache: Arc<OfflineCacheState>,
    expected_token: String,
) -> Result<Response<ProxyBody>, Infallible> {
    if req.method() == Method::OPTIONS {
        let mut res = Response::new(empty_body());
        *res.status_mut() = StatusCode::NO_CONTENT;
        attach_cors_headers(res.headers_mut());
        return Ok(res);
    }

    if req.method() != Method::GET && req.method() != Method::HEAD {
        return Ok(text_response(
            StatusCode::METHOD_NOT_ALLOWED,
            "Method not allowed",
        ));
    }

    let provided_token = extract_query_param(req.uri().query(), "token");
    if provided_token.as_deref() != Some(expected_token.as_str()) {
        return Ok(text_response(StatusCode::FORBIDDEN, "Invalid token"));
    }

    let Some(stream_id) = req.uri().path().strip_prefix("/stream/") else {
        return Ok(text_response(StatusCode::NOT_FOUND, "Not found"));
    };
    if stream_id.is_empty() || stream_id.contains('/') {
        return Ok(text_response(StatusCode::NOT_FOUND, "Not found"));
    }

    let entry = match registry.read() {
        Ok(guard) => guard.get(stream_id),
        Err(_) => return Ok(text_response(StatusCode::INTERNAL_SERVER_ERROR, "Lock error")),
    };
    let Some(entry) = entry else {
        return Ok(text_response(StatusCode::NOT_FOUND, "Stream not found"));
    };

    let range_header = req
        .headers()
        .get(RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    if let Some(video_id) = entry.video_id.as_deref() {
        if let Some(local_path) = offline_cache.cached_file_path(video_id) {
            return Ok(serve_local_file(
                req.method(),
                &local_path,
                &entry.content_type,
                range_header.as_deref(),
            )
            .await);
        }
    }

    let Some(upstream_url) = entry.url.as_deref() else {
        return Ok(text_response(
            StatusCode::NOT_FOUND,
            "Cached audio file missing",
        ));
    };

    if req.method() == Method::HEAD {
        return Ok(handle_head(client, upstream_url, &entry).await);
    }

    let mut upstream_req = client
        .get(upstream_url)
        .header(reqwest::header::USER_AGENT, &entry.user_agent);
    if let Some(range) = range_header {
        upstream_req = upstream_req.header(reqwest::header::RANGE, range);
    }

    let upstream = match upstream_req.send().await {
        Ok(resp) => resp,
        Err(_) => return Ok(text_response(StatusCode::BAD_GATEWAY, "Upstream unreachable")),
    };

    let status = StatusCode::from_u16(upstream.status().as_u16())
        .unwrap_or(StatusCode::BAD_GATEWAY);
    let upstream_headers = upstream.headers().clone();

    let stream = upstream
        .bytes_stream()
        .map_ok(Frame::data)
        .map_err(std::io::Error::other);
    let body: ProxyBody = BodyExt::boxed(StreamBody::new(stream));

    let mut res = Response::new(body);
    *res.status_mut() = status;

    let headers = res.headers_mut();
    attach_cors_headers(headers);
    headers.insert(ACCEPT_RANGES, "bytes".parse().unwrap());
    headers.insert(CACHE_CONTROL, "no-store".parse().unwrap());

    if let Some(ct) = upstream_headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
    {
        headers.insert(CONTENT_TYPE, ct);
    } else if let Ok(ct) = entry.content_type.parse() {
        headers.insert(CONTENT_TYPE, ct);
    }

    if let Some(cl) = upstream_headers
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
    {
        headers.insert(CONTENT_LENGTH, cl);
    }

    if let Some(cr) = upstream_headers
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
    {
        headers.insert(CONTENT_RANGE, cr);
    }

    let _ = USER_AGENT;
    Ok(res)
}

async fn handle_head(
    client: Client,
    upstream_url: &str,
    entry: &StreamEntry,
) -> Response<ProxyBody> {
    if let Ok(resp) = client
        .head(upstream_url)
        .header(reqwest::header::USER_AGENT, &entry.user_agent)
        .send()
        .await
    {
        if resp.status().is_success() {
            let mut res = Response::new(empty_body());
            *res.status_mut() =
                StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);
            let headers = res.headers_mut();
            attach_cors_headers(headers);
            headers.insert(ACCEPT_RANGES, "bytes".parse().unwrap());
            headers.insert(CACHE_CONTROL, "no-store".parse().unwrap());
            if let Some(cl) = resp
                .headers()
                .get(reqwest::header::CONTENT_LENGTH)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse().ok())
            {
                headers.insert(CONTENT_LENGTH, cl);
            }
            if let Some(ct) = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse().ok())
            {
                headers.insert(CONTENT_TYPE, ct);
            } else if let Ok(ct) = entry.content_type.parse() {
                headers.insert(CONTENT_TYPE, ct);
            }
            return res;
        }
    }

    // Fallback se il server googlevideo rifiuta HEAD (es. client ANDROID_VR/IOS):
    // effettua GET Range: bytes=0-0 per ricavare la Content-Length totale.
    let Ok(probe) = client
        .get(upstream_url)
        .header(reqwest::header::USER_AGENT, &entry.user_agent)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .send()
        .await
    else {
        return text_response(StatusCode::BAD_GATEWAY, "Upstream probe failed");
    };

    if !probe.status().is_success() && probe.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return text_response(StatusCode::BAD_GATEWAY, "Upstream rejected HEAD probe");
    }

    let mut res = Response::new(empty_body());
    *res.status_mut() = StatusCode::OK;
    let headers = res.headers_mut();
    attach_cors_headers(headers);
    headers.insert(ACCEPT_RANGES, "bytes".parse().unwrap());
    headers.insert(CACHE_CONTROL, "no-store".parse().unwrap());

    if let Some(total) = probe
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|cr| cr.rsplit('/').next())
        .and_then(|total| total.parse::<u64>().ok())
    {
        if let Ok(cl) = total.to_string().parse() {
            headers.insert(CONTENT_LENGTH, cl);
        }
    }

    if let Some(ct) = probe
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
    {
        headers.insert(CONTENT_TYPE, ct);
    } else if let Ok(ct) = entry.content_type.parse() {
        headers.insert(CONTENT_TYPE, ct);
    }

    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_only_https_googlevideo_hosts() {
        assert!(validate_upstream_url(
            "https://rr5---sn-u1hpa5-53.googlevideo.com/videoplayback?itag=140"
        )
        .is_ok());
        assert!(validate_upstream_url(
            "http://rr5---sn-u1hpa5-53.googlevideo.com/videoplayback"
        )
        .is_err());
        assert!(validate_upstream_url("https://example.com/audio.mp4").is_err());
    }

    #[test]
    fn enforces_auth_token_and_stream_lookup() {
        let temp_dir = std::env::temp_dir().join(format!("ippos_proxy_test_{}", Uuid::new_v4().simple()));
        let offline_cache = Arc::new(OfflineCacheState::new_for_test(temp_dir));
        let proxy = AudioProxyState::start(offline_cache).expect("proxy should bind");
        let base = proxy.base_url();
        let token = proxy.token().to_string();

        tauri::async_runtime::block_on(async move {
            let client = Client::new();

            let missing_token = client
                .get(format!("{base}/stream/nonexistent"))
                .send()
                .await
                .expect("request succeeds");
            assert_eq!(missing_token.status(), reqwest::StatusCode::FORBIDDEN);

            let valid_token_missing_stream = client
                .get(format!("{base}/stream/nonexistent?token={token}"))
                .send()
                .await
                .expect("request succeeds");
            assert_eq!(
                valid_token_missing_stream.status(),
                reqwest::StatusCode::NOT_FOUND
            );
        });
    }
}
