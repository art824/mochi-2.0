// Dev only (not shipped): Claude Desktop in front with fake sessions, island held open.
//   const m = await import("/dev/sessions-scene.ts"); await m.scene(3);
import { State } from "../src/core/state";

const DESK = "agent_claude-desktop";
const NAMES = [
  ["coucou-build", "F:/coucou-build/coucou"],
  ["idea", "C:/claude sites/idea"],
  ["offline-kit", "F:/OFFLINE-KIT"],
  ["upwork-demanda", "C:/claude sites/upwork"],
  ["mochi-2.0", "F:/coucou-build/mochi-2.0"],
];

export async function scene(n = 3) {
  const island = (window as any).__island;
  State.sessions.clear();
  if (n > 0) {
    State.upsertExternalAgent(DESK, "Claude Desktop", "#D97757");
    for (let i = 0; i < n; i++) {
      const [name, cwd] = NAMES[i];
      const s = State.touchSession(DESK, "sess-" + i, name, cwd)!;
      s.state = i === 0 ? "working" : i === 1 ? "finished" : "thinking";
      if (i === 3) s.state = "approval";
      s.steps = ["Read fsm.ts", "Edit style.css", "Bash npx tsc --noEmit"].slice(0, 3 - (i % 2));
      s.stepIndex = s.steps.length - 1;
      s.stepSeq = s.stepIndex;
      s.lastActive = Date.now() - i * 130_000;
    }
    const t = State.tasks.find((x) => x.id === DESK)!;
    t.state = "working";
  } else if (!State.tasks.some((x) => x.id === DESK)) {
    State.upsertExternalAgent(DESK, "Claude Desktop", "#D97757");
  }
  island.fsm.forceHome();
  island.fsm.pinned = true;
  await new Promise((r) => setTimeout(r, 900));
  State.setFocus(DESK);
  State.view = "overview";
  State.notify();
  await new Promise((r) => setTimeout(r, 1200));
}
