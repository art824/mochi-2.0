// The "Notifications" card: the last notifications Windows showed (app and first line only, never the
// text of a message). It takes the island's whole left card, widened to 538 px like Spotify's and
// Claude's while the other pills fold into the slim rail (the `.sp` class on the overview, views.ts).
// What it shows comes from src-tauri/src/toast_wa.rs through island/notifications.ts.

import { h, dot } from "./dom";
import { timeAgo } from "./integrations";
import { NOTIF_ID, Notifs } from "../core/notifications";
import { pillDefinition } from "../core/pills";
import { language, t, N_ } from "../i18n/i18n";
import type { AgentTask } from "../core/state";

/** How many rows fit under the header. */
const ROWS = 3;

export interface NotifCardHost {
  el: HTMLElement;
  sync(task: AgentTask): void;
}

export function buildNotifCard(): NotifCardHost {
  const headDot = dot(pillDefinition(NOTIF_ID)?.color ?? "#FFFF77", 7);
  const headName = h("b", { text: "Notifications" });
  const headKind = h("span", { text: t(pillDefinition(NOTIF_ID)?.subtitle ?? N_("Windows notifications")) });
  const head = h("div", { class: "nt-head" }, headDot, headName, headKind);
  const list = h("div", { class: "nt-list" });
  const empty = h("div", { class: "nt-empty", text: t("Listening to Windows notifications") });
  const el = h("div", { class: "nt" }, head, list, empty);
  let key = "";

  return {
    el,
    sync(task) {
      const items = Notifs.recent.slice(0, ROWS);
      // The ages move a minute at a time.
      const next = [
        language(), task.color, Math.floor(Date.now() / 60_000),
        ...items.map((n) => `${n.at}|${n.app}|${n.title}`),
      ].join("~");
      if (next === key) return;
      key = next;
      headDot.style.background = task.color;
      empty.style.display = items.length === 0 ? "" : "none";
      list.replaceChildren(...items.map((n, i) => {
        const row = h("div", { class: i === 0 ? "nt-row first" : "nt-row" },
          dot(n.whatsapp ? "#25D366" : task.color, 5),
          h("span", { class: "nt-title", text: n.title || n.app }),
          n.title ? h("span", { class: "nt-app", text: n.app }) : h("span"),
          h("span", { class: "nt-ago", text: timeAgo(n.at) }),
        );
        if (i === 0) row.style.background = `${n.whatsapp ? "#25D366" : task.color}1a`;
        return row;
      }));
    },
  };
}
