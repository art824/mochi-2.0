//! Windows notifications in the island (Arthur, 23/11/2026).
//!
//! The "new way" next to the old WhatsApp gateway: no login, no unofficial
//! client, no way to send. Coucou only reads what the Windows notification
//! center already shows (the UserNotificationListener the system offers) and
//! lights the "Notifications" pill (or, for what Phone Link relays from the
//! phone, the "Phone" pill). Since 25/11 the island shows the toast in full —
//! what Windows already shows on screen — so its text goes to the island; it is
//! never logged, kept on disk or sent anywhere else.
//!
//! Two scopes, picked in Settings → Windows notifications:
//!  - WhatsApp only (default): toasts from WhatsApp, in the desktop app or in
//!    a browser naming web.whatsapp.com;
//!  - every app.
//! Reading runs only while the "Notifications" pill is on in Settings.
//!
//! How a WhatsApp toast looks in Chrome is not verified yet, so the WhatsApp
//! match is a guess and the log says what was seen — app names and
//! site-looking lines only, never a message.

use std::sync::atomic::{AtomicBool, Ordering};

pub const PILL_ID: &str = "integration_notifications";
/// The phone's notifications, relayed by Phone Link ("Celular Vinculado"): their own pill and Mochi
/// (Arthur, 25/11/2026: "one has to be the PC's notifications and another the phone's").
pub const PHONE_PILL_ID: &str = "integration_phone";
pub const EVENT: &str = "notif-pill";

/// Since 25/11 the island shows a notification in full — it is what Windows already shows on
/// screen — so the text travels to the island. It is still never logged nor kept on disk.
const BODY_LIMIT: usize = 600;

/// The PC's notifications pill is on.
static ACTIVE: AtomicBool = AtomicBool::new(false);
/// The phone's notifications pill is on.
static ACTIVE_PHONE: AtomicBool = AtomicBool::new(false);
/// True: every app. False: WhatsApp only. Every app until the user picks otherwise.
static ALL: AtomicBool = AtomicBool::new(true);

fn scope_file() -> Option<std::path::PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    Some(std::path::PathBuf::from(base).join("Coucou").join("toast-scope.txt"))
}

fn load_scope() {
    let all = scope_file()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.trim() == "all")
        // No file yet: every app (Arthur, 24/11/2026). "Only WhatsApp" is one click away.
        .unwrap_or(true);
    ALL.store(all, Ordering::Relaxed);
}

pub fn sync(active_integrations: &[String]) {
    ACTIVE.store(active_integrations.iter().any(|x| x == PILL_ID), Ordering::Relaxed);
    ACTIVE_PHONE.store(active_integrations.iter().any(|x| x == PHONE_PILL_ID), Ordering::Relaxed);
}

/// A toast relayed from the phone by Phone Link: its app id is Phone Link's.
fn is_phone(aumid: &str) -> bool {
    aumid.to_lowercase().starts_with("microsoft.yourphone")
}

/// The phone app behind a Phone Link toast: "…!YourPhoneNotifications_com.whatsapp" → "WhatsApp".
fn phone_app(aumid: &str, fallback: &str) -> String {
    let tail = aumid.rsplit('!').next().unwrap_or("");
    let lower = tail.to_lowercase();
    if lower.starts_with("yourphonemessages") {
        return "Messages".into();
    }
    if lower.starts_with("yourphonecalling") {
        return "Calls".into();
    }
    let Some(package) = tail.strip_prefix("YourPhoneNotifications_") else { return fallback.to_string() };
    for (key, name) in [
        ("whatsapp", "WhatsApp"),
        ("instagram", "Instagram"),
        ("telegram", "Telegram"),
        ("gm", "Gmail"),
        ("discord", "Discord"),
        ("facebook.orca", "Messenger"),
        ("facebook", "Facebook"),
        ("twitter", "X"),
        ("spotify", "Spotify"),
    ] {
        if package.to_lowercase().ends_with(&format!(".{key}")) || package.to_lowercase().contains(&format!(".{key}.")) {
            return name.into();
        }
    }
    // "com.example.app" → "App"
    let last = package.rsplit('.').next().unwrap_or(package);
    let mut c = last.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => fallback.to_string(),
    }
}

/// Settings → Windows notifications: true when every app is shown.
#[tauri::command]
pub fn toast_scope_get() -> bool {
    ALL.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn toast_scope_set(all: bool) {
    ALL.store(all, Ordering::Relaxed);
    if let Some(p) = scope_file() {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(p, if all { "all" } else { "whatsapp" });
    }
}

#[cfg(windows)]
mod win {
    use std::collections::HashSet;
    use std::sync::atomic::Ordering;
    use std::time::Duration;

    use tauri::{AppHandle, Emitter};
    use windows::UI::Notifications::Management::{UserNotificationListener, UserNotificationListenerAccessStatus};
    use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds, UserNotification};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    use super::{is_phone, load_scope, phone_app, sync, ACTIVE, ACTIVE_PHONE, ALL, BODY_LIMIT, EVENT};

    /// One second: a browser may take its toast back from the center a few seconds after showing it.
    const POLL: Duration = Duration::from_secs(1);

    pub fn start(app: &AppHandle, active_integrations: &[String]) {
        sync(active_integrations);
        load_scope();
        let app = app.clone();
        let _ = std::thread::Builder::new().name("toast-notifications".into()).spawn(move || run(app));
    }

    /// The app that raised the toast and its lines of text. Never gives up on a toast: a name that
    /// can't be read falls back to the app's id, a binding that can't be read to "no lines" — it used
    /// to drop such toasts without a trace, which is how a browser's toast could go unseen (24/11).
    fn read(n: &UserNotification) -> (String, String, Vec<String>) {
        let info = n.AppInfo().ok();
        let aumid = info.as_ref().and_then(|i| i.AppUserModelId().ok()).map(|s| s.to_string()).unwrap_or_default();
        let app = info
            .as_ref()
            .and_then(|i| i.DisplayInfo().ok())
            .and_then(|d| d.DisplayName().ok())
            .map(|s| s.to_string())
            .filter(|s| !s.trim().is_empty())
            .or_else(|| info.as_ref().and_then(|i| i.AppUserModelId().ok()).map(|s| s.to_string()))
            .unwrap_or_else(|| "unknown app".to_string());
        let mut lines: Vec<String> = Vec::new();
        fn add(lines: &mut Vec<String>, s: String) {
            if !s.trim().is_empty() && !lines.contains(&s) {
                lines.push(s);
            }
        }
        if let Ok(visual) = n.Notification().and_then(|x| x.Visual()) {
            // Every binding, not only the generic one: a toast in another template still has its text.
            if let Ok(bindings) = visual.Bindings() {
                for b in bindings {
                    if let Ok(texts) = b.GetTextElements() {
                        for t in texts {
                            if let Ok(s) = t.Text() {
                                add(&mut lines, s.to_string());
                            }
                        }
                    }
                }
            }
            if lines.is_empty() {
                if let Some(b) = KnownNotificationBindings::ToastGeneric().ok().and_then(|k| visual.GetBinding(&k).ok()) {
                    if let Ok(texts) = b.GetTextElements() {
                        for t in texts {
                            if let Ok(s) = t.Text() {
                                add(&mut lines, s.to_string());
                            }
                        }
                    }
                }
            }
        }
        (app, aumid, lines)
    }

    /// Looks like a site name ("web.whatsapp.com"): no spaces, a dot in it.
    fn looks_like_site(s: &str) -> bool {
        !s.is_empty() && s.len() < 60 && !s.contains(' ') && s.contains('.')
    }

    /// Is this toast from WhatsApp? Its own app, the Phone Link relay, or a browser that names the
    /// site or the app anywhere in its lines ("web.whatsapp.com", "WhatsApp").
    fn is_whatsapp(app: &str, lines: &[String]) -> bool {
        app.to_lowercase().contains("whatsapp")
            || lines.iter().any(|l| l.to_lowercase().contains("whatsapp"))
    }

    fn run(app: AppHandle) {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let mut seen: HashSet<u32> = HashSet::new();
        let mut primed = false;
        let mut asked = false;
        let mut logged: HashSet<String> = HashSet::new();
        loop {
            std::thread::sleep(POLL);
            let (pc_on, phone_on) = (ACTIVE.load(Ordering::Relaxed), ACTIVE_PHONE.load(Ordering::Relaxed));
            if !pc_on && !phone_on {
                // Off: forget everything, so turning it on again starts fresh.
                primed = false;
                seen.clear();
                continue;
            }
            let Ok(listener) = UserNotificationListener::Current() else { continue };
            let status = listener.GetAccessStatus().unwrap_or(UserNotificationListenerAccessStatus::Unspecified);
            if status != UserNotificationListenerAccessStatus::Allowed {
                if !asked {
                    asked = true;
                    let got = listener.RequestAccessAsync().and_then(|op| op.get());
                    crate::log::line(format!("windows notifications: access to notifications -> {got:?}"));
                }
                continue;
            }
            let Ok(list) = listener.GetNotificationsAsync(NotificationKinds::Toast).and_then(|op| op.get()) else {
                continue;
            };
            let mut current: HashSet<u32> = HashSet::new();
            for n in list {
                let Ok(id) = n.Id() else { continue };
                current.insert(id);
                if !seen.insert(id) {
                    continue;
                }
                let (name, aumid, lines) = read(&n);
                let phone = is_phone(&aumid);
                let name = if phone { phone_app(&aumid, &name) } else { name };
                // What was seen, never a message: the app, how many lines, whether it reads as
                // WhatsApp, and a line that is a site.
                crate::log::line(format!(
                    "windows notifications: toast {id} from \"{name}\"{}: {} lines, whatsapp={}{}",
                    if phone { " (phone)" } else { "" },
                    lines.len(),
                    is_whatsapp(&name, &lines),
                    if primed { "" } else { " (already there)" },
                ));
                if logged.insert(name.clone()) {
                    crate::log::line(format!("windows notifications: saw a toast from app \"{name}\" ({} lines)", lines.len()));
                }
                for l in lines.iter().filter(|l| looks_like_site(l)) {
                    if logged.insert(format!("site:{l}")) {
                        crate::log::line(format!("windows notifications: a toast names the site \"{l}\""));
                    }
                }
                // The first pass only learns what was already there.
                if !primed {
                    continue;
                }
                // Each kind goes to its own pill, and only while that pill is on.
                if (phone && !phone_on) || (!phone && !pc_on) {
                    continue;
                }
                let whatsapp = is_whatsapp(&name, &lines);
                if !whatsapp && !ALL.load(Ordering::Relaxed) {
                    continue;
                }
                // Coucou's own toasts (if any) never come back as news.
                if name.to_lowercase().contains("coucou") {
                    continue;
                }
                // The first line is the title (for a message, who sent it); the rest is the text,
                // shown in full in the island (never logged). A line that only names the app goes.
                let mut parts = lines
                    .iter()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty() && !(whatsapp && s.eq_ignore_ascii_case("whatsapp")));
                let title: String = parts.next().map(|s| s.chars().take(80).collect()).unwrap_or_default();
                let body: String = parts.collect::<Vec<_>>().join("\n").chars().take(BODY_LIMIT).collect();
                let shown_app = if whatsapp { "WhatsApp".to_string() } else { name.chars().take(40).collect() };
                crate::log::line(format!(
                    "windows notifications: a toast from \"{shown_app}\"{} came in",
                    if phone { " (phone)" } else { "" }
                ));
                let _ = app.emit_to(
                    crate::island::WINDOW_LABEL,
                    EVENT,
                    serde_json::json!({ "app": shown_app, "title": title, "body": body, "whatsapp": whatsapp, "phone": phone }),
                );
            }
            // Toasts that left the center are forgotten, so the set stays small.
            seen.retain(|id| current.contains(id));
            primed = true;
        }
    }
}

#[cfg(windows)]
pub use win::start;

#[cfg(not(windows))]
pub fn start(_app: &tauri::AppHandle, _active_integrations: &[String]) {}
