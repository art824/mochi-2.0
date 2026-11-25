// The Claude Desktop card: every session the app is running, by name.
//
// The hooks used to blur all of the app's sessions into one pill called "Claude
// Desktop", so you could not tell one chat from two. Now each session has a
// row (folder name, state, how long ago) and the live ticker shows the one you
// pick, or the one that wants you. Same wide slot as Spotify's card: 536 px,
// the content starting after the Mochi's 108 px (style.css, ".ss-*").

import { h, clear, dot } from "./dom";
import { Ticker } from "./ticker";
import { Bridge } from "../core/bridge";
import { State, BUSY_STATES, type AgentTask, type SessionInfo } from "../core/state";
import { N_, t } from "../i18n/i18n";

export interface SessionsCardHost {
  el: HTMLElement;
  /** Draws the pill's sessions; `task` is the Claude Desktop pill. */
  sync(task: AgentTask): void;
  /** Frame step of the ticker on show. True while it moves. */
  tick(nowMs: number): boolean;
}

const LABELS: Record<string, string> = {
  thinking: N_("thinking"),
  working: N_("working"),
  question: N_("asking you"),
  approval: N_("needs your OK"),
  ratelimit: N_("rate limit"),
  finished: N_("done"),
  error: N_("error"),
  idle: N_("idle"),
};

/** Who needs you comes first, then who is busy, then the rest; newest first. */
function rank(s: SessionInfo): number {
  if (s.state === "question" || s.state === "approval" || s.state === "ratelimit" || s.state === "error") return 0;
  return BUSY_STATES.has(s.state) ? 1 : 2;
}

function dotColor(s: SessionInfo, accent: string): string {
  switch (s.state) {
    case "question":
    case "approval":
      return "var(--amber)";
    case "ratelimit":
    case "error":
      return "var(--red)";
    case "finished":
      // Not green: that is Spotify's colour (Arthur, 23/11).
      return "var(--cyan)";
    case "idle":
      return "var(--dim-3)";
    default:
      return accent;
  }
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 45) return t("now");
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

/** The last two folders of a path: enough to tell two projects apart. */
function tail(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join("\\");
}

interface Row {
  el: HTMLElement;
  dot: HTMLElement;
  name: HTMLElement;
  meta: HTMLElement;
}

export function buildSessionsCard(onDiff: (diffId: number) => void): SessionsCardHost {
  const headDot = dot("var(--dim-3)", 8);
  const headName = h("span", { class: "ss-name" });
  const headState = h("span", { class: "ss-state" });
  const headCount = h("span", { class: "ss-count" });
  const head = h("div", { class: "ss-head" }, headDot, headName, headState, headCount);
  const tickerSlot = h("div", { class: "ss-ticker" });
  const foot = h("span", { class: "ss-path" });
  const open = h("button", {
    class: "ss-open",
    text: t("Open Claude"),
    onclick: () => void Bridge.openClaudeDesktop(),
  });
  const footRow = h("div", { class: "ss-foot" }, foot, open);
  const main = h("div", { class: "ss-main" }, head, tickerSlot, footRow);

  // Nothing open: the card says so and offers the app.
  const emptyText = h("div", { class: "ss-empty-t", text: t("No Claude Desktop session open") });
  const emptyBtn = h("button", {
    class: "ss-empty-b",
    text: t("Open Claude"),
    onclick: () => void Bridge.openClaudeDesktop(),
  });
  const empty = h("div", { class: "ss-empty" }, emptyText, emptyBtn);

  const list = h("div", { class: "ss-list" });
  const el = h("div", { class: "ss" }, main, list, empty);

  const tickers = new Map<string, Ticker>();
  const rows = new Map<string, Row>();
  let rowOrder = "";
  let pickedId: string | null = null;
  let shownId: string | null = null;
  let lastTask: AgentTask | null = null;
  let swapTimer: number | null = null;

  function tickerFor(id: string): Ticker {
    let tk = tickers.get(id);
    if (!tk) {
      tk = new Ticker(onDiff);
      tickers.set(id, tk);
    }
    return tk;
  }

  /** The one on show: your pick while it lives, else who needs you, else the newest. */
  function choose(sessions: SessionInfo[]): SessionInfo | null {
    if (!sessions.length) return null;
    const picked = pickedId ? sessions.find((s) => s.id === pickedId) : null;
    if (picked) return picked;
    pickedId = null;
    return [...sessions].sort((a, b) => rank(a) - rank(b) || b.lastActive - a.lastActive)[0];
  }

  function buildRow(s: SessionInfo): Row {
    const d = dot("var(--dim-3)", 8);
    const name = h("span", { class: "n" });
    const meta = h("span", { class: "m" });
    const row = h("div", { class: "ss-row", onclick: () => select(s.id) }, d, name, meta);
    return { el: row, dot: d, name, meta };
  }

  function select(id: string) {
    if (shownId === id) return;
    Bridge.log(`sessions: picked ${id.slice(0, 8)}`);
    pickedId = id;
    if (lastTask) paint(lastTask, true);
  }

  function paint(task: AgentTask, fade: boolean) {
    const sessions = State.sessionsOf(task.id);
    const accent = task.color;
    el.classList.toggle("none", sessions.length === 0);
    if (!sessions.length) {
      shownId = null;
      for (const r of rows.values()) r.el.remove();
      rows.clear();
      rowOrder = "";
      return;
    }

    // Rows: updated in place, so a state change fades its dot instead of rebuilding the list.
    const sorted = [...sessions].sort((a, b) => rank(a) - rank(b) || b.lastActive - a.lastActive);
    const chosen = choose(sessions)!;
    for (const s of sorted) {
      let r = rows.get(s.id);
      if (!r) rows.set(s.id, (r = buildRow(s)));
      r.name.textContent = s.name;
      r.dot.style.background = dotColor(s, accent);
      r.dot.classList.toggle("busy", s.state === "thinking" || s.state === "working");
      r.meta.textContent = BUSY_STATES.has(s.state) || s.state === "error" ? t(LABELS[s.state] ?? "") : `${t(LABELS[s.state] ?? "")} · ${ago(s.lastActive)}`;
      r.meta.classList.toggle("warn", s.state === "question" || s.state === "approval");
      r.el.classList.toggle("sel", s.id === chosen.id);
    }
    for (const [id, r] of rows) {
      if (!sessions.some((s) => s.id === id)) {
        r.el.remove();
        rows.delete(id);
        tickers.delete(id);
      }
    }
    const order = sorted.map((s) => s.id).join("|");
    if (order !== rowOrder) {
      rowOrder = order;
      for (const s of sorted) list.append(rows.get(s.id)!.el);
    }

    // The main column: the session on show.
    const fill = () => {
      shownId = chosen.id;
      headDot.style.background = dotColor(chosen, accent);
      headDot.classList.toggle("busy", chosen.state === "thinking" || chosen.state === "working");
      headName.textContent = chosen.name;
      headState.textContent = t(LABELS[chosen.state] ?? "");
      headCount.textContent = sessions.length === 1 ? t("1 session") : t("{count} sessions", { count: sessions.length });
      foot.textContent = tail(chosen.cwd);
      foot.title = chosen.cwd;
      const tk = tickerFor(chosen.id);
      if (tickerSlot.firstChild !== tk.el) {
        clear(tickerSlot);
        tickerSlot.append(tk.el);
      }
      tk.sync(chosen as unknown as AgentTask);
    };

    if (shownId !== null && shownId !== chosen.id && fade) {
      // Another session: the column fades out, changes, fades back in.
      if (swapTimer != null) window.clearTimeout(swapTimer);
      main.classList.add("swap");
      shownId = chosen.id;
      swapTimer = window.setTimeout(() => {
        swapTimer = null;
        fill();
        main.classList.remove("swap");
      }, 130);
    } else if (swapTimer == null) {
      fill();
    }
  }

  // "2m" ages move on their own: refresh while the card is on screen.
  window.setInterval(() => {
    if (lastTask && el.isConnected && State.mode === "expanded") paint(lastTask, false);
  }, 15_000);

  return {
    el,
    sync(task) {
      lastTask = task;
      paint(task, true);
    },
    tick(nowMs) {
      const tk = shownId ? tickers.get(shownId) : null;
      if (!tk) return false;
      tk.tick(nowMs);
      return tk.animating;
    },
  };
}
