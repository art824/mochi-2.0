// Dev only (not shipped): puts the island preview in "Spotify is focused" with a
// fake track, island held open, so the card can be looked at and measured.
// Use from the console of dev/island-preview.html:
//   const m = await import("/dev/spotify-scene.ts"); await m.scene({ playing: true });
import { State } from "../src/core/state";
import { Spotify, SPOTIFY_ID } from "../src/core/spotify";

function cover(): string {
  const c = document.createElement("canvas");
  c.width = c.height = 300;
  const g = c.getContext("2d")!;
  const gr = g.createLinearGradient(0, 0, 300, 300);
  gr.addColorStop(0, "#d8344a");
  gr.addColorStop(0.55, "#7a1f3d");
  gr.addColorStop(1, "#1b0b2e");
  g.fillStyle = gr;
  g.fillRect(0, 0, 300, 300);
  g.fillStyle = "rgba(255,255,255,.14)";
  g.beginPath();
  g.arc(210, 90, 70, 0, 7);
  g.fill();
  return c.toDataURL("image/jpeg", 0.9);
}

export async function scene(o: { playing?: boolean; track?: boolean } = {}) {
  const island = (window as any).__island;
  const playing = o.playing ?? true;
  const hasTrack = o.track ?? true;
  Spotify.artwork = { artUrl: "x://cover", dataUrl: cover() };
  Spotify.state = {
    installed: true, running: true, playing: playing && hasTrack, position: 84, positionAt: Date.now(),
    repeat: false, shuffle: true, volume: 70,
    track: hasTrack
      ? { id: "spotify:track:1", title: "Blinding Lights", artist: "The Weeknd", album: "After Hours", duration: 200, artUrl: "x://cover" }
      : null,
  };
  if (!State.settings.activeIntegrations.includes(SPOTIFY_ID)) {
    State.settings = { ...State.settings, activeIntegrations: [...State.settings.activeIntegrations, SPOTIFY_ID] };
  }
  State.loadIntegrationTasks();
  island.fsm.forceHome();
  island.fsm.pinned = true; // the preview island never folds on its own
  await new Promise((r) => setTimeout(r, 1200));
  State.setFocus(SPOTIFY_ID);
  State.view = "overview";
  State.notify();
  await new Promise((r) => setTimeout(r, 1200));
}

export function rects(sel: string[]) {
  const out: Record<string, unknown> = { innerWidth };
  for (const s of sel) {
    const el = document.querySelector(s);
    if (!el) { out[s] = null; continue; }
    const r = el.getBoundingClientRect();
    out[s] = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }
  return out;
}
