// Island open/close FSM — port of IslandStateMachine.swift.
// No DOM, no Tauri: it only reports transitions.

export type FsmState = "hidden" | "petit" | "home" | "coucou";

export class IslandStateMachine {
  state: FsmState = "hidden";

  onTransition: ((from: FsmState, to: FsmState) => void) | null = null;

  /**
   * home → petit delay, seconds: the auto-close preference. Changing it while a
   * countdown runs starts that countdown again with the new delay, so an edit in
   * Settings applies at once (IslandStateMachine.homeToPetitDelay on macOS).
   */
  get homeToPetitDelay(): number {
    return this.homeDelay;
  }
  set homeToPetitDelay(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds === this.homeDelay) return;
    this.homeDelay = seconds;
    if (this.state === "home" && this.homeCollapse != null) this.scheduleHomeCollapse();
  }
  /** petit → hidden delay, seconds. */
  petitToHiddenDelay = 60;
  /**
   * Strict hiding: the island is out of sight unless asked for. It wakes only
   * after the pointer has rested on the top strip for `revealHoverDelay`, and
   * anything that shows it (a notice, a card folding, the greeting) folds away
   * again on its own.
   */
  strictHide = false;
  /** Seconds the pointer must rest on the folded strip before the island shows. */
  revealHoverDelay = 1.4;
  /** In strict mode: seconds the compact island stays once the pointer is off it. */
  strictPetitDelay = 2; // was 5: Arthur wanted it "very smaller" (23/11)
  /** In strict mode: seconds a notice stays on screen when nobody hovers it. */
  strictNoticeDelay = 8;
  /** coucou → petit once the greeting animation ends (no hover). */
  greetAutoCollapseDelay = 0.6;
  /** coucou → petit while the mouse hovers the greeting. */
  greetHoverCollapseDelay = 10;
  /** An alert waiting for an answer stays open, even when the mouse leaves. */
  pinned = false;
  /**
   * The dictation keeps the compact island up while it listens, processes and
   * shows Copy. Its own flag: the alert code sets and clears `pinned` in many
   * places and must not be able to drop the island in the middle of a dictation.
   */
  hold = false;
  /**
   * Hovering opens the island all the way instead of peeking (Settings →
   * General → Open on hover, off by default), as IslandStateMachine.openOnHover.
   */
  openOnHover = false;
  /** Grace period after the pointer leaves a hover-opened island, seconds. */
  hoverCloseDelay = 0.6;
  /** How long the pointer rests on the compact island before Open on hover opens it, seconds. */
  hoverOpenDelay = 0.5;
  /** Open because of a hover, until the user clicks inside it. */
  get openedByHover(): boolean {
    return this.byHover;
  }

  /**
   * When the open island will fold, on the performance.now() clock, while the
   * mouse-leave countdown runs; null otherwise. The island draws its countdown
   * bar from it.
   */
  homeCollapseDueAt: number | null = null;

  private homeDelay = 15;
  private byHover = false;
  private petitHide: number | null = null;
  private homeCollapse: number | null = null;
  private greetCollapse: number | null = null;
  private hoverOpen: number | null = null;
  private hoverReveal: number | null = null;

  // ── Inputs ──────────────────────────────────────────────────────────────────

  launch() {
    this.cancelTimers();
    this.transition("coucou");
  }

  mouseEntered() {
    switch (this.state) {
      case "hidden":
        // Strict mode: the pointer has to stay put for a while before the
        // island shows. Leaving the strip (mouseLeft) cancels it. A card that
        // waits for an answer is never made to wait.
        if (this.strictHide && !this.pinned && this.revealHoverDelay > 0) {
          if (this.hoverReveal == null) {
            this.hoverReveal = window.setTimeout(() => {
              this.hoverReveal = null;
              if (this.state !== "hidden") return;
              this.cancelTimers();
              this.transition("petit");
              if (this.openOnHover && !this.pinned) this.scheduleHoverOpen();
            }, this.revealHoverDelay * 1000);
          }
          break;
        }
        // The closed island only peeks: a PC has no notch, so the pointer
        // lands on it far more often than on a Mac's, on its way elsewhere.
        this.cancelTimers();
        this.transition("petit");
        if (this.openOnHover && !this.pinned) this.scheduleHoverOpen();
        break;
      case "petit":
        this.clear("petitHide");
        // Open on hover: once the pointer rests on the compact island.
        if (this.openOnHover && !this.pinned) this.scheduleHoverOpen();
        break;
      case "home":
        this.clear("homeCollapse");
        break;
      case "coucou":
        this.scheduleGreetCollapse(this.greetHoverCollapseDelay);
        break;
    }
  }

  mouseLeft() {
    this.clear("hoverOpen");
    this.clear("hoverReveal");
    switch (this.state) {
      case "hidden":
        break;
      case "petit":
        this.schedulePetitHide();
        break;
      case "home":
        this.scheduleHomeCollapse();
        break;
      case "coucou":
        this.clear("greetCollapse");
        this.transition("petit");
        break;
    }
  }

  click() {
    this.byHover = false;
    if (this.state !== "petit") return;
    this.cancelTimers();
    this.transition("home");
  }

  /**
   * A click on the wake strip while the island is hidden: no waiting for the
   * hover, it opens right away (Arthur, 23/11).
   */
  clickHidden() {
    if (this.state !== "hidden") return;
    this.byHover = false;
    this.cancelTimers();
    this.transition("home");
  }

  /** Greeting animation finished (T.end). Doesn't override a running hover timer. */
  greetComplete() {
    if (this.state !== "coucou") return;
    if (this.greetCollapse == null) this.scheduleGreetCollapse(this.greetAutoCollapseDelay);
  }

  /** Non-alert work event: show compact from hidden. */
  reveal() {
    if (this.state !== "hidden") return;
    this.cancelTimers();
    this.transition("petit");
    // A notice: in strict mode it stays a little longer than a mere peek.
    this.schedulePetitHide(this.strictHide ? this.strictNoticeDelay : undefined);
  }

  /**
   * The user clicked inside the island: a hover-opened island now stays like
   * any open island (normal auto-close) instead of folding once the pointer leaves.
   */
  userInteracted() {
    if (!this.byHover) return;
    this.byHover = false;
    // The short countdown already running becomes the normal one.
    if (this.state === "home" && this.homeCollapse != null) this.scheduleHomeCollapse();
  }

  /** Alert or explicit request: open straight to expanded. */
  forceHome() {
    this.byHover = false;
    this.cancelTimers();
    this.transition("home");
  }

  /** Folds the compact island away after `seconds` (unless something pins it). */
  fold(seconds: number) {
    if (this.state === "petit" && !this.pinned && !this.hold) this.schedulePetitHide(seconds);
  }

  /// Explicit close (OK button, Escape, an alert being answered).
  forcePetit() {
    this.byHover = false;
    this.cancelTimers();
    this.transition("petit");
  }

  forceHidden() {
    this.byHover = false;
    this.cancelTimers();
    this.transition("hidden");
  }

  // ── Timers ──────────────────────────────────────────────────────────────────

  private schedulePetitHide(seconds?: number) {
    this.clear("petitHide");
    // A card folded away while it waits for an answer keeps the compact island
    // on screen, so it can be reopened (isHeldOpen on macOS).
    if (this.pinned || this.hold) return;
    const delay = seconds ?? (this.strictHide ? this.strictPetitDelay : this.petitToHiddenDelay);
    this.petitHide = window.setTimeout(() => {
      this.petitHide = null;
      if (this.state === "petit" && !this.pinned && !this.hold) this.transition("hidden");
    }, delay * 1000);
  }

  private scheduleHomeCollapse() {
    this.clear("homeCollapse");
    if (this.pinned) return;
    const ms = (this.byHover ? this.hoverCloseDelay : this.homeDelay) * 1000;
    this.homeCollapseDueAt = performance.now() + ms;
    this.homeCollapse = window.setTimeout(() => {
      this.homeCollapse = null;
      this.homeCollapseDueAt = null;
      // An alert pinned while the countdown ran keeps the island open.
      if (this.state === "home" && !this.pinned) {
        this.byHover = false;
        this.transition("petit");
      }
    }, ms);
  }

  private scheduleHoverOpen() {
    this.clear("hoverOpen");
    this.hoverOpen = window.setTimeout(() => {
      this.hoverOpen = null;
      if (this.state !== "petit" || this.pinned || !this.openOnHover) return;
      this.cancelTimers();
      this.byHover = true;
      this.transition("home");
    }, this.hoverOpenDelay * 1000);
  }

  private scheduleGreetCollapse(delay: number) {
    this.clear("greetCollapse");
    this.greetCollapse = window.setTimeout(() => {
      this.greetCollapse = null;
      if (this.state === "coucou") this.transition("petit");
    }, delay * 1000);
  }

  private clear(which: "petitHide" | "homeCollapse" | "greetCollapse" | "hoverOpen" | "hoverReveal") {
    const id = this[which];
    if (id != null) window.clearTimeout(id);
    this[which] = null;
    if (which === "homeCollapse") this.homeCollapseDueAt = null;
  }

  cancelTimers() {
    this.clear("hoverReveal");
    this.clear("hoverOpen");
    this.clear("petitHide");
    this.clear("homeCollapse");
    this.clear("greetCollapse");
  }

  private transition(next: FsmState) {
    if (next === this.state) return;
    const from = this.state;
    this.state = next;
    this.onTransition?.(from, next);
  }
}
