// "Media" on the page (src-tauri/src/media.rs): whatever plays on this computer that is not Spotify
// (Spotify has its own pill). Rust reports; the card runs the position on while playing.

export const MEDIA_ID = "integration_media";

export interface MediaState {
  present: boolean;
  app: string;
  title: string;
  artist: string;
  playing: boolean;
  /** Seconds into the track at `atMs`. */
  position: number;
  duration: number;
  atMs: number;
  /** The cover (data URL), sent once per track. */
  art: string | null;
  artKey: string;
  /** The app's own volume in the Windows mixer, 0…100; -1 while it has no sound session. */
  volume: number;
}

export const EMPTY_MEDIA: MediaState = {
  present: false, app: "", title: "", artist: "", playing: false,
  position: 0, duration: 0, atMs: 0, art: null, artKey: "", volume: -1,
};

export const Media: { state: MediaState; art: string | null } = { state: EMPTY_MEDIA, art: null };

/** Takes a report: the cover is kept while the track is the same, dropped when it changes. */
export function applyMedia(s: MediaState): void {
  if (s.art) Media.art = s.art;
  else if (!s.present || s.artKey !== Media.state.artKey) Media.art = null;
  Media.state = s;
}

/** Where the track is now, in seconds (run on from the last report while playing). */
export function mediaPosition(s: MediaState, now = Date.now()): number {
  const p = s.playing ? s.position + (now - s.atMs) / 1000 : s.position;
  return s.duration > 0 ? Math.min(Math.max(p, 0), s.duration) : Math.max(p, 0);
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
