import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, simulatePerson, DAY, simulateMetro } from '../core/sim.js';
import {
  linkAttack, stoppingThresholds, runScenario, fixedPolicy, smartPolicy,
  WINDOW_MIN, WINDOW_MAX, coverEstimate, learnKernel
} from '../core/rotation.js';

test('rng is deterministic per seed', () => {
  const a = mulberry32(7), b = mulberry32(7);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test('person timelines are contiguous and cover every day', () => {
  const rng = mulberry32(3);
  for (let k = 0; k < 50; k++) {
    const p = simulatePerson(rng, 14);
    for (let i = 1; i < p.segs.length; i++) {
      assert.ok(Math.abs(p.segs[i].t0 - p.segs[i - 1].t1) < 1e-6, 'gap between segments');
      assert.ok(p.segs[i].t1 >= p.segs[i].t0);
    }
    assert.ok(p.segs.at(-1).t1 >= 14 * DAY - 1e-6);
  }
});

function world(users = 120) {
  const w = simulateMetro({ seed: 11, users, days: 14 });
  const r = mulberry32(5);
  w.people.forEach(p => { p.offset = r() * DAY; });
  return w;
}

test('fixed policy rotates once per 24 hours', () => {
  const w = world();
  const rots = fixedPolicy(w, mulberry32(1));
  const per = new Map();
  for (const r of rots) per.set(r.user, [...(per.get(r.user) || []), r.decided]);
  for (const ts of per.values()) for (let i = 1; i < ts.length; i++) assert.ok(Math.abs(ts[i] - ts[i - 1] - DAY) < 1e-6);
});

test('smart policy always rotates within 20 to 28 hours of the last rotation', () => {
  const w = world();
  const rots = smartPolicy(w, mulberry32(2));
  const per = new Map();
  for (const r of rots) per.set(r.user, [...(per.get(r.user) || []), r.decided]);
  for (const ts of per.values()) for (let i = 1; i < ts.length; i++) {
    const g = ts[i] - ts[i - 1];
    assert.ok(g >= WINDOW_MIN - 1e-6 && g <= WINDOW_MAX + 1e-6, `gap ${g}`);
  }
});

test('stopping values never get worse with more time left', () => {
  const hist = new Map();
  for (let h = 0; h < 24; h++) for (const k of ['wd', 'we']) hist.set(k + h, { days: 5, best: [0.2, 0.5, 0.9] });
  const V = stoppingThresholds(hist, 3 * DAY, 0.95);
  for (let k = 0; k < V.length - 1; k++) assert.ok(V[k] <= V[k + 1] + 1e-12);
  assert.equal(V.at(-1), 0.95);
});

test('linking posterior: lone successor is certain, twins split evenly', () => {
  const K = learnKernel([{ vanish: { cell: 10, t: 0 }, appear: { cell: 10, t: 0.7 } }]);
  const r = { vanish: { cell: 10, t: 100 }, appear: { cell: 10, t: 100.7 } };
  let out = linkAttack([r], [{ t: 100.7, cell: 10, rot: r }], K);
  assert.ok(Math.abs(out[0].pTrue - 1) < 1e-12);
  assert.equal(out[0].linked, 1);
  out = linkAttack([r], [{ t: 100.7, cell: 10, rot: r }, { t: 100.7, cell: 10, rot: null }], K);
  assert.ok(Math.abs(out[0].pTrue - 0.5) < 1e-12);
  assert.ok(Math.abs(out[0].linked - 0.5) < 1e-12);
  assert.ok(Math.abs(out[0].anonymity - 2) < 1e-9);
});

test('cover estimate grows with silence and movement', () => {
  const t = 8 * 60 + 15; // Monday 8:15
  assert.ok(coverEstimate(t, 10, true, 600).lambda > coverEstimate(t, 10, false, 600).lambda);
  assert.ok(coverEstimate(t, 10, true, 600).lambda > coverEstimate(t, 4, true, 600).lambda);
});

test('headline: Smart Timing makes most rotations unlinkable for the observer', () => {
  const s = runScenario({ users: 600 });
  assert.ok(s.fixed.linkRate > 0.95, `fixed ${s.fixed.linkRate}`);
  assert.ok(s.smart.linkRate < 0.5, `smart ${s.smart.linkRate}`);
  assert.ok(s.smart.medianAnon > 4 * s.fixed.medianAnon);
  // the on-device estimate ranks rotations the same way the observer does
  const xs = s.smart.results.map(x => x.r.est.pLink), ys = s.smart.results.map(x => x.pTrue);
  const rank = a => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); idx.forEach(([, i], k) => { r[i] = k; }); return r; };
  const rx = rank(xs), ry = rank(ys);
  const n = xs.length, mx = (n - 1) / 2;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - mx); dx += (rx[i] - mx) ** 2; dy += (ry[i] - mx) ** 2; }
  const rho = num / Math.sqrt(dx * dy);
  assert.ok(rho > 0.3, `spearman ${rho}`);
});
