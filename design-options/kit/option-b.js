// Option B: Owner by Season Grid. Overview first: owners down, seasons across, one metric at a time.
// Click a cell for that owner's season and draft; click a year for the season.
'use strict';
const B = { metric: 'finish', who: 'current', cell: { o: 'nicholas-ferrara', y: 2025 }, year: null };

const METRICS = [
  ['finish', 'Finish', 'Results'], ['win', 'Win %', 'Results'], ['index', 'Pts vs avg', 'Results'], ['luck', 'Luck', 'Results'],
  ['rb', 'RB budget', 'Draft'], ['keepers', 'Keepers', 'Draft'], ['value', 'Draft value', 'Draft'], ['top', 'Top pick', 'Draft'],
];
const DEF = {
  finish: 'Final place. Green top 3, red bottom 3; the number is always written.',
  win: 'Regular-season win share.',
  index: "Points per game against that season's league average.",
  luck: 'Wins minus expected wins (all-play).',
  rb: 'Share of the $200 budget spent on running backs at the draft.',
  keepers: 'Keepers flagged at the draft. Not comparable in 2010 (none flagged) and 2024 (Sleeper flag incomplete).',
  value: "Total hindsight draft value: each pick's season worth minus its price. 2026 is season to date.",
  top: 'The priciest pick and his share of the budget.',
};

// Seats: a co-owner's row shows his team's season (2022 on, Nick Heisterkamp with Tommy Teves).
const SEAT = (o, y) => { const s = SEASON.get(y); if (!s) return null; if (s.rows.some((r) => r.o === o)) return o; if (o === 'nick-heisterkamp' && y >= 2022) return 'tommy-teves'; return null; };

function cellData(o, y) {
  const seat = SEAT(o, y); if (!seat) return null;
  const r = rowOf(seat, y); const s = SEASON.get(y);
  const ps = (BY_YEAR.get(y) ?? []).filter((x) => x.o === seat);
  const spend = ps.reduce((a, x) => a + x.price, 0);
  const n = s.rows.length;
  switch (B.metric) {
    case 'finish': return s.live ? { text: '…', title: 'In progress', k: 0 } : { text: String(r.finish), title: place(r.finish), k: r.finish <= 3 ? 1 : r.finish > n - 3 ? -1 : 0, bold: r.finish === 1 };
    case 'win': { const p = (r.w + r.t / 2) / Math.max(1, r.w + r.l + r.t); return { text: p.toFixed(3).replace(/^0/, ''), title: `${r.w}-${r.l}`, k: p >= 0.6 ? 1 : p <= 0.4 ? -1 : 0 }; }
    case 'index': { const v = Math.round((r.index - 1) * 100); return { text: `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}`, title: `${signed(v)}% vs league average`, k: v >= 8 ? 1 : v <= -8 ? -1 : 0 }; }
    case 'luck': return { text: signed(Number(r.luck.toFixed(1))), title: `${signed(r.luck.toFixed(1) * 1)} wins vs expected`, k: r.luck >= 1 ? 1 : r.luck <= -1 ? -1 : 0 };
    case 'rb': if (!ps.length) return { none: true }; { const v = ps.filter((x) => x.pos === 'RB').reduce((a, x) => a + x.price, 0) / Math.max(1, spend); return { text: pct(v), title: `$${ps.filter((x) => x.pos === 'RB').reduce((a, x) => a + x.price, 0)} of $${spend} on RBs`, k: 0 }; }
    case 'keepers': if (!ps.length) return { none: true }; { const k = ps.filter((x) => x.keeper).length; return { text: String(k), title: `${k} keepers`, k: 0, partial: y === 2010 || y === 2024 }; }
    case 'value': if (!ps.length) return { none: true }; { const v = ps.reduce((a, x) => a + (x.value ?? 0), 0); return { text: `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}`, title: `${signed(v, '$')} hindsight value`, k: v >= 40 ? 1 : v <= -40 ? -1 : 0, partial: y === LIVE || SEASON.get(y).plat === 'Sleeper' }; }
    case 'top': if (!ps.length) return { none: true }; { const t = ps.slice().sort((a, b) => b.price - a.price)[0]; return { text: t.name.split(' ').slice(-1)[0], title: `${t.name}, $${t.price} (${pct(t.share)})`, k: 0, small: true }; }
  }
}

function owners() {
  const cur = SEASON.get(LIVE).rows.map((r) => r.o);
  if (B.who === 'current') return [...cur, 'nick-heisterkamp'].filter((o, i, a) => a.indexOf(o) === i);
  const seasons = (o) => YEARS.filter((y) => SEAT(o, y)).length;
  return D.owners.filter((o) => !o.filler).map((o) => o.k).sort((a, b) => seasons(b) - seasons(a));
}

function grid() {
  if (STATE.mode === 'loading') return `<p class="loading" role="status">Loading the season summary (about 15 KB)…</p>`;
  const list = STATE.mode === 'empty' ? [] : owners();
  if (!list.length) return `<p class="empty">No owners match. Switch to Everyone.</p>`;
  const cov = (y) => coverage(y);
  const covRow = (label, idx) => `<tr class="cov"><td class="l stick xs muted">${label}</td>${YEARS.map((y) => { const c = cov(y)[idx]; return `<td class="mark xs ${c.k === 'none' ? 'muted' : c.k === 'part' ? 'gold' : ''}" title="${y} ${esc(c.label)}: ${MARK_WORD[c.k]}. ${esc(c.detail)}">${MARK[c.k]}<span class="sr">${MARK_WORD[c.k]}</span></td>`; }).join('')}</tr>`;
  const metricIsDraft = METRICS.find((m) => m[0] === B.metric)[2] === 'Draft';
  return `<div class="scrollx" style="max-height:none"><table class="tbl" style="min-width:${YEARS.length * 3.1 + 10}rem" aria-describedby="mdef">
    <caption class="sr">${esc(METRICS.find((m) => m[0] === B.metric)[1])} by owner and season</caption>
    <thead><tr><th class="l stick">Owner</th>${YEARS.map((y) => `<th style="text-align:center;padding:0"><button type="button" class="link num" data-year="${y}" style="min-height:2.75rem;padding:0 .4rem" aria-label="Open ${y}">${String(y).slice(2)}${SEASON.get(y).plat === 'Sleeper' ? '<span class="xs muted">s</span>' : ''}</button></th>`).join('')}</tr></thead>
    <tbody>
    ${covRow('Lineups', 1)}${metricIsDraft ? covRow('Keepers', 3) + covRow('Season pts', 6) : ''}
    ${list.map((o) => `<tr><th scope="row" class="l stick" style="font-size:var(--text-sm);color:var(--ink);font-weight:500;text-align:left;position:sticky">${esc(name(o))}</th>${YEARS.map((y) => {
      const c = cellData(o, y);
      if (!c) return '<td class="n muted" style="text-align:center" title="Not in the league">·</td>';
      if (c.none) return `<td class="n muted" style="text-align:center" title="${y}: not recorded">–</td>`;
      const on = B.cell && B.cell.o === o && B.cell.y === y;
      const bg = c.k ? `background:color-mix(in oklab, var(--${c.k > 0 ? 'gain' : 'loss'}) 16%, transparent);` : '';
      return `<td style="padding:0;${bg}${on ? 'outline:2px solid var(--ink);outline-offset:-2px;' : ''}"><button type="button" data-cell="${o}|${y}" title="${esc(name(o))} ${y}: ${esc(c.title)}" style="width:100%;min-height:2.5rem;padding:0 .3rem;text-align:center" class="num ${c.small ? 'xs' : 'sm'} ${c.bold ? 'b' : ''} ${c.k > 0 ? 'gain' : c.k < 0 ? 'loss' : ''}">${esc(c.text)}${c.partial ? '<span class="gold" aria-label="partial data">½</span>' : ''}</button></td>`;
    }).join('')}</tr>`).join('')}
    </tbody></table></div>`;
}

function detail() {
  if (B.year) return yearDetail(B.year);
  const { o, y } = B.cell ?? {};
  if (!o) return '';
  const seat = SEAT(o, y); const r = seat && rowOf(seat, y); const s = SEASON.get(y);
  if (!r) return `<p class="empty">${esc(name(o))} was not in the league in ${y}.</p>`;
  const ps = (BY_YEAR.get(y) ?? []).filter((x) => x.o === seat).sort((a, b) => b.price - a.price);
  const scored = ps.filter((x) => x.value != null && !x.keeper);
  const best = scored.slice().sort((a, b) => b.value - a.value)[0], worst = scored.slice().sort((a, b) => a.value - b.value)[0];
  const gaps = coverage(y).filter((c) => c.k !== 'full' && c.label !== 'Your model');
  return `<section class="sec" aria-live="polite"><div class="head"><h2>${esc(crew(seat, y))} · ${y}</h2><span class="sm"><button type="button" class="link" data-year="${y}">Open ${y}</button> · <button type="button" class="link">Owner page</button></span></div>
    <div class="stats">
      <div class="stat"><span class="cap">Finish</span><span class="v">${s.live ? 'In progress' : place(r.finish)}</span><span class="sm ink2">${esc(r.team)}</span></div>
      <div class="stat"><span class="cap">Record</span><span class="v num">${r.w}-${r.l}${r.t ? '-' + r.t : ''}</span><span class="sm ink2">${signed(Math.round((r.index - 1) * 100))}% pts vs avg · luck ${signed(r.luck.toFixed(1) * 1)}</span></div>
      <div class="stat"><span class="cap">Draft</span><span class="v num">${ps.length ? '$' + ps.reduce((a, x) => a + x.price, 0) : '–'}</span><span class="sm ink2">${ps.length ? `${ps.filter((x) => x.keeper).length} keepers · ${signed(ps.reduce((a, x) => a + (x.value ?? 0), 0), '$')} value` : 'No draft recorded'}</span></div>
      <div class="stat"><span class="cap">Best · worst pick</span><span class="v" style="font-size:var(--text-base)">${best ? `${esc(best.name)} <span class="gain num">${signed(best.value, '$')}</span>` : '–'}</span><span class="sm ink2">${worst ? `${esc(worst.name)} <span class="loss num">${signed(worst.value, '$')}</span>` : ''}</span></div>
    </div>
    ${gaps.length ? `<div class="partial"><span class="b">Partial data for ${y}.</span> ${gaps.map((c) => `${esc(c.label)}: ${esc(c.detail)}.`).join(' ')}</div>` : ''}
    ${ps.length ? pickTable(ps, ['player', 'price', 'share', 'ref', 'pts', 'worth', 'value'], { year: y, min: '38rem', caption: `${crew(seat, y)} ${y} draft` }) : ''}
    <p class="note">${VALUE_NOTE}</p></section>`;
}

function yearDetail(y) {
  const s = SEASON.get(y);
  const ps = BY_YEAR.get(y) ?? [];
  const teams = s.rows.map((r) => { const mine = ps.filter((x) => x.o === r.o); return { r, spend: mine.reduce((a, x) => a + x.price, 0), value: mine.length ? mine.reduce((a, x) => a + (x.value ?? 0), 0) : null, top: mine.slice().sort((a, b) => b.price - a.price)[0] }; });
  return `<section class="sec"><div class="head"><h2>${y} season</h2><span class="sm"><button type="button" class="link" data-close="1">Back to the cell</button></span></div>
  <div class="scrollx"><table class="tbl" style="min-width:40rem"><thead><tr><th class="l">${s.live ? 'Now' : 'Final'}</th><th class="l stick">Team</th><th>W-L</th><th>Spent</th><th class="l">Top pick</th><th>Draft value</th></tr></thead><tbody>
  ${teams.map((t, i) => `<tr><td class="l n">${s.live ? i + 1 : t.r.finish}</td><td class="l stick">${esc(t.r.crew)}</td><td class="n">${t.r.w}-${t.r.l}</td><td class="n">${t.spend ? '$' + t.spend : '–'}</td><td class="l">${t.top ? `${posTag(t.top.pos)} ${esc(t.top.name)} <span class="num muted">$${t.top.price}</span>` : '–'}</td><td class="n ${tone(t.value, 5)}">${t.value == null ? '–' : signed(t.value, '$')}</td></tr>`).join('')}
  </tbody></table></div></section>`;
}

const root = document.getElementById('app');
function render() {
  if (STATE.mode === 'partial') { B.metric = 'keepers'; B.cell = { o: 'ty-carlson', y: 2024 }; B.year = null; }
  const groups = ['Results', 'Draft'];
  root.innerHTML = `${appbar()}<main class="wrap grid" style="gap:1.5rem;padding-top:1.5rem">
    <div class="grid" style="gap:.5rem"><p class="headline-sm">${D.seasons.length} seasons at a glance</p><p class="ink2 measure">Owners down, seasons across. Pick what to compare, then tap a square for that owner's season and draft, or a year for the whole season.</p></div>
    <div class="grid" style="gap:.75rem">
      ${groups.map((g) => `<div class="row"><span class="cap" style="width:4.5rem">${g}</span><div class="seg" role="group" aria-label="${g} metric" style="max-width:100%;overflow-x:auto">${METRICS.filter((m) => m[2] === g).map(([k, l]) => `<button type="button" data-metric="${k}" aria-pressed="${B.metric === k}">${l}</button>`).join('')}</div></div>`).join('')}
      <div class="row between"><p id="mdef" class="sm ink2 measure">${esc(DEF[B.metric])}</p><div class="seg" role="group" aria-label="Owners shown"><button type="button" data-who="current" aria-pressed="${B.who === 'current'}">Current owners</button><button type="button" data-who="all" aria-pressed="${B.who === 'all'}">Everyone</button></div></div>
    </div>
    ${grid()}
    <p class="note">● complete · ½ partial · – not recorded · · not in the league. "s" marks Sleeper seasons. Tints back up the written number and are never the only cue. Nick Heisterkamp's row shows Tommy's team from 2022 (co-owners).</p>
    ${STATE.mode === 'loading' || STATE.mode === 'empty' ? '' : detail()}
    <section class="sec"><div class="head"><h2>Still one tap away</h2></div><p class="sm ink2 measure">Season drawers with week-by-week box scores, owner pages and the all-time records keep their current pages; the grid links into them.</p></section>
  </main>`;
}
document.body.prepend(chrome('Option B · Owner by Season Grid', render));
root.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.metric) B.metric = b.dataset.metric;
  else if (b.dataset.who) B.who = b.dataset.who;
  else if (b.dataset.cell) { const [o, y] = b.dataset.cell.split('|'); B.cell = { o, y: Number(y) }; B.year = null; }
  else if (b.dataset.year) B.year = Number(b.dataset.year);
  else if (b.dataset.close) B.year = null;
  else return;
  urlState.set({ metric: B.metric, who: B.who, cell: B.cell ? `${B.cell.o}.${B.cell.y}` : null, year: B.year });
  render();
});
render();
