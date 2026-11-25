// Windows notifications → the page (src-tauri/src/toast_wa.rs). Same reaction as a WhatsApp message:
// the pill lights with the app and the first line, Mochi smiles and "pop" plays — once for a burst —
// and the pill goes back to idle a minute later. Notices go through island.reveal(), so the subtle
// mode and the pin treat them like any other news.

import { onEvent } from "../core/bridge";
import { NOTIF_ID, notifLine, pushNotif, type NotifEvent } from "../core/notifications";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import type { WhatsAppHost } from "./whatsapp";

const ANNOUNCE_GAP_MS = 4_000;
const RESET_AFTER_MS = 60_000;

let lastAnnounce = -Infinity;
let resetTimer: number | null = null;

export function registerNotificationHandlers(island: WhatsAppHost) {
  void onEvent<NotifEvent>("notif-pill", (e) => handleNotif(island, e));
}

export function handleNotif(island: WhatsAppHost, e: NotifEvent, now = performance.now()) {
  const t = State.tasks.find((x) => x.id === NOTIF_ID);
  if (!t || State.paused) return;
  pushNotif(e);
  t.state = "finished";
  t.steps = [notifLine(e)];
  t.stepIndex = 0;
  if (State.focusId !== NOTIF_ID) t.pillBadge = "finished";
  if (now - lastAnnounce > ANNOUNCE_GAP_MS) {
    lastAnnounce = now;
    island.emote("happy");
    Sound.play("pop");
  }
  island.reveal();
  if (resetTimer != null) window.clearTimeout(resetTimer);
  resetTimer = window.setTimeout(() => {
    resetTimer = null;
    const x = State.tasks.find((y) => y.id === NOTIF_ID);
    if (!x || x.state !== "finished") return;
    x.state = "idle";
    x.steps = [];
    x.stepIndex = 0;
    if (x.pillBadge === "finished") x.pillBadge = null;
    State.notify();
  }, RESET_AFTER_MS);
  State.notify();
}
