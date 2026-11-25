// Windows notifications on the page (src-tauri/src/toast_wa.rs): what Rust reports and the few pure
// rules the pill and its card follow. Only the app's name and the toast's first line travel here —
// never the text of a message.

export const NOTIF_ID = "integration_notifications";

/** What Rust emits as "notif-pill". */
export interface NotifEvent {
  app: string;
  title: string;
  whatsapp: boolean;
}

export interface NotifItem extends NotifEvent {
  at: number;
}

/** The card keeps the last few, newest first. */
export const NOTIF_KEEP = 6;

export const Notifs: { recent: NotifItem[] } = { recent: [] };

export function pushNotif(e: NotifEvent, now = Date.now()): void {
  Notifs.recent = [{ ...e, at: now }, ...Notifs.recent].slice(0, NOTIF_KEEP);
}

/** The pill's one line: "WhatsApp · Ana", or just the app when the toast had no title. */
export function notifLine(e: NotifEvent): string {
  return e.title ? `${e.app} · ${e.title}` : e.app;
}
