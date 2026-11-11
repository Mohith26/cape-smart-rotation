import { runScenario, coverEstimate, buildHistory, stoppingThresholds, WINDOW_MIN, WINDOW_MAX } from './core/rotation.js';
import { DAY, cellName, segmentAt, mulberry32 } from './core/sim.js';

const USERS = 600;
const SEED = 20261110;
const SILENCE = { short: [2, 6], balanced: [4, 12], strong: [8, 20] };
const NOW = 13 * DAY + 21 * 60 + 41;            // Sun Nov 8, 9:41 PM
const START = Date.UTC(2026, 9, 26);            // day 0 = Mon Oct 26, 2026
const state = { policy: 'smart', silence: 'balanced', cache: {} };
const $ = id => document.getElementById(id);

function dateOf(t) { return new Date(START + Math.floor(t / DAY) * 864e5); }
function clock(t) {
  const m = ((t % DAY) + DAY) % DAY;
  let h = Math.floor(m / 60); const mm = String(Math.floor(m % 60)).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${h}:${mm} ${ap}`;
}
function dayLabel(t) {
  const d = dateOf(t);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function wk(t) { return dateOf(t).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }); }
const pct = x => `${Math.round(x * 100)}%`;
function imsiTail(k) { return String(Math.floor(mulberry32(SEED + 7919 * k)() * 10000)).padStart(4, '0'); }

function scenario() {
  const key = state.silence;
  if (!state.cache[key]) state.cache[key] = runScenario({ seed: SEED, users: USERS, silence: SILENCE[key] });
  return state.cache[key];
}

function focalRotations(s, ev) {
  return ev.results.filter(x => x.r.user === s.focal).sort((a, b) => a.r.vanish.t - b.r.vanish.t);
}

function howText(r) {
  const off = r.appear.t - r.vanish.t;
  const offTxt = off >= 90 ? `${(off / 60).toFixed(1)} h` : off >= 2 ? `${Math.round(off)} min` : `${Math.round(off * 60)} s`;
  const a = cellName(r.vanish.cell), b = cellName(r.appear.cell);
  const where = a === b ? a : `${a} to ${b}`;
  if (r.kind === 'scheduled') return `Scheduled · ${where} · ${offTxt} offline`;
  if (r.kind === 'move') return `On the move · ${where} · ${offTxt} offline`;
  if (r.kind === 'outage') return `While already offline · ${where} · ${offTxt}`;
  return `Window closing · ${where} · ${offTxt} offline`;
}

function render() {
  const s = scenario();
  const ev = state.policy === 'smart' ? s.smart : s.fixed;
  const other = state.policy === 'smart' ? s.fixed : s.smart;
  const mine = focalRotations(s, ev);
  const theirs = focalRotations(s, other);
  const p = s.world.people[s.focal];

  // header model line
  $('modelLine').innerHTML = `SIMULATED DC METRO · ${USERS} CAPE PHONES · 2 WEEKS<br>PASSIVE OBSERVER LOGS 311-588 IDS BY CELL`;

  // ---- home card
  const last = mine.filter(x => x.r.decided <= NOW).at(-1).r;
  const k = mine.length;
  $('homeImsi').textContent = imsiTail(k);
  $('rotImsi').textContent = imsiTail(k);
  const agoH = (NOW - last.appear.t) / 60;
  $('homeAgo').textContent = `${Math.round(agoH)}H AGO`;
  $('rotUpdated').textContent = `UPDATED ${Math.round(agoH)}H AGO`;
  const bars = [];
  // 42 ticks across the 28-hour maximum, 40 minutes each
  for (let i = 0; i < 42; i++) {
    const on = i < Math.round(agoH * 1.5);
    const win = state.policy === 'smart' && i >= 30;
    bars.push(`<i class="${on ? 'on' : ''} ${win ? 'win' : ''}"></i>`);
  }
  $('homeBars').innerHTML = bars.join('');
  $('homeMode').textContent = state.policy === 'smart' ? 'SMART TIMING' : 'EVERY 24 HRS';
  if (state.policy === 'smart') {
    const a = last.decided + WINDOW_MIN, b = last.decided + WINDOW_MAX;
    $('homeNext').innerHTML = `Next: when you're on the move or offline, <b>${wk(a)} ${clock(a)}</b> to <b>${clock(b)}</b>`;
  } else {
    $('homeNext').innerHTML = `Next: <b>${wk(last.decided + DAY)} ${clock(last.decided + DAY)}</b>, wherever you are`;
  }

  // ---- rotation screen
  document.querySelectorAll('#policySeg button').forEach(b => b.classList.toggle('sel', b.dataset.p === state.policy));
  document.querySelectorAll('#silenceChips button').forEach(b => b.classList.toggle('sel', b.dataset.s === state.silence));
  $('silenceChips').classList.toggle('off', state.policy !== 'smart');
  const sil = SILENCE[state.silence];
  $('rotSub').textContent = state.policy === 'smart' ? 'Auto-rotate IMSI every 20 to 28 hours' : 'Auto-rotate IMSI every 24 hours';
  $('timingSub').textContent = state.policy === 'smart'
    ? `Rotates while you're moving or already offline, so your new ID shows up somewhere else. Offline ${sil[0]} to ${sil[1]} min when moving.`
    : 'Rotates at the same time every day, wherever you are. Service drops for 30 to 60 seconds.';

  const linkedMine = mine.reduce((a, x) => a + x.linked, 0);
  const linkedTheirs = theirs.reduce((a, x) => a + x.linked, 0);
  $('weekBars').innerHTML = mine.slice(-7).map(x =>
    `<div class="wb" title="${dayLabel(x.r.vanish.t)} ${clock(x.r.vanish.t)}: observer confidence ${pct(x.pTrue)}"><div class="bar ${x.linked >= 0.5 ? 'bad' : ''}" style="height:${Math.max(3, x.pTrue * 46)}px"></div><span>${wk(x.r.vanish.t)[0]}</span></div>`).join('');
  $('linkedBig').textContent = `${Math.round(linkedMine)} of ${mine.length} linked`;
  $('linkedVs').textContent = `${state.policy === 'smart' ? 'Every 24 hours' : 'Smart'}: ${Math.round(linkedTheirs)} of ${theirs.length}`;

  // ---- privacy screen
  $('cLinkF').textContent = pct(s.fixed.linkRate);
  $('cLinkS').textContent = pct(s.smart.linkRate);
  $('cAnonF').textContent = s.fixed.medianAnon.toFixed(1);
  $('cAnonS').textContent = s.smart.medianAnon.toFixed(1);
  $('cOffF').textContent = `${s.fixed.offlineMin.toFixed(1)} min`;
  $('cOffS').textContent = `${s.smart.offlineMin.toFixed(1)} min`;
  $('cFoot').innerHTML = `${USERS} SIMULATED CAPE PHONES · ROTATIONS NOV 2 TO 8 (${s.fixed.n.toLocaleString()} DAILY, ${s.smart.n.toLocaleString()} SMART)`;
  $('listPolicy').textContent = state.policy === 'smart' ? 'SMART' : 'EVERY 24 HOURS';
  $('rotList').innerHTML = mine.slice(-4).reverse().map(x => `
    <div class="li"><span class="when">${dayLabel(x.r.vanish.t)} · ${clock(x.r.vanish.t)}</span>
    <span class="how">${howText(x.r)}</span>
    <span class="res"><b>${pct(x.pTrue)}</b><span class="tag ${x.linked >= 0.5 ? 'bad' : 'ok'}">${x.linked >= 0.5 ? 'LINKED' : 'HIDDEN'}</span></span></div>`).join('');

  // ---- rotate-now check (on-device estimate)
  const seg = p.segs[segmentAt(p.segs, NOW)];
  const nowEst = coverEstimate(NOW, 0.75, seg.moving, USERS);
  const hist = buildHistory(p, USERS, mulberry32(SEED + 3), 0, 7 * DAY);
  const lastSmart = focalRotations(s, s.smart).filter(x => x.r.decided <= NOW).at(-1).r;
  const a = lastSmart.decided + WINDOW_MIN;
  const V = stoppingThresholds(hist, a, coverEstimate(a + 8 * 60, (sil[0] + sil[1]) / 2, false, USERS).pLink);
  $('sheetNow').textContent = pct(nowEst.pLink);
  $('sheetNext').textContent = pct(V[0]);
  $('sheetNextLbl').textContent = `NEXT WINDOW · ${wk(a).toUpperCase()} ${clock(a)}`;
  $('sheetBody').textContent = `You're at ${cellName(seg.cell >= 0 ? seg.cell : p.home)} and not moving, so your new Cape ID would appear in this cell about 45 seconds after the old one goes quiet. Estimated chance an observer links them:`;
}

function illo() {
  // simplified rotating-identifier prism, in the app's mint illustration style
  return `<svg viewBox="0 0 260 120" xmlns="http://www.w3.org/2000/svg" fill="none">
  <g stroke="#cfcfcf" stroke-width="1.2" stroke-dasharray="5 4" opacity=".75">
    <path d="M58 72c-14-18 2-40 22-38"/><path d="M92 26c10-16 34-14 40 2"/><path d="M150 22c14-12 36-6 36 10"/>
    <path d="M196 70c16 6 18 26 2 32"/><path d="M104 104c-6 10-26 12-34 2"/><path d="M150 108c4 8 22 10 30 0"/>
  </g>
  <g transform="rotate(-24 130 64)">
    <polygon points="62,48 200,48 210,40 72,40" fill="#dce8e8" stroke="#111" stroke-width="1"/>
    <rect x="62" y="48" width="138" height="30" fill="#a9c8c6" stroke="#111" stroke-width="1"/>
    <polygon points="200,48 210,40 210,70 200,78" fill="#7fa3a0" stroke="#111" stroke-width="1"/>
    <polygon points="62,48 50,56 50,86 62,78 62,48" fill="#c5dbd9" stroke="#111" stroke-width="1"/>
    <polygon points="50,86 62,78 200,78 188,86" fill="#8fb3b0" stroke="#111" stroke-width="1"/>
    <text x="72" y="46" font-family="Hanken Grotesk, sans-serif" font-size="8.5" fill="#111" transform="skewX(-48) translate(42 0)">311 · 588 · 123456789</text>
    <text x="70" y="68" font-family="Hanken Grotesk, sans-serif" font-size="13" fill="#111">311 · 588 · 987654321</text>
    <path d="M52 66a6 6 0 1 1 3 6" stroke="#111" stroke-width="1.6"/><path d="M53.5 74l1.6-2.5 2.6 1.4" stroke="#111" stroke-width="1.4"/>
  </g></svg>`;
}

async function boot() {
  try {
    const svg = await (await fetch('cape-logo.svg')).text();
    $('logo').innerHTML = svg; $('wordmark').innerHTML = svg;
  } catch (e) { $('logo').textContent = 'Cape'; $('wordmark').textContent = 'Cape'; }
  $('illo').innerHTML = illo();
  document.querySelectorAll('#policySeg button').forEach(b => b.addEventListener('click', () => { state.policy = b.dataset.p; render(); }));
  document.querySelectorAll('#silenceChips button').forEach(b => b.addEventListener('click', () => {
    state.silence = b.dataset.s;
    document.body.classList.add('busy');
    setTimeout(() => { render(); document.body.classList.remove('busy'); }, 30);
  }));
  $('rotateNow').addEventListener('click', () => { $('sheet').hidden = false; });
  $('sheetWait').addEventListener('click', () => { $('sheet').hidden = true; });
  $('sheetAnyway').addEventListener('click', () => { $('sheet').hidden = true; });
  // deep links for sharing a specific view: ?policy=fixed&offline=strong&sheet=1
  const q = new URLSearchParams(location.search);
  if (q.get('policy') === 'fixed') state.policy = 'fixed';
  if (SILENCE[q.get('offline')]) state.silence = q.get('offline');
  render();
  if (q.get('sheet') === '1') $('sheet').hidden = false;
}
boot();
