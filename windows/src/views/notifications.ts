// The notification cards: "Notifications" (the PC's) and "Phone" (the phone's, through Phone Link).
// The newest notification is shown BIG — app, who, the whole text — taking the card (Arthur, 25/11:
// "if it's a message it has to take everything"); the earlier ones sit in a row of chips underneath,
// and a click on a chip brings that one up big. A long text scrolls inside the big one.
// The card is wide (538 px) like every main card; while the rail is hovered it is half (views.ts).
// What it shows comes from src-tauri/src/toast_wa.rs through island/notifications.ts.

import { h, dot } from "./dom";
import { timeAgo } from "./integrations";
import { Notifs, recentNotifs, type NotifItem } from "../core/notifications";
import { pillDefinition } from "../core/pills";
import { State } from "../core/state";
import { language, t, N_ } from "../i18n/i18n";
import type { AgentTask } from "../core/state";

/** Chips under the big one. */
const CHIPS = 3;
const WHATSAPP_GREEN = "#25D366";

export interface NotifCardHost {
  el: HTMLElement;
  sync(task: AgentTask): void;
}

export function buildNotifCard(pillId: string): NotifCardHost {
  const def = pillDefinition(pillId);
  const headDot = dot(def?.color ?? "#FFFF77", 7);
  const headName = h("b", { text: def?.name ?? "Notifications" });
  const headKind = h("span", { text: t(def?.subtitle ?? N_("Windows notifications")) });
  const head = h("div", { class: "nt-head" }, headDot, headName, headKind);

  // The big one.
  const heroDot = h("span", { class: "nt-hero-dot" });
  const heroApp = h("span", { class: "nt-hero-app" });
  const heroAgo = h("span", { class: "nt-hero-ago" });
  const heroTitle = h("div", { class: "nt-hero-title" });
  const heroBody = h("div", { class: "nt-hero-body" });
  // Who, the app and the age on one line, so the text gets the room.
  const hero = h("div", { class: "nt-hero" },
    h("div", { class: "nt-hero-top" }, heroDot, heroTitle, heroApp, heroAgo),
    heroBody,
  );
  // A click on the big one reads it: the chips step aside and the text takes the whole card.
  hero.addEventListener("mousedown", (e) => e.stopPropagation());
  hero.addEventListener("click", (e) => {
    e.stopPropagation();
    el.classList.toggle("reading");
  });
  // The wheel scrolls a long text instead of reaching the island.
  heroBody.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
  const chips = h("div", { class: "nt-chips" });
  const empty = h("div", { class: "nt-empty", text: t("Listening to Windows notifications") });
  const el = h("div", { class: "nt" }, head, hero, chips, empty);
  let key = "";
  let heroKey = "";

  function show(index: number) {
    Notifs.shown[pillId] = index;
    State.notify();
  }

  return {
    el,
    sync(task) {
      const items = recentNotifs(pillId);
      const shownIndex = Math.min(Notifs.shown[pillId] ?? 0, Math.max(0, items.length - 1));
      // The ages move a minute at a time.
      const next = [
        language(), task.color, Math.floor(Date.now() / 60_000), shownIndex,
        ...items.map((n) => `${n.at}|${n.app}|${n.title}|${n.body ?? ""}`),
      ].join("~");
      if (next === key) return;
      key = next;
      headDot.style.background = task.color;
      const none = items.length === 0;
      empty.style.display = none ? "" : "none";
      head.style.display = none ? "" : "none";
      hero.style.display = none ? "none" : "";
      const big: NotifItem | undefined = items[shownIndex];
      if (big) {
        const color = big.whatsapp ? WHATSAPP_GREEN : task.color;
        heroDot.style.background = color;
        hero.style.setProperty("--nt-accent", color);
        heroApp.textContent = big.app;
        heroAgo.textContent = timeAgo(big.at);
        heroTitle.textContent = big.title || big.app;
        heroBody.textContent = big.body ?? "";
        heroBody.style.display = big.body ? "" : "none";
        const k = `${big.at}|${big.title}`;
        if (k !== heroKey) {
          heroKey = k;
          heroBody.scrollTop = 0;
          el.classList.remove("reading");
          // The one brought up comes in with a soft rise.
          hero.classList.remove("in");
          void hero.offsetWidth;
          hero.classList.add("in");
        }
      }
      const others = items.map((n, i) => ({ n, i })).filter(({ i }) => i !== shownIndex).slice(0, CHIPS);
      chips.style.display = others.length ? "" : "none";
      chips.replaceChildren(...others.map(({ n, i }) => {
        const chip = h("button", { class: "nt-chip", type: "button" },
          dot(n.whatsapp ? WHATSAPP_GREEN : task.color, 5),
          h("span", { class: "nt-chip-title", text: n.title || n.app }),
          h("span", { class: "nt-chip-ago", text: timeAgo(n.at) }),
        );
        chip.addEventListener("mousedown", (e) => e.stopPropagation());
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          show(i);
        });
        return chip;
      }));
    },
  };
}
