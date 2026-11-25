//! "Media": whatever is playing on this computer that is NOT Spotify (Arthur, 24/11/2026).
//!
//! A YouTube tab, a video player, any app that shows up in the Windows media overlay (the one the
//! media keys open). Spotify has its own pill and card, so its session is skipped here: with
//! Spotify playing there is only the Spotify Mochi. Only what the overlay already shows is read —
//! title, artist, cover, position — and nothing is sent anywhere. Reading runs only while the
//! "Media" pill is on in Settings. Windows only.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};

use serde::Serialize;

pub const PILL_ID: &str = "integration_media";

static ACTIVE: AtomicBool = AtomicBool::new(false);

/// What the page gets as "media-state".
#[derive(Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    /// A session other than Spotify's is there and has a title.
    pub present: bool,
    /// The app's name as a person says it ("Chrome", "VLC").
    pub app: String,
    pub title: String,
    pub artist: String,
    pub playing: bool,
    /// Seconds into the track when `at_ms` was true; the page runs it on while playing.
    pub position: f64,
    pub duration: f64,
    pub at_ms: f64,
    /// The cover as a data URL; sent once per track (None when the page already has it).
    pub art: Option<String>,
    pub art_key: String,
    /// The app's own volume in the Windows mixer, 0…100; -1 while it has no sound session.
    pub volume: i32,
}

static STATE: LazyLock<Mutex<MediaState>> = LazyLock::new(|| Mutex::new(MediaState::default()));

pub fn sync(active_integrations: &[String]) {
    ACTIVE.store(active_integrations.iter().any(|x| x == PILL_ID), Ordering::Relaxed);
}

/// The last state, for a page that starts after the first event.
#[tauri::command]
pub fn media_state() -> MediaState {
    STATE.lock().unwrap().clone()
}

/// The card's buttons: "playpause", "next", "prev", "seek" (value = seconds) and "volume" (0…100,
/// the playing app's own volume in the Windows mixer, like the Spotify card's).
#[tauri::command]
pub fn media_control(action: String, value: Option<f64>) -> bool {
    #[cfg(windows)]
    {
        win::control(&action, value)
    }
    #[cfg(not(windows))]
    {
        let _ = (action, value);
        false
    }
}

#[cfg(windows)]
pub fn start(app: &tauri::AppHandle, active_integrations: &[String]) {
    sync(active_integrations);
    let app = app.clone();
    let _ = std::thread::Builder::new().name("coucou-media".into()).spawn(move || win::run(app));
}

#[cfg(not(windows))]
pub fn start(_app: &tauri::AppHandle, active_integrations: &[String]) {
    sync(active_integrations);
}

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// "chrome.exe" → "Chrome", a Store id → its last piece.
fn friendly(id: &str) -> String {
    let lower = id.to_lowercase();
    for (key, name) in [
        ("chrome", "Chrome"),
        ("msedge", "Edge"),
        ("firefox", "Firefox"),
        ("brave", "Brave"),
        ("opera", "Opera"),
        ("vlc", "VLC"),
        ("zunevideo", "Movies & TV"),
        ("zunemusic", "Media Player"),
        ("mediaplayer", "Media Player"),
        ("netflix", "Netflix"),
        ("discord", "Discord"),
    ] {
        if lower.contains(key) {
            return name.to_string();
        }
    }
    let last = id.rsplit(['\\', '!', '/']).next().unwrap_or(id);
    last.trim_end_matches(".exe").trim_end_matches(".EXE").to_string()
}

#[cfg(windows)]
mod win {
    use std::time::Duration;

    use tauri::{AppHandle, Emitter};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionMediaProperties as MediaProperties,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::DataReader;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume,
        MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::core::Interface;

    use super::{friendly, now_ms, MediaState, ACTIVE, STATE};
    use std::sync::atomic::Ordering;

    const EVENT: &str = "media-state";
    const ART_LIMIT: u64 = 3 * 1024 * 1024;

    fn com() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
    }

    /// The session to show: any that is not Spotify's, a playing one first.
    fn pick(manager: &Manager) -> Option<Session> {
        let sessions = manager.GetSessions().ok()?;
        let mut best: Option<(u8, Session)> = None;
        for i in 0..sessions.Size().ok()? {
            let Ok(s) = sessions.GetAt(i) else { continue };
            let id = s.SourceAppUserModelId().map(|x| x.to_string_lossy()).unwrap_or_default();
            if crate::spotify::is_spotify_app(&id) {
                continue;
            }
            let playing = s
                .GetPlaybackInfo()
                .and_then(|p| p.PlaybackStatus())
                .is_ok_and(|st| st == Status::Playing);
            let rank = if playing { 2 } else { 1 };
            if best.as_ref().map_or(true, |(r, _)| rank > *r) {
                best = Some((rank, s));
            }
        }
        best.map(|(_, s)| s)
    }

    // ── Volume: the playing app in the Windows mixer (as spotify.rs does for Spotify) ──

    /// "C:\…\chrome.exe" → "chrome".
    fn exe_stem(pid: u32) -> Option<String> {
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let named = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len);
            let _ = CloseHandle(process);
            named.ok()?;
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            let name = path.rsplit(['\\', '/']).next()?.to_lowercase();
            Some(name.trim_end_matches(".exe").to_string())
        }
    }

    /// Whether a mixer session's program is the media session's app. The overlay names the app by
    /// its AppUserModelId ("Chrome", "chrome.exe", "Microsoft.ZuneVideo_…!App"); the mixer by the
    /// program file. They match on the program's name, or on the same friendly name.
    pub(super) fn same_app(aumid: &str, stem: &str) -> bool {
        if stem.len() < 3 {
            return false;
        }
        let id = aumid.to_lowercase();
        id.contains(stem) || super::friendly(&id).eq_ignore_ascii_case(&super::friendly(stem))
    }

    /// The app's sound sessions on the default output.
    fn app_audio(aumid: &str) -> Vec<ISimpleAudioVolume> {
        let mut out = Vec::new();
        if aumid.is_empty() {
            return out;
        }
        unsafe {
            let Ok(devices) = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) else {
                return out;
            };
            let Ok(device) = devices.GetDefaultAudioEndpoint(eRender, eMultimedia) else { return out };
            let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else { return out };
            let Ok(sessions) = manager.GetSessionEnumerator() else { return out };
            for i in 0..sessions.GetCount().unwrap_or(0) {
                let Ok(control) = sessions.GetSession(i) else { continue };
                let Ok(control) = control.cast::<IAudioSessionControl2>() else { continue };
                let pid = control.GetProcessId().unwrap_or(0);
                if pid == 0 {
                    continue;
                }
                let Some(stem) = exe_stem(pid) else { continue };
                if same_app(aumid, &stem) {
                    if let Ok(volume) = control.cast::<ISimpleAudioVolume>() {
                        out.push(volume);
                    }
                }
            }
        }
        out
    }

    fn app_volume(aumid: &str) -> i32 {
        let Some(first) = app_audio(aumid).into_iter().next() else { return -1 };
        let level = unsafe { first.GetMasterVolume().unwrap_or(-1.0) };
        if level < 0.0 {
            -1
        } else {
            (level * 100.0).round().clamp(0.0, 100.0) as i32
        }
    }

    fn set_app_volume(aumid: &str, percent: f64) -> bool {
        let level = (percent / 100.0).clamp(0.0, 1.0) as f32;
        let mut done = false;
        for v in app_audio(aumid) {
            done |= unsafe { v.SetMasterVolume(level, std::ptr::null()).is_ok() };
        }
        done
    }

    fn thumbnail(props: &MediaProperties) -> Option<Vec<u8>> {
        let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.get().ok()?;
        let size = stream.Size().ok()?;
        if size == 0 || size > ART_LIMIT {
            return None;
        }
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        let loaded = reader.LoadAsync(size as u32).ok()?.get().ok()?;
        let mut bytes = vec![0u8; loaded as usize];
        reader.ReadBytes(&mut bytes).ok()?;
        Some(bytes)
    }

    /// The session as it is now, without the cover.
    fn read(session: &Session) -> Option<(MediaState, MediaProperties)> {
        let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
        let title = props.Title().ok()?.to_string_lossy();
        if title.trim().is_empty() {
            return None;
        }
        let artist = props.Artist().map(|a| a.to_string_lossy()).unwrap_or_default();
        let timeline = session.GetTimelineProperties().ok()?;
        let start = timeline.StartTime().ok()?.Duration;
        let duration = crate::spotify::ticks_to_secs(timeline.EndTime().ok()?.Duration - start);
        let position = crate::spotify::ticks_to_secs(timeline.Position().ok()?.Duration - start);
        let playing = session
            .GetPlaybackInfo()
            .and_then(|p| p.PlaybackStatus())
            .is_ok_and(|st| st == Status::Playing);
        let aumid = session.SourceAppUserModelId().map(|x| x.to_string_lossy()).unwrap_or_default();
        let app = friendly(&aumid);
        Some((
            MediaState {
                present: true,
                app,
                volume: app_volume(&aumid),
                art_key: format!("{title}\u{1f}{artist}"),
                title: title.trim().chars().take(200).collect(),
                artist: artist.trim().chars().take(200).collect(),
                playing,
                position,
                duration,
                at_ms: now_ms(),
                art: None,
            },
            props,
        ))
    }

    pub fn run(app: AppHandle) {
        com();
        let mut manager: Option<Manager> = None;
        let mut last = MediaState::default();
        let mut art: Option<String> = None;
        let mut art_key = String::new();
        let mut art_tries = 0u32;
        loop {
            std::thread::sleep(Duration::from_millis(1000));
            if !ACTIVE.load(Ordering::Relaxed) {
                if last.present {
                    last = MediaState::default();
                    *STATE.lock().unwrap() = last.clone();
                    let _ = app.emit_to(crate::island::WINDOW_LABEL, EVENT, last.clone());
                }
                art = None;
                art_key.clear();
                std::thread::sleep(Duration::from_millis(1000));
                continue;
            }
            if manager.is_none() {
                manager = Manager::RequestAsync().ok().and_then(|op| op.get().ok());
            }
            let Some(m) = &manager else { continue };
            let read_now = pick(m).and_then(|s| read(&s));
            let mut next = MediaState::default();
            let mut art_changed = false;
            if let Some((state, props)) = read_now {
                next = state;
                if next.art_key != art_key {
                    art_key = next.art_key.clone();
                    art = None;
                    art_tries = 0;
                    art_changed = true; // the old cover goes away at once
                }
                // A cover sometimes arrives a moment after the title: try again for a few seconds.
                if art.is_none() && art_tries < 8 {
                    art_tries += 1;
                    if let Some(data) = thumbnail(&props).as_deref().and_then(crate::spotify::data_url) {
                        art = Some(data);
                        art_changed = true;
                    }
                }
                next.art = art.clone();
            } else {
                art = None;
                art_key.clear();
            }

            let predicted = if last.playing { last.position + (next.at_ms - last.at_ms) / 1000.0 } else { last.position };
            let moved = (next.position - predicted).abs() > 1.5;
            let changed = next.present != last.present
                || next.title != last.title
                || next.artist != last.artist
                || next.app != last.app
                || next.playing != last.playing
                || next.volume != last.volume
                || (next.duration - last.duration).abs() > 0.5
                || art_changed
                || (next.present && moved);
            if !changed {
                continue;
            }
            *STATE.lock().unwrap() = next.clone();
            // The cover travels once per track: the page keeps it while the key is the same.
            let mut event = next.clone();
            if !art_changed {
                event.art = None;
            }
            let _ = app.emit_to(crate::island::WINDOW_LABEL, EVENT, event);
            last = next;
        }
    }

    pub fn control(action: &str, value: Option<f64>) -> bool {
        com();
        let Ok(manager) = Manager::RequestAsync().and_then(|op| op.get()) else { return false };
        let Some(session) = pick(&manager) else { return false };
        if action == "volume" {
            let Some(v) = value else { return false };
            let aumid = session.SourceAppUserModelId().map(|x| x.to_string_lossy()).unwrap_or_default();
            let done = set_app_volume(&aumid, v);
            if done {
                STATE.lock().unwrap().volume = v.round().clamp(0.0, 100.0) as i32;
            }
            return done;
        }
        let result = match action {
            "playpause" => session.TryTogglePlayPauseAsync(),
            "next" => session.TrySkipNextAsync(),
            "prev" => session.TrySkipPreviousAsync(),
            "seek" => {
                let Some(secs) = value else { return false };
                let start = session.GetTimelineProperties().and_then(|t| t.StartTime()).map(|d| d.Duration).unwrap_or(0);
                session.TryChangePlaybackPositionAsync(start + (secs.max(0.0) * 10_000_000.0) as i64)
            }
            _ => return false,
        };
        result.and_then(|op| op.get()).unwrap_or(false)
    }
}
