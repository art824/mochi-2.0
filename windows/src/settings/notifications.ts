// Settings → Integrations → Windows notifications: the new way, next to the old WhatsApp gateway.
// No third-party software and no login: Coucou reads what the Windows notification center shows
// (src-tauri/src/toast_wa.rs) and lights the "Notifications" pill. One switch turns it on; one
// choice says whether only WhatsApp or every app shows up. Only the app and the first line of a
// toast are used — never the text of a message.

import { Bridge } from "../core/bridge";
import { NOTIF_ID } from "../core/notifications";
import { pillDefinition } from "../core/pills";
import { h } from "../views/dom";
import { t } from "../i18n/i18n";

type Toggle = (on: boolean, onChange: (v: boolean) => void) => HTMLElement;

export interface NotificationsSettingsHost {
  toggle: Toggle;
  /** Whether the Notifications pill is among the active ones. */
  pillActive(): boolean;
  /** Turns the pill on (when a slot is free) or off, and saves. */
  setPill(on: boolean): void;
  /** How many pills may be active. */
  maxPills: number;
}

export const NOTIF_COLOR = pillDefinition(NOTIF_ID)?.color ?? "#FFFF77";

export function notificationsSection(host: NotificationsSettingsHost): HTMLElement {
  const note = h("div", { class: "hint" });
  const scope = h(
    "select",
    {},
    h("option", { value: "all", text: t("Every app") }),
    h("option", { value: "whatsapp", text: t("Only WhatsApp") }),
  ) as HTMLSelectElement;
  const scopeRow = h("div", { class: "row" }, h("label", { text: t("Which notifications") }), scope);
  const enable = host.toggle(host.pillActive(), (on) => {
    host.setPill(on);
    draw();
  });

  function draw() {
    const on = host.pillActive();
    enable.classList.toggle("on", on);
    enable.setAttribute("aria-pressed", String(on));
    scopeRow.style.display = on ? "" : "none";
    note.textContent = on
      ? t("Windows has to allow it: if nothing shows up, check Settings › Privacy › Notifications in Windows.")
      : "";
    note.style.display = on ? "" : "none";
  }

  scope.addEventListener("change", () => void Bridge.toastScopeSet(scope.value === "all"));
  void Bridge.toastScopeGet().then((all) => {
    scope.value = all === false ? "whatsapp" : "all";
  }).catch(() => {});

  const section = h(
    "section",
    { "data-pill": NOTIF_ID },
    h("h2", {}, h("i", { class: "dot", style: `background:${NOTIF_COLOR}` }), h("span", { text: t("Windows notifications (new way)") })),
    h("div", { class: "hint", text: t("Reads the notifications Windows already shows. No third-party software, no login, no way to send. Only the app and the first line of each one are used; the text of a message is never kept or logged.") }),
    h("div", { class: "row" }, h("label", { text: t("Show Windows notifications") }), enable),
    scopeRow,
    note,
  );
  draw();
  return section;
}
