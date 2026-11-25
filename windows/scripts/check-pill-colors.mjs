// Fails when a NEW pill of the catalog (src/core/pills.ts) has a colour too close to another pill's.
// Arthur, 24/11/2026: the Media pill got nearly the same orange as Claude's, and the Notifications
// pill sat 9 steps from Copilot's violet — two Mochis read as one. Run by F:\tools\build-coucou2.bat
// before the build, and by `npm run check:colors`.
//
// The pills below existed before this check; the catalog already had look-alike pairs among them and
// they are left alone. Any pill NOT in BASELINE is new: it must be at least MIN_DISTANCE (RGB, 0–441)
// away from every other pill. When you add a pill, pick its colour here first:
//   node scripts/check-pill-colors.mjs --suggest
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MIN_DISTANCE = 70;

const BASELINE = new Set([
  "integration_claude", "agent_cursor", "agent_antigravity", "agent_codex", "agent_gemini", "agent_copilot",
  "agent_muse", "agent_opencode", "agent_amp", "agent_hermes", "agent_claude-desktop",
  "integration_resend", "integration_n8n", "integration_vercel", "integration_github", "integration_gitlab",
  "integration_gitea", "integration_notion", "integration_calcom", "integration_stripe", "integration_music",
  "integration_spotify", "integration_mail", "integration_whatsapp",
]);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/core/pills.ts"), "utf8");

const pills = [];
for (const m of src.matchAll(/\{\s*id:\s*"([^"]+)"\s*,\s*name:\s*"[^"]*"\s*,\s*color:\s*"(#[0-9A-Fa-f]{6})"/g)) {
  pills.push({ id: m[1], hex: m[2].toUpperCase() });
}
if (pills.length < 10) {
  console.error(`check-pill-colors: found only ${pills.length} pills in pills.ts; the file's shape changed, fix this script.`);
  process.exit(2);
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

if (process.argv.includes("--suggest")) {
  const best = [];
  for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (lum < 90 || sat < 90) continue; // visible on black, not grey
    const hex = "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
    best.push([Math.round(Math.min(...pills.map((p) => dist(rgb(hex), rgb(p.hex))))), hex]);
  }
  best.sort((a, b) => b[0] - a[0]);
  console.log("Free colours (distance to the nearest pill, colour):");
  for (const [d, hex] of best.slice(0, 10)) console.log(`  ${d}  ${hex}`);
  process.exit(0);
}

const bad = [];
for (const p of pills.filter((x) => !BASELINE.has(x.id))) {
  for (const o of pills) {
    if (o.id === p.id) continue;
    const d = dist(rgb(p.hex), rgb(o.hex));
    if (d < MIN_DISTANCE) bad.push(`${p.id} ${p.hex}  is too close to  ${o.id} ${o.hex}  (distance ${Math.round(d)}, needs ${MIN_DISTANCE})`);
  }
}
if (bad.length) {
  console.error("check-pill-colors: a new pill has a colour too much like another one. Change it in src/core/pills.ts");
  console.error("(run `node scripts/check-pill-colors.mjs --suggest` for free colours):");
  for (const b of bad) console.error("  " + b);
  process.exit(1);
}
const fresh = pills.filter((x) => !BASELINE.has(x.id)).length;
console.log(`check-pill-colors: ${pills.length} pills, ${fresh} new ones checked, all tell apart.`);
