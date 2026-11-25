// Windows notifications on the page (src-tauri/src/toast_wa.rs): what Rust reports and the few pure
// rules the pills and their cards follow. Two pills read the same notification center: the PC's own
// notifications, and the phone's relayed by Phone Link. Since 25/11 a notification is shown in full
// (title and text, as Windows shows it); it only lives in memory here, never on disk.

export const NOTIF_ID = "integration_notifications";
export const PHONE_ID = "integration_phone";

/** What Rust emits as "notif-pill". */
export interface NotifEvent {
  app: string;
  /** The first line: for a message, who sent it. */
  title: string;
  /** The rest of the text. */
  body?: string;
  whatsapp: boolean;
  /** Relayed from the phone by Phone Link. */
  phone?: boolean;
}

export interface NotifItem extends NotifEvent {
  at: number;
}

/** Each card keeps the last few, newest first. */
export const NOTIF_KEEP = 6;

/** Per pill: the recent notifications, and which one the card shows big (null: the newest). */
export const Notifs: {
  byPill: Record<string, NotifItem[]>;
  shown: Record<string, number | null>;
} = { byPill: {}, shown: {} };

/** The pill a notification belongs to. */
export function notifPill(e: NotifEvent): string {
  return e.phone ? PHONE_ID : NOTIF_ID;
}

export function recentNotifs(pill: string): NotifItem[] {
  return Notifs.byPill[pill] ?? [];
}

export function pushNotif(e: NotifEvent, now = Date.now()): void {
  const pill = notifPill(e);
  Notifs.byPill[pill] = [{ ...e, at: now }, ...recentNotifs(pill)].slice(0, NOTIF_KEEP);
  // A new one always comes up big.
  Notifs.shown[pill] = null;
}

/** The pill's one line: "WhatsApp · Ana", or just the app when the toast had no title. */
export function notifLine(e: NotifEvent): string {
  return e.title ? `${e.app} · ${e.title}` : e.app;
}
