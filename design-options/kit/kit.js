// Shared mockup kit: data access, formatting, coverage, draft tables and the review chrome.
// Plain browser JS so each option stays one self-contained file.
'use strict';
const BUDGET = 200;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v, d = 0) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(d));
const money = (v) => (v == null ? '–' : `$${v}`);
const signed = (v, pre = '') => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${pre}${Math.abs(v)}`);
const tone = (v, eps = 0) => (v == null ? '' : v > eps ? 'gain' : v < -eps ? 'loss' : 'muted');
const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);

const OWN = new Map(D.owners.map((o) => [o.k, o]));
const SEASON = new Map(D.seasons.map((s) => [s.y, s]));
const YEARS = D.seasons.map((s) => s.y);
const LIVE = D.seasons.find((s) => s.live)?.y;
const name = (k) => OWN.get(k)?.name ?? k;
const crew = (k, y) => SEASON.get(y)?.rows.find((r) => r.o === k)?.crew ?? name(k);
const rowOf = (k, y) => SEASON.get(y)?.rows.find((r) => r.o === k);
const place = (n) => (n == null ? '–' : n === 1 ? '1st 🏆' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

// Picks as objects. ref = the price reference (ESPN average auction value, or the Sleeper-file estimate).
const PICKS = D.picks.map(([y, o, p, price, keeper, ref, refKind, proj, projKind, pts, ptsKind, round, overall, nfl, worth], i) => ({
  i, y, o, p, name: D.players[p][0], pos: D.players[p][1], price, share: price / BUDGET, keeper: !!keeper, ref, refKind, proj, projKind, pts, ptsKind, round, overall, nfl, worth,
  value: worth == null ? null : worth - price,
}));
const BY_YEAR = new Map();
for (const x of PICKS) { if (!BY_YEAR.has(x.y)) BY_YEAR.set(x.y, []); BY_YEAR.get(x.y).push(x); }
const DRAFT_YEARS = [...BY_YEAR.keys()].sort((a, b) => a - b);
const BY_PLAYER = new Map();
for (const x of PICKS) { if (!BY_PLAYER.has(x.p)) BY_PLAYER.set(x.p, []); BY_PLAYER.get(x.p).push(x); }

// What is known for each season, so gaps read as "not recorded" instead of zero.
function coverage(y) {
  const ps = BY_YEAR.get(y) ?? [];
  const n = ps.length || 1;
  const count = (f) => ps.filter(f).length;
  const s = SEASON.get(y);
  const sleeper = s?.plat === 'Sleeper';
  const keepers = count((x) => x.keeper);
  const level = (k, label, detail) => ({ k, label, detail });
  return [
    level('full', 'Scores', 'Every game'),
    y === LIVE ? level('part', 'Lineups', 'This season lives on the Standings and Teams pages') : y <= 2017 ? level('part', 'Lineups', 'Starters only, no bench or projections') : level('full', 'Lineups', 'Starters, bench and projections'),
    !ps.length ? level('none', 'Draft', 'No draft recorded') : level('full', 'Draft', `${ps.length} picks, auction, $${BUDGET} each`),
    !ps.length ? level('none', 'Keepers', '') : y === 2010 ? level('none', 'Keepers', 'None flagged in the ESPN file') : y === 2024 ? level('part', 'Keepers', `Sleeper flags ${keepers}; your sheet says 30`) : y === 2022 ? level('part', 'Keepers', `ESPN flags ${keepers}; your sheet says 20`) : y === 2023 ? level('part', 'Keepers', `${keepers} flagged; your sheet reconstructed 2023`) : level('full', 'Keepers', `${keepers} flagged`),
    !ps.length ? level('none', 'Price ref', '') : sleeper ? level('part', 'Price ref', 'Estimate from the export, not a Sleeper number') : count((x) => x.ref != null) === 0 ? level('none', 'Price ref', 'ESPN average value not recorded') : level(count((x) => x.ref != null) / n > 0.85 ? 'full' : 'part', 'Price ref', `ESPN average value for ${count((x) => x.ref != null)} of ${ps.length}`),
    !ps.length ? level('none', 'Projection', '') : sleeper ? level('part', 'Projection', 'Pulled after the season (hindsight)') : count((x) => x.proj != null) === 0 ? level('none', 'Projection', 'ESPN preseason points start in 2018') : level(count((x) => x.proj != null) / n > 0.85 ? 'full' : 'part', 'Projection', `ESPN preseason points for ${count((x) => x.proj != null)} of ${ps.length}`),
    !ps.length ? level('none', 'Season pts', '') : y === LIVE ? level('part', 'Season pts', 'Season to date') : sleeper ? level('part', 'Season pts', 'Weeks on a league roster only, from the lineups') : level('full', 'Season pts', 'Full season, league scoring'),
    y >= 2019 && ps.length ? level('none', 'Your model', 'League_Draft_History.xlsx not loaded in this mockup') : level('none', 'Your model', 'Sheet covers 2019 to 2026'),
  ];
}
const MARK = { full: '●', part: '½', none: '–' };
const MARK_WORD = { full: 'complete', part: 'partial', none: 'not recorded' };

// ---------- shared renderers ----------
const posTag = (pos) => `<span class="pos ${esc(pos)}">${esc(pos)}</span>`;
const keeperTag = (x) => (x.keeper ? ' <span class="tag gold" title="Keeper: price is the keeper cost, not a market price">K</span>' : '');
const refLabel = (y) => (SEASON.get(y)?.plat === 'Sleeper' ? 'Est. $' : 'ESPN avg $');
const refTitle = (y) => (SEASON.get(y)?.plat === 'Sleeper' ? 'Estimate in the Sleeper export (budget split by value over replacement), not a Sleeper number' : "ESPN's average auction value that year");
const ptsNote = (x) => (x.ptsKind === 'rostered' ? '*' : x.ptsKind === 'to-date' ? '†' : '');

function pickRow(x, cols, onPlayer) {
  const c = {
    year: `<td class="l n">${x.y}</td>`,
    pick: `<td class="n muted">${x.overall}</td>`,
    player: `<td class="l stick"><span class="row" style="gap:.5rem;flex-wrap:nowrap">${posTag(x.pos)}<button type="button" class="link trunc" data-player="${x.p}" style="max-width:13rem">${esc(x.name)}</button>${keeperTag(x)}</span></td>`,
    owner: `<td class="l"><button type="button" class="link" data-owner="${esc(x.o)}" data-year="${x.y}">${esc(crew(x.o, x.y))}</button></td>`,
    price: `<td class="n b">${money(x.price)}</td>`,
    share: `<td class="n muted">${pct(x.share)}</td>`,
    ref: `<td class="n muted">${x.ref == null ? '<span title="Not recorded">–</span>' : money(Math.round(x.ref))}</td>`,
    vsref: `<td class="n ${tone(x.ref == null ? null : -(x.price - x.ref), 2)}">${x.ref == null ? '–' : signed(Math.round(x.price - x.ref), '$')}</td>`,
    pts: `<td class="n">${x.pts == null ? '<span class="muted" title="Not recorded">–</span>' : fmt(x.pts) + `<span class="muted">${ptsNote(x)}</span>`}</td>`,
    worth: `<td class="n muted">${money(x.worth)}</td>`,
    value: `<td class="n b ${tone(x.value, 2)}">${x.value == null ? '–' : signed(x.value, '$')}</td>`,
  };
  return `<tr>${cols.map((k) => c[k]).join('')}</tr>`;
}
const HEAD = {
  year: '<th class="l">Year</th>', pick: '<th title="Overall nomination order">#</th>', player: '<th class="l stick">Player</th>', owner: '<th class="l">Owner</th>',
  price: '<th>Paid</th>', share: '<th title="Share of the $200 budget">% budget</th>', ref: (y) => `<th title="${esc(refTitle(y))}">${refLabel(y)}</th>`, vsref: '<th title="Paid minus the price reference; negative = paid under">vs ref</th>',
  pts: '<th title="Season points in league scoring">Pts</th>', worth: '<th title="What his season was worth at that draft\'s going rate">Worth</th>', value: '<th title="Worth minus price paid">Value</th>',
};
function pickTable(rows, cols, opts = {}) {
  const y = opts.year ?? rows[0]?.y;
  return `<div class="scrollx"><table class="tbl" style="min-width:${opts.min ?? '44rem'}">
    ${opts.caption ? `<caption class="sr">${esc(opts.caption)}</caption>` : ''}
    <thead><tr>${cols.map((k) => (k === 'ref' ? HEAD.ref(y) : HEAD[k])).join('')}</tr></thead>
    <tbody>${rows.map((x) => pickRow(x, cols)).join('')}</tbody></table></div>`;
}
const VALUE_NOTE = 'Worth: a player\'s season points over a replacement at his position (QB and TE 12th, RB 30th, WR 36th), priced at what that draft paid per point. Value = worth minus price. Hindsight, not a projection. * Sleeper years: points while on a league roster. † 2026: season to date.';

// ---------- review chrome ----------
// Not part of the page design: lets a reviewer flip states, theme and width notes.
const STATE = { mode: 'live', theme: 'system' };
function chrome(label, onChange) {
  const el = document.createElement('div');
  el.className = 'chrome';
  const draw = () => {
    el.innerHTML = `<div class="in"><b>MOCKUP</b><span>${esc(label)}</span><span style="flex:1"></span>
      <span>State</span>${['live', 'loading', 'empty', 'partial'].map((m) => `<button type="button" data-mode="${m}" aria-pressed="${STATE.mode === m}">${m}</button>`).join('')}
      <span>Theme</span>${['system', 'light', 'dark'].map((t) => `<button type="button" data-theme="${t}" aria-pressed="${STATE.theme === t}">${t}</button>`).join('')}</div>`;
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mode) STATE.mode = b.dataset.mode;
    if (b.dataset.theme) { STATE.theme = b.dataset.theme; if (b.dataset.theme === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = b.dataset.theme; }
    draw(); onChange();
  });
  draw();
  return el;
}
function appbar() {
  return `<div class="appbar"><div class="in"><p class="disp lg">League</p><div class="tabs"><span>Standings</span><span class="on">History</span><span>Players</span><span>Teams</span></div></div></div>`;
}
// Tiny URL state: every view can be shared as a link.
const urlState = {
  get() { return Object.fromEntries(new URLSearchParams(location.hash.slice(1))); },
  set(patch) { const q = new URLSearchParams(location.hash.slice(1)); for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') q.delete(k); else q.set(k, v); } history.replaceState(null, '', `#${q}`); },
};
