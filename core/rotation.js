// Rotation policies (fixed 24h clock vs Smart Timing), the on-device cover
// estimate, the optimal-stopping thresholds, and the passive-observer linking
// attack used to score every rotation.
import {
  DAY, NCELLS, mulberry32, segmentAt, cellBefore, cellAfter, cellAtTime,
  cellDist, ringSize, simulateMetro, cellXY, COLS, ROWS
} from './sim.js';

export const WINDOW_MIN = 20 * 60;   // earliest rotation after the last one
export const WINDOW_MAX = 28 * 60;   // latest (deadline)
export const SILENCE = [4, 12];      // minutes offline when rotating on the move
const HOUR = 60;

// ---- on-device cover estimate -------------------------------------------
// Relative rotation density by hour of day (prior the app ships with): Cape
// devices are most likely to be rotating during commute peaks.
export function hourFactor(t) {
  const h = Math.floor((t % DAY) / 60);
  const weekday = Math.floor(t / DAY) % 7 < 5;
  if (!weekday) return h >= 10 && h <= 21 ? 1.2 : 0.35;
  if ((h >= 7 && h <= 9) || (h >= 16 && h <= 19)) return 2.6;
  if (h >= 10 && h <= 15) return 1.0;
  if (h >= 20 && h <= 23) return 0.8;
  return 0.3;
}

// Cells an observer has to consider: grows with silence while moving.
export function reachCells(gapMin, moving) {
  if (!moving) return 1;
  const r = Math.min(4, Math.max(1, Math.round(gapMin / 3)));
  return Math.min(NCELLS, (2 * r + 1) * (2 * r + 1));
}

// Expected number of other fresh Cape identities that show up in the region
// the observer must search, and the implied chance of being linked.
export function coverEstimate(t, gapMin, moving, users) {
  const ratePerCellMin = users / DAY / NCELLS; // one rotation per device per day
  const window = Math.max(gapMin, 0.5) * 2;   // observer's plausible window
  const lambda = ratePerCellMin * hourFactor(t) * window * reachCells(gapMin, moving);
  return { lambda, pLink: 1 / (1 + lambda) };
}

// ---- rotation events ---------------------------------------------------
function rotationAt(p, t, gap, kind, rng) {
  const segs = p.segs;
  const i = segmentAt(segs, t);
  const s = segs[i];
  if (s.cell < 0) {
    // already offline: swap the identity during the gap
    return { kind: 'outage', vanish: { cell: cellBefore(segs, i), t: s.t0 }, appear: { cell: cellAfter(segs, i + 1), t: s.t1 }, moving: s.moving };
  }
  const ap = cellAtTime(segs, t + gap);
  return { kind, vanish: { cell: s.cell, t }, appear: ap, moving: s.moving };
}

export function fixedPolicy(world, rng) {
  const out = [];
  const T = world.days * DAY;
  world.people.forEach((p, u) => {
    for (let t = p.offset; t < T - 30; t += DAY) {
      const r = rotationAt(p, t, 0.5 + 0.5 * rng(), 'scheduled', rng);
      r.user = u; r.decided = t;
      out.push(r);
    }
  });
  return out;
}

// All moments inside [a, b) where Smart Timing could rotate.
export function opportunities(p, a, b, users, rng, silence = SILENCE) {
  const segs = p.segs;
  const opps = [];
  let i = segmentAt(segs, a);
  for (; i < segs.length && segs[i].t0 < b; i++) {
    const s = segs[i];
    if (s.t0 < a) continue;
    if (s.cell < 0 && s.t1 - s.t0 >= 3) {
      const gap = s.t1 - s.t0;
      const est = coverEstimate(s.t0, gap, s.moving, users);
      opps.push({ t: s.t0, kind: 'outage', gap, moving: s.moving, est, i });
    } else if (s.cell >= 0 && s.moving && i > 0 && segs[i - 1].moving) {
      const gap = silence[0] + (silence[1] - silence[0]) * rng();
      const est = coverEstimate(s.t0, gap, true, users);
      opps.push({ t: s.t0, kind: 'move', gap, moving: true, est, i });
    }
  }
  return opps;
}

// Backward induction over hourly bins of the window: V[k] is the expected
// link chance if we have not rotated by the start of bin k and act optimally.
export function stoppingThresholds(history, a, deadlineP) {
  const bins = Math.round((WINDOW_MAX - WINDOW_MIN) / HOUR);
  const V = new Array(bins + 1).fill(0);
  V[bins] = deadlineP;
  for (let k = bins - 1; k >= 0; k--) {
    const t = a + k * HOUR;
    const key = binKey(t);
    const h = history.get(key);
    if (!h || h.days === 0) { V[k] = V[k + 1]; continue; }
    const pOpp = h.best.length / h.days;
    let e = 0;
    for (const x of h.best) e += Math.min(x, V[k + 1]);
    e = h.best.length ? e / h.best.length : V[k + 1];
    V[k] = pOpp * e + (1 - pOpp) * V[k + 1];
  }
  return V;
}

function binKey(t) {
  const weekday = Math.floor(t / DAY) % 7 < 5;
  return (weekday ? 'wd' : 'we') + Math.floor((t % DAY) / 60);
}

// The device's own history (week 1): best opportunity per hour of day.
export function buildHistory(p, users, rng, from, to) {
  const hist = new Map();
  for (let d = Math.floor(from / DAY); d < Math.floor(to / DAY); d++) {
    const opps = opportunities(p, d * DAY, (d + 1) * DAY, users, rng);
    const bestByHour = new Map();
    for (const o of opps) {
      const k = binKey(o.t);
      bestByHour.set(k, Math.min(bestByHour.get(k) ?? 1, o.est.pLink));
    }
    const weekday = d % 7 < 5;
    for (let h = 0; h < 24; h++) {
      const k = (weekday ? 'wd' : 'we') + h;
      if (!hist.has(k)) hist.set(k, { days: 0, best: [] });
      const e = hist.get(k);
      e.days++;
      if (bestByHour.has(k)) e.best.push(bestByHour.get(k));
    }
  }
  return hist;
}

export function smartPolicy(world, rng, silence = SILENCE) {
  const out = [];
  const T = world.days * DAY;
  const histEnd = 7 * DAY;
  world.people.forEach((p, u) => {
    const history = buildHistory(p, world.users, rng, 0, histEnd);
    let last = p.offset - DAY; // previous rotation happened a day before
    while (true) {
      const a = last + WINDOW_MIN, b = last + WINDOW_MAX;
      if (a >= T - 30) break;
      const dGap = 6 + 9 * rng();
      const deadlineEst = coverEstimate(Math.min(b, T - 1), dGap, false, world.users);
      const V = stoppingThresholds(history, a, deadlineEst.pLink);
      const opps = opportunities(p, a, Math.min(b, T - 30), world.users, rng, silence);
      let chosen = null;
      for (const o of opps) {
        const k = Math.min(V.length - 1, Math.floor((o.t - a) / HOUR) + 1);
        if (o.est.pLink <= V[k]) { chosen = o; break; }
      }
      let r;
      if (chosen) {
        const s = p.segs[chosen.i];
        if (chosen.kind === 'outage') {
          r = { kind: 'outage', vanish: { cell: cellBefore(p.segs, chosen.i), t: s.t0 }, appear: { cell: cellAfter(p.segs, chosen.i + 1), t: s.t1 }, moving: s.moving };
        } else {
          r = { kind: 'move', vanish: { cell: s.cell, t: s.t0 }, appear: cellAtTime(p.segs, s.t0 + chosen.gap), moving: true };
        }
        r.est = chosen.est; r.decided = chosen.t;
      } else {
        if (b >= T - 30) break;
        r = rotationAt(p, b, dGap, 'deadline', rng);
        r.est = deadlineEst; r.decided = b;
      }
      r.user = u;
      out.push(r);
      last = r.decided;
    }
  });
  return out;
}

// ---- passive observer ---------------------------------------------------
// The observer sees every Cape-range identity (MCC-MNC 311-588) per cell with
// timestamps: when an identity goes silent for good ("vanish") and when a
// never-seen identity shows up ("appear"). It knows the policy, so it learns
// the joint distribution of (silence length, distance moved) for true pairs
// from week 1 and scores every candidate successor in week 2.
const DT_EDGES = [0, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 721];
const MAXD = 7;
function dtBin(dt) {
  for (let i = DT_EDGES.length - 2; i >= 0; i--) if (dt >= DT_EDGES[i]) return i;
  return 0;
}

export function learnKernel(pairs) {
  const nb = DT_EDGES.length - 1;
  const K = Array.from({ length: nb }, () => new Array(MAXD + 1).fill(0.02));
  let n = 0;
  for (const r of pairs) {
    const dt = r.appear.t - r.vanish.t;
    if (dt <= 0 || dt > 720) continue;
    K[dtBin(dt)][Math.min(MAXD, cellDist(r.vanish.cell, r.appear.cell))] += 1;
    n++;
  }
  // convert to a density per minute per cell
  for (let b = 0; b < nb; b++) {
    const w = DT_EDGES[b + 1] - DT_EDGES[b];
    for (let d = 0; d <= MAXD; d++) K[b][d] = K[b][d] / (n + 1) / w;
  }
  return K;
}

export function linkAttack(targets, appears, K) {
  // appears sorted by time
  const res = [];
  for (const r of targets) {
    const tv = r.vanish.t;
    let lo = 0, hi = appears.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (appears[m].t <= tv) lo = m + 1; else hi = m; }
    let total = 0, trueW = 0, maxW = 0, nMax = 0, H = 0;
    const ws = [];
    for (let j = lo; j < appears.length && appears[j].t - tv <= 720; j++) {
      const a = appears[j];
      const dt = a.t - tv;
      const d = cellDist(r.vanish.cell, a.cell);
      const w = K[dtBin(dt)][Math.min(MAXD, d)] / ringSize(r.vanish.cell, Math.min(d, 9));
      ws.push(w);
      total += w;
      if (a.rot === r) trueW = w;
    }
    for (const w of ws) {
      if (w > maxW * (1 + 1e-9)) { maxW = w; nMax = 1; } else if (Math.abs(w - maxW) <= maxW * 1e-9) nMax++;
      const q = w / total;
      if (q > 0) H -= q * Math.log(q);
    }
    const pTrue = total > 0 ? trueW / total : 1;
    const top = Math.abs(trueW - maxW) <= maxW * 1e-9 ? 1 / nMax : 0;
    res.push({ r, pTrue, linked: top, anonymity: Math.exp(H), candidates: ws.length });
  }
  return res;
}

function worldEvents(world, rots) {
  const appears = rots.map(r => ({ t: r.appear.t, cell: r.appear.cell, rot: r }));
  for (const v of world.visitors) appears.push({ t: v.appear.t, cell: v.appear.cell, rot: null });
  appears.sort((x, y) => x.t - y.t);
  return appears;
}

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function evaluate(world, rots) {
  const wk2 = 7 * DAY;
  const train = rots.filter(r => r.vanish.t < wk2);
  const test = rots.filter(r => r.vanish.t >= wk2);
  const K = learnKernel(train);
  const appears = worldEvents(world, rots);
  const res = linkAttack(test, appears, K);
  const n = res.length;
  const linkRate = res.reduce((s, x) => s + x.linked, 0) / n;
  const meanP = res.reduce((s, x) => s + x.pTrue, 0) / n;
  // extra time without service caused by the rotation itself (an outage that
  // was happening anyway costs nothing extra)
  const extra = res.map(x => x.r.kind === 'outage' ? 0 : x.r.appear.t - x.r.vanish.t);
  const offline = extra.reduce((s, v) => s + v, 0) / n;
  const kinds = {};
  for (const x of res) kinds[x.r.kind] = (kinds[x.r.kind] || 0) + 1;
  return {
    n, linkRate, meanP, offlineMin: offline,
    medianAnon: median(res.map(x => x.anonymity)),
    kinds, results: res
  };
}

// Pick a representative subscriber for the app screens: Metro commuter who
// lives well outside downtown and works downtown.
export function pickFocal(world) {
  let best = 0, bd = -1;
  world.people.forEach((p, i) => {
    if (!p.metro) return;
    const d = cellDist(p.home, p.work);
    const [hx, hy] = cellXY(p.home);
    if (d >= 3 && d > bd && hy <= 2) { bd = d; best = i; }
  });
  return best;
}

export function runScenario({ seed = 20261110, users = 600, days = 14, silence = SILENCE } = {}) {
  const world = simulateMetro({ seed, users, days });
  const rng0 = mulberry32(seed ^ 0x9e3779b9);
  world.people.forEach(p => { p.offset = rng0() * DAY; });
  const fixed = evaluate(world, fixedPolicy(world, mulberry32(seed + 1)));
  const smart = evaluate(world, smartPolicy(world, mulberry32(seed + 2), silence));
  const focal = pickFocal(world);
  return { world, fixed, smart, focal };
}

export { COLS, ROWS };
