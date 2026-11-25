// The "Media" card: what plays on this computer that is not Spotify (a YouTube tab, a video player).
// It is the Spotify card's twin — same cover, same text swap, same transport, same progress bar,
// same wide layout, same volume (the playing app's own, in the Windows mixer) — without shuffle and
// repeat; the app's name sits where those are.
// What it shows comes from src-tauri/src/media.rs through island/media.ts.

import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { Bridge } from "../core/bridge";
import { State } from "../core/state";
import { MEDIA_ID, Media, clock, mediaPosition } from "../core/media";
import { pillDefinition } from "../core/pills";
import { CoverFade, NowPlayingBar, fitMarquee, swapText } from "./spotify";
import { volumeLevel } from "../core/spotify";
import { N_, t } from "../i18n/i18n";

export const MEDIA_COLOR = pillDefinition(MEDIA_ID)?.color ?? "#FF0000";

// A slider drag sends at most one volume every 120 ms, like the Spotify card's.
let pendingVolume: number | null = null;
let volumeTimer: number | null = null;

function setVolume(value: number) {
  if (Media.state.volume < 0) return;
  const v = Math.min(100, Math.max(0, Math.round(value)));
  Media.state = { ...Media.state, volume: v };
  State.notify();
  pendingVolume = v;
  if (volumeTimer != null) return;
  const send = () => {
    const next = pendingVolume;
    pendingVolume = null;
    if (next == null) {
      volumeTimer = null;
      return;
    }
    void Bridge.mediaControl("volume", next);
    volumeTimer = window.setTimeout(send, 120);
  };
  send();
}

export interface MediaCardHost {
  el: HTMLElement;
  sync(): void;
}

export function buildMediaCard(): MediaCardHost {
  const glow = new CoverFade("np-glow");
  const art = new CoverFade("np-art");
  const note = svg(ICONS.musicNote, 22);
  note.style.color = `${MEDIA_COLOR}b3`;
  art.el.append(note);
  const eq = h("span", { class: "np-eq" }, h("i"), h("i"), h("i"));
  const title = h("span", { class: "np-title" });
  const subtitle = h("div", { class: "np-sub" });
  const text = h("div", { class: "np-text" }, h("div", { class: "np-title-row" }, eq, title), subtitle);

  const prev = h("button", { class: "np-skip", onclick: () => void Bridge.mediaControl("prev") }, svg(ICONS.backward, 22));
  const next = h("button", { class: "np-skip", onclick: () => void Bridge.mediaControl("next") }, svg(ICONS.forward, 22));
  const play = h("button", { class: "np-play", onclick: () => void Bridge.mediaControl("playpause") });
  const transport = h("div", { class: "np-transport" }, prev, play, next);

  let dragFraction: number | null = null;
  const elapsed = h("span", { class: "np-time elapsed" });
  const remaining = h("span", { class: "np-time remaining" });
  const progress = new NowPlayingBar(
    (f) => {
      dragFraction = f;
      paintProgress();
    },
    (f) => {
      const d = Media.state.duration;
      dragFraction = null;
      if (d > 0) void Bridge.mediaControl("seek", f * d);
    },
    MEDIA_COLOR,
  );
  const progressRow = h("div", { class: "np-progress" }, elapsed, progress.el, remaining);

  const appName = h("span", { class: "np-app" });
  // The app's name on the left, its volume on the right (where the Spotify card has its own).
  const volIcon = h("span", { class: "np-vol-icon" });
  const volume = new NowPlayingBar(
    (f) => setVolume(f * 100),
    (f) => setVolume(f * 100),
    MEDIA_COLOR,
  );
  const volumeBox = h("div", { class: "np-volume" }, volIcon, volume.el);
  let volShown: number | null = null;
  const extra = h("div", { class: "np-extra" }, h("div", { class: "np-flags" }, appName), volumeBox);
  const playingEl = h("div", { class: "np-wide" }, glow.el, art.el, text, transport, progressRow, extra);

  // Pill on, nothing playing: the same layout as the other idle cards.
  const idleText = h("span", { text: t("Nothing playing") });
  const idleEl = h("div", { class: "int-card" },
    h("div", { class: "int-head" }, dot(MEDIA_COLOR, 7), h("b", { text: "Media" }), h("span", { text: t(pillDefinition(MEDIA_ID)?.subtitle ?? N_("Now playing")) })),
    h("div", { class: "int-status" }, dot("#22C55E", 5), idleText),
  );

  const el = h("div", { class: "np-root" });
  let showing: "playing" | "idle" | null = null;
  let shownKey = "";
  let playIcon: boolean | null = null;
  let timer: number | null = null;

  function paintProgress() {
    const s = Media.state;
    const d = s.duration;
    const pos = dragFraction != null ? dragFraction * d : mediaPosition(s, Date.now());
    const f = dragFraction ?? (d > 0 ? Math.min(1, Math.max(0, pos / d)) : 0);
    progress.set(f);
    elapsed.textContent = clock(f * d);
    remaining.textContent = d > 0 ? `-${clock(Math.max(0, d - f * d))}` : "";
  }

  /** The position runs on its own clock, twice a second, only while it plays on screen. */
  function syncTimer() {
    const on = () => Media.state.playing && el.isConnected && State.mode === "expanded" && State.view === "overview";
    if (on() && showing === "playing" && timer == null) {
      timer = window.setInterval(() => {
        if (!on()) {
          if (timer != null) window.clearInterval(timer);
          timer = null;
          return;
        }
        paintProgress();
      }, 500);
    } else if (!(on() && showing === "playing") && timer != null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  function syncPlaying() {
    const s = Media.state;
    const animate = shownKey !== "";
    if (shownKey !== s.artKey) {
      shownKey = s.artKey;
      swapText(title, s.title, animate);
      swapText(subtitle, s.artist, animate);
    }
    fitMarquee(title);
    fitMarquee(subtitle);
    appName.textContent = s.app;
    art.el.title = s.app;
    art.set(Media.art);
    glow.set(Media.art);
    playingEl.classList.toggle("playing", s.playing);
    progress.enabled = s.duration > 0;
    paintProgress();
    prev.title = t("Previous");
    next.title = t("Next");
    if (playIcon !== s.playing) {
      playIcon = s.playing;
      clear(play);
      const icon = svg(s.playing ? ICONS.pause : ICONS.play, 18);
      if (!s.playing) icon.style.transform = "translateX(1px)";
      play.append(icon);
    }
    play.title = s.playing ? t("Pause") : t("Play");
    // No sound session yet (nothing came out of the speakers): no slider.
    volumeBox.style.visibility = s.volume < 0 ? "hidden" : "";
    if (s.volume >= 0) {
      const level = volumeLevel(s.volume);
      if (volShown !== level) {
        volShown = level;
        clear(volIcon);
        volIcon.append(svg([ICONS.volume0, ICONS.volume1, ICONS.volume2, ICONS.volume3][level], 14, { stroke: 2.2 }));
      }
      volume.set(s.volume / 100);
      volumeBox.title = t("Volume {0}%", { 0: s.volume });
    }
  }

  return {
    el,
    sync() {
      const want = Media.state.present ? "playing" : "idle";
      if (want !== showing) {
        showing = want;
        clear(el);
        el.append(want === "playing" ? playingEl : idleEl);
        shownKey = "";
      }
      if (want === "playing") syncPlaying();
      syncTimer();
    },
  };
}
