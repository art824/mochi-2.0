// "Media" → the page (src-tauri/src/media.rs): the report goes into core/media.ts and the card
// follows it. Nothing else reacts: no sound, no reveal — a song is not news.

import { Bridge, onEvent } from "../core/bridge";
import { applyMedia, type MediaState } from "../core/media";
import { State } from "../core/state";

export function registerMediaHandlers() {
  void onEvent<MediaState>("media-state", (s) => {
    applyMedia(s);
    State.notify();
  });
  void Bridge.mediaState()
    .then((s) => {
      if (s) {
        applyMedia(s);
        State.notify();
      }
    })
    .catch(() => {});
}
