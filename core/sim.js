// Seeded synthetic metro: a grid of cell sectors, Cape subscribers with daily
// routines (home, commute, work, outings), and natural coverage gaps (Metro
// tunnels, phones switched off overnight). Times are minutes from Mon 00:00.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normal(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const DAY = 1440;
export const COLS = 10;
export const ROWS = 8;
export const CELL_KM = 1.2;

const LANDMARKS = {
  '4,0': 'Petworth', '5,0': 'Brookland', '2,1': 'Woodley Park', '4,1': 'Columbia Heights',
  '6,1': 'Edgewood', '1,1': 'Cleveland Park', '0,1': 'Tenleytown', '3,2': 'Adams Morgan',
  '5,2': 'Shaw', '6,2': 'NoMa', '2,3': 'Dupont Circle', '3,3': 'Farragut', '4,3': 'Metro Center',
  '5,3': 'Chinatown', '6,3': 'Union Station', '1,3': 'Georgetown', '2,4': 'Foggy Bottom',
  '3,4': 'Federal Triangle', '4,4': 'L\'Enfant Plaza', '5,4': 'Capitol Hill', '7,3': 'H Street',
  '4,5': 'Southwest Waterfront', '5,5': 'Navy Yard', '7,5': 'Anacostia', '8,2': 'Brentwood',
  '0,3': 'Palisades', '8,4': 'Hill East', '6,6': 'Congress Heights', '3,6': 'Bolling', '9,4': 'Benning'
};

export function cellId(x, y) { return y * COLS + x; }
export function cellXY(id) { return [id % COLS, Math.floor(id / COLS)]; }
export function cellName(id) {
  const [x, y] = cellXY(id);
  if (LANDMARKS[`${x},${y}`]) return LANDMARKS[`${x},${y}`];
  // nearest landmark
  let best = null, bd = 1e9;
  for (const k of Object.keys(LANDMARKS)) {
    const [lx, ly] = k.split(',').map(Number);
    const d = Math.abs(lx - x) + Math.abs(ly - y);
    if (d < bd) { bd = d; best = LANDMARKS[k]; }
  }
  return best;
}
export function isDowntown(id) {
  const [x, y] = cellXY(id);
  return x >= 2 && x <= 6 && y >= 3 && y <= 4;
}
export function cellDist(a, b) {
  const [ax, ay] = cellXY(a), [bx, by] = cellXY(b);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); // Chebyshev rings
}
export const NCELLS = COLS * ROWS;

// Number of cells at ring distance d from cell c (clipped to the grid).
export function ringSize(c, d) {
  const [x, y] = cellXY(c);
  let n = 0;
  for (let yy = y - d; yy <= y + d; yy++) for (let xx = x - d; xx <= x + d; xx++) {
    if (xx < 0 || yy < 0 || xx >= COLS || yy >= ROWS) continue;
    if (Math.max(Math.abs(xx - x), Math.abs(yy - y)) === d) n++;
  }
  return n;
}

function route(a, b) {
  // L-shaped path of cells from a to b (inclusive)
  const [ax, ay] = cellXY(a), [bx, by] = cellXY(b);
  const cells = [];
  let x = ax, y = ay;
  cells.push(cellId(x, y));
  while (x !== bx) { x += Math.sign(bx - x); cells.push(cellId(x, y)); }
  while (y !== by) { y += Math.sign(by - y); cells.push(cellId(x, y)); }
  return cells;
}

// Append a trip as moving segments; metro riders lose service in tunnels
// (downtown cells and the middle of long rides).
function addTrip(segs, from, to, t0, metro, rng) {
  const cells = route(from, to);
  if (cells.length === 1) return t0;
  const perCell = (metro ? 2.5 : 3.2) + rng() * 1.5;
  let t = t0;
  let tunnelStart = null;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const dur = perCell;
    const underground = metro && i > 0 && i < cells.length - 1 && (isDowntown(c) || i % 2 === 1);
    if (underground) {
      if (tunnelStart === null) tunnelStart = t;
    } else {
      if (tunnelStart !== null) { segs.push({ cell: -1, t0: tunnelStart, t1: t, moving: true }); tunnelStart = null; }
      segs.push({ cell: c, t0: t, t1: t + dur, moving: true });
    }
    t += dur;
  }
  if (tunnelStart !== null) segs.push({ cell: -1, t0: tunnelStart, t1: t, moving: true });
  return t;
}

function stay(segs, cell, t0, t1) {
  if (t1 <= t0) return;
  const last = segs[segs.length - 1];
  if (last && last.cell === cell && !last.moving && Math.abs(last.t1 - t0) < 1e-9) { last.t1 = t1; return; }
  segs.push({ cell, t0, t1, moving: false });
}

const RESIDENTIAL = [];
const DOWNTOWN = [];
for (let i = 0; i < NCELLS; i++) (isDowntown(i) ? DOWNTOWN : RESIDENTIAL).push(i);

export function simulatePerson(rng, days) {
  const home = RESIDENTIAL[Math.floor(rng() * RESIDENTIAL.length)];
  const work = rng() < 0.7 ? DOWNTOWN[Math.floor(rng() * DOWNTOWN.length)]
    : RESIDENTIAL[Math.floor(rng() * RESIDENTIAL.length)];
  const metro = rng() < 0.45;
  const offNights = rng() < 0.12 ? 0.6 : 0.03; // some people switch phones off at night
  const segs = [];
  for (let d = 0; d < days; d++) {
    const base = d * DAY;
    const weekday = d % 7 < 5;
    let t = Math.max(base, segs.length ? segs[segs.length - 1].t1 : 0);
    // overnight power-off (from previous evening into the morning)
    if (rng() < offNights && t < base + 30) {
      const off0 = base + 30 + rng() * 60, off1 = base + 360 + rng() * 60;
      stay(segs, home, t, off0);
      segs.push({ cell: -1, t0: off0, t1: off1, moving: false });
      t = off1;
    }
    if (weekday) {
      const dep = Math.max(t + 5, base + 450 + normal(rng) * 40);
      stay(segs, home, t, dep);
      t = addTrip(segs, home, work, dep, metro, rng);
      const leave = Math.max(t + 240, base + 1035 + normal(rng) * 55);
      stay(segs, work, t, leave);
      t = addTrip(segs, work, home, leave, metro, rng);
    } else {
      const out = base + 660 + normal(rng) * 90;
      stay(segs, home, t, Math.max(t + 5, out));
      t = Math.max(t + 5, out);
      if (rng() < 0.7) {
        const dest = rng() < 0.5 ? DOWNTOWN[Math.floor(rng() * DOWNTOWN.length)] : RESIDENTIAL[Math.floor(rng() * RESIDENTIAL.length)];
        t = addTrip(segs, home, dest, t, metro && rng() < 0.6, rng);
        const back = t + 120 + rng() * 180;
        stay(segs, dest, t, back);
        t = addTrip(segs, dest, home, back, metro && rng() < 0.6, rng);
      }
    }
    // evening outing
    if (rng() < (weekday ? 0.3 : 0.35) && t < base + 1140) {
      const go = Math.max(t + 20, base + 1140 + normal(rng) * 40);
      stay(segs, home, t, go);
      const dest = rng() < 0.6 ? DOWNTOWN[Math.floor(rng() * DOWNTOWN.length)] : RESIDENTIAL[Math.floor(rng() * RESIDENTIAL.length)];
      t = addTrip(segs, home, dest, go, false, rng);
      const back = Math.min(base + DAY + 60, t + 90 + rng() * 90);
      stay(segs, dest, t, back);
      t = addTrip(segs, dest, home, back, false, rng);
    }
    stay(segs, home, t, Math.max(t, base + DAY));
  }
  return { home, work, metro, segs };
}

export function simulateMetro({ seed = 20261110, users = 600, days = 14 } = {}) {
  const rng = mulberry32(seed);
  const people = [];
  for (let i = 0; i < users; i++) people.push(simulatePerson(rng, days));
  // Cape SIMs visiting from outside the metro: fresh identities that appear at
  // a hub and later vanish (cover traffic the observer also has to explain).
  const visitors = [];
  const hubs = [cellId(6, 3), cellId(4, 3), cellId(5, 5)];
  const nVisitors = Math.round(users * 0.04 * days);
  for (let i = 0; i < nVisitors; i++) {
    const t0 = rng() * days * DAY;
    const hub = hubs[Math.floor(rng() * hubs.length)];
    const dest = Math.floor(rng() * NCELLS);
    const stayMin = 240 + rng() * 2880;
    visitors.push({ appear: { cell: hub, t: t0 }, vanish: { cell: dest, t: t0 + stayMin } });
  }
  return { seed, users, days, people, visitors };
}

export function segmentAt(segs, t) {
  let lo = 0, hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].t0 <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

// Last cell with service at or before time t (for an outage, the cell before it).
export function cellBefore(segs, i) {
  for (let j = i; j >= 0; j--) if (segs[j].cell >= 0) return segs[j].cell;
  return segs.find(s => s.cell >= 0).cell;
}
export function cellAfter(segs, i) {
  for (let j = i; j < segs.length; j++) if (segs[j].cell >= 0) return segs[j].cell;
  return cellBefore(segs, segs.length - 1);
}
export function cellAtTime(segs, t) {
  const i = segmentAt(segs, t);
  const s = segs[i];
  if (s.cell >= 0) return { cell: s.cell, t };
  // in an outage: the device reattaches when service returns
  return { cell: cellAfter(segs, i + 1), t: s.t1 };
}
