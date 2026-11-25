// Windows notifications → the page (src-tauri/src/toast_wa.rs). Two pills: the PC's notifications and
// the phone's (Phone Link). A notification opens the island expanded on its pill and shows big
// (Arthur, 25/11/2026: "the Mochi pops up expanded and the notification shows big"); Mochi smiles and
// "pop" plays — once for a burst — and the pill goes back to idle a minute later.

import { onEvent } from "../core/bridge";
import type { BotEmoteName } from "../core/layout";
import { notifLine, notifPill, pushNotif, type NotifEvent } from "../core/notifications";
import { Sound } from "../core/sound";
import { State } from "../core/state";

const ANNOUNCE_GAP_MS = 4_000;
const RESET_AFTER_MS = 60_000;

export interface NotifHost {
  reveal(): void;
  /** Opens the island expanded on that pill. */
  showPill(id: string): void;
  emote(name: BotEmoteName): void;
}

let lastAnnounce = -Infinity;
const resetTimers: Record<string, number> = {};

export function registerNotificationHandlers(island: NotifHost) {
  void onEvent<NotifEvent>("notif-pill", (e) => handleNotif(island, e));
}

export function handleNotif(island: NotifHost, e: NotifEvent, now = performance.now()) {
  const pill = notifPill(e);
  const t = State.tasks.find((x) => x.id === pill);
  if (!t || State.paused) return;
  pushNotif(e);
  t.state = "finished";
  t.steps = [notifLine(e)];
  t.stepIndex = 0;
  if (now - lastAnnounce > ANNOUNCE_GAP_MS) {
    lastAnnounce = now;
    island.emote("happy");
    Sound.play("pop");
  }
  island.showPill(pill);
  if (State.focusId !== pill) t.pillBadge = "finished";
  if (resetTimers[pill] != null) window.clearTimeout(resetTimers[pill]);
  resetTimers[pill] = window.setTimeout(() => {
    delete resetTimers[pill];
    const x = State.tasks.find((y) => y.id === pill);
    if (!x || x.state !== "finished") return;
    x.state = "idle";
    x.steps = [];
    x.stepIndex = 0;
    if (x.pillBadge === "finished") x.pillBadge = null;
    State.notify();
  }, RESET_AFTER_MS);
  State.notify();
}
