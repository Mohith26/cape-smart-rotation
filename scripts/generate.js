// Regenerates data/summary.json from the seeded simulation (same code the page runs).
import { runScenario } from '../core/rotation.js';
import { writeFileSync } from 'node:fs';
const presets = { short: [2, 6], balanced: [4, 12], strong: [8, 20] };
const out = { seed: 20261110, users: 600, days: 14, presets: {} };
for (const [k, silence] of Object.entries(presets)) {
  const s = runScenario({ seed: out.seed, users: out.users, silence });
  const pick = e => ({ rotations: e.n, linkRate: +e.linkRate.toFixed(4), meanConfidence: +e.meanP.toFixed(4), medianLookalikes: +e.medianAnon.toFixed(2), extraOfflineMin: +e.offlineMin.toFixed(2), byKind: e.kinds });
  out.presets[k] = { silence, fixed: pick(s.fixed), smart: pick(s.smart) };
}
writeFileSync(new URL('../data/summary.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out.presets.balanced));
