// Shared player history: one column per season (clickable), one metric at a time, the owner
// written under each run of seasons, and everything known about the chosen season below.
'use strict';
const PV = { metric: 'value', year: null };

function posRank(x) {
  if (x.pts == null) return null;
  const same = (BY_YEAR.get(x.y) ?? []).filter((q) => q.pos === x.pos && q.pts != null);
  return 1 + same.filter((q) => q.pts > x.pts).length;
}
const short = (k, y) => { const n = crew(k, y); return n.includes('&') ? n.split(' & ').map((s) => s.split(' ')[0]).join(' & ') : n; };
const projLabel = (x) => (x.projKind === 'espn' ? 'ESPN preseason' : x.projKind === 'sleeper' ? 'Sleeper, pulled after the season' : null);

function playerHistory(p, opts = {}) {
  const ps = (BY_PLAYER.get(p) ?? []).slice().sort((a, b) => a.y - b.y);
  if (!ps.length) return '<p class="empty">This player was never drafted in the league.</p>';
  const [nm, pos] = D.players[p];
  const first = ps[0].y, last = ps.at(-1).y;
  const years = DRAFT_YEARS.filter((y) => y >= first && y <= last);
  const byYear = new Map(ps.map((x) => [x.y, x]));
  const sel = byYear.get(PV.year) ?? byYear.get(opts.year) ?? ps.filter((x) => x.y !== LIVE).at(-1) ?? ps.at(-1);
  const owners = new Set(ps.map((x) => x.o));
  const totalPaid = ps.reduce((a, x) => a + x.price, 0), totalValue = ps.reduce((a, x) => a + (x.value ?? 0), 0);

  // Bars: one metric, its number always written on the column.
  const m = PV.metric;
  const val = (x) => (m === 'value' ? x.value : m === 'paid' ? x.price : x.pts);
  const max = Math.max(1, ...ps.map((x) => Math.abs(val(x) ?? 0)), ...(m === 'points' ? ps.map((x) => x.proj ?? 0) : []));
  const H = 8; // rem of bar area
  const col = (y) => {
    const x = byYear.get(y);
    const on = x && x === sel;
    if (!x) return `<div class="pv-col" style="opacity:.6"><div class="pv-bars" style="height:${H}rem"><span class="xs muted pv-none">not drafted</span></div><span class="pv-yr num xs muted">'${String(y).slice(2)}</span></div>`;
    const v = val(x);
    let bar = '';
    if (v == null) bar = `<span class="xs muted pv-none">–</span>`;
    else if (m === 'value') {
      const h = (Math.abs(v) / max) * (H / 2 - 1.1);
      bar = `<span class="pv-zero"></span><span class="pv-bar ${v >= 0 ? 'up' : 'down'}" style="height:${h}rem;${v >= 0 ? `bottom:${H / 2}rem` : `top:${H / 2}rem`}"></span><span class="pv-lab num ${tone(v, 2)}" style="${v >= 0 ? `bottom:${H / 2 + h}rem` : `top:${H / 2 + h}rem`}">${signed(v, '$')}</span>`;
    } else {
      const h = (v / max) * (H - 1.25);
      const tick = m === 'points' && x.proj != null ? `<span class="pv-tick ${x.projKind}" style="bottom:${(x.proj / max) * (H - 1.25)}rem" title="Projected ${fmt(x.proj)} (${projLabel(x)})"></span>` : '';
      bar = `<span class="pv-bar flat" style="height:${h}rem;bottom:0"></span>${tick}<span class="pv-lab num" style="bottom:${h}rem">${m === 'paid' ? '$' + v : fmt(v)}</span>`;
    }
    return `<button type="button" class="pv-col ${on ? 'on' : ''}" data-pvyear="${y}" aria-pressed="${!!on}" aria-label="${y}: ${esc(crew(x.o, y))}, paid $${x.price}, ${x.pts == null ? 'points not recorded' : fmt(x.pts) + ' points'}, value ${x.value == null ? 'not known' : signed(x.value, '$')}">
      <div class="pv-bars" style="height:${H}rem">${bar}</div><span class="pv-yr num xs">'${String(y).slice(2)}${x.keeper ? '<span class="gold"> K</span>' : ''}</span></button>`;
  };
  // Owner band: one label per run of seasons with the same drafting owner.
  const runs = [];
  years.forEach((y, i) => { const o = byYear.get(y)?.o ?? null; const r = runs.at(-1); if (r && r.o === o) r.n++; else runs.push({ o, y, start: i, n: 1 }); });
  const band = runs.map((r) => `<span class="pv-run ${r.o ? '' : 'gap'}" style="grid-column:${r.start + 1} / span ${r.n}" title="${r.o ? esc(crew(r.o, r.y)) : ''}">${r.o ? esc(short(r.o, r.y)) : ''}</span>`).join('');

  const legend = m === 'value' ? 'Value: what his season was worth minus what was paid. Above the line = a bargain.' : m === 'paid' ? 'Auction price paid (keepers: the keeper price, marked K).' : 'Season points. The tick is the projection where one exists: solid = ESPN preseason, dashed = Sleeper, pulled after the season.';
  return `<div class="grid" style="gap:1rem">
    <div class="row between"><h2 class="lg disp" style="display:flex;gap:.5rem;align-items:center">${posTag(pos)} ${esc(nm)}</h2>${opts.back ? `<button type="button" class="link sm" data-close="1">${esc(opts.back)}</button>` : ''}</div>
    <div class="stats">
      <div class="stat"><span class="cap">Drafted</span><span class="v num">${ps.length}×</span><span class="sm ink2">${first} to ${last}, by ${owners.size} owner${owners.size > 1 ? 's' : ''}</span></div>
      <div class="stat"><span class="cap">Kept</span><span class="v num">${ps.filter((x) => x.keeper).length}×</span><span class="sm ink2">keeper price counts as paid</span></div>
      <div class="stat"><span class="cap">Total paid</span><span class="v num">$${totalPaid}</span><span class="sm ink2">avg ${pct(totalPaid / ps.length / BUDGET)} of a budget</span></div>
      <div class="stat"><span class="cap">Total value</span><span class="v num ${tone(totalValue, 2)}">${signed(totalValue, '$')}</span><span class="sm ink2">hindsight, all seasons</span></div>
    </div>
    <div class="row between"><div class="seg" role="group" aria-label="Chart shows">${[['value', 'Value'], ['paid', 'Paid'], ['points', 'Points']].map(([k, l]) => `<button type="button" data-pvmetric="${k}" aria-pressed="${m === k}">${l}</button>`).join('')}</div><span class="xs muted">Tap a season for the details</span></div>
    <div class="scrollx"><div style="min-width:${Math.max(18, years.length * 4.75)}rem">
      <div class="pv-grid" style="grid-template-columns:repeat(${years.length},minmax(0,1fr))">${years.map(col).join('')}</div>
      <div class="pv-grid pv-band" style="grid-template-columns:repeat(${years.length},minmax(0,1fr))" aria-label="Drafted by">${band}</div>
    </div></div>
    <p class="note">${legend} The row under the years names who drafted him; a new name means he changed hands.</p>
    ${seasonCard(sel)}
  </div>`;
}

const dl = (label, value, note) => `<div><dt>${label}${note ? `<span class="xs muted" style="display:block">${note}</span>` : ''}</dt><dd class="num">${value ?? '<span class="muted">–</span>'}</dd></div>`;
function seasonCard(x) {
  const r = rowOf(x.o, x.y);
  const b = D.basis[x.y];
  const rank = posRank(x);
  const replPts = b?.repl[x.pos];
  const over = x.pts == null || replPts == null ? null : Math.round(x.pts - replPts);
  const moves = x.held == null ? (x.y === LIVE ? 'This season is in progress; weekly use shows on the Teams page.' : 'Weekly lineups not recorded.')
    : !x.held.length ? 'Never in a starting lineup or on a bench in the lineup files (dropped or injured early).'
    : x.held.map((h, i) => `${i ? 'then ' : ''}<span class="b">${esc(crew(h.o, x.y))}</span> from week ${h.from}: started ${h.started}${x.ptsKind === 'season' && x.y >= 2018 || SEASON.get(x.y)?.plat === 'Sleeper' ? `, benched ${h.benched}` : ''}${h.startPts ? ` (${fmt(h.startPts)} pts as a starter)` : ''}`).join('; ') + '.';
  const ps = BY_PLAYER.get(x.p).slice().sort((a, b) => a.y - b.y);
  const i = ps.indexOf(x);
  return `<section class="sec" aria-live="polite"><div class="head"><h2>${x.y}${x.keeper ? ' <span class="tag gold">Keeper</span>' : ''}</h2>
    <span class="row sm" style="gap:.75rem">${i > 0 ? `<button type="button" class="link" data-pvyear="${ps[i - 1].y}">‹ ${ps[i - 1].y}</button>` : ''}${i < ps.length - 1 ? `<button type="button" class="link" data-pvyear="${ps[i + 1].y}">${ps[i + 1].y} ›</button>` : ''}</span></div>
    <p class="sm ink2 measure">Drafted by <span class="b">${esc(crew(x.o, x.y))}</span>${r?.team ? ` (${esc(r.team)})` : ''}${r?.finish ? `, who finished ${place(r.finish)}` : SEASON.get(x.y)?.live ? ', season in progress' : ''}. ${moves}</p>
    <dl class="pv-dl">
      ${dl('Paid', `$${x.price}`, `${pct(x.share)} of the $200 budget${x.keeper ? ', keeper price' : ''}`)}
      ${dl('Price reference', x.ref == null ? null : `$${Math.round(x.ref)}`, x.ref == null ? 'Not recorded this year' : x.refKind === 'aav' ? 'ESPN average auction value' : 'Export estimate, not a Sleeper number')}
      ${dl('Projected points', x.proj == null ? null : fmt(x.proj), x.proj == null ? (x.y < 2018 ? 'ESPN projections start in 2018' : 'Not recorded for this player') : projLabel(x))}
      ${dl('Season points', x.pts == null ? null : fmt(x.pts), [rank && `${x.pos}${rank} among drafted ${x.pos}s`, x.ptsKind === 'rostered' && 'weeks on a league roster only', x.ptsKind === 'to-date' && 'season to date'].filter(Boolean).join(', '))}
      ${dl('Worth', money(x.worth), "what his season was worth at that draft's prices")}
      ${dl('Value', x.value == null ? null : `<span class="b ${tone(x.value, 2)}">${signed(x.value, '$')}</span>`, 'worth minus paid')}
    </dl>
    ${x.worth != null && b ? `<details class="fold" style="border-top:1px solid var(--rule)"><summary><span class="sm">How the value was worked out</span><span class="xs muted">${x.y} draft</span></summary>
      <ol class="sm ink2 measure" style="margin:0 0 .75rem;padding-left:1.25rem;display:grid;gap:.25rem">
        <li>Replacement level: the ${{ QB: '12th', TE: '12th', K: '12th', 'D/ST': '12th', RB: '30th', WR: '36th' }[x.pos]}-best drafted ${x.pos} in ${x.y} scored <span class="num">${fmt(replPts)}</span>.</li>
        <li>${esc(D.players[x.p][0])} scored <span class="num">${fmt(x.pts)}</span>, so <span class="num">${over > 0 ? over : 0}</span> points over replacement${over <= 0 ? ' (none, so he was worth the $1 minimum)' : ''}.</li>
        <li>That draft paid <span class="num">$${b.rate.toFixed(2)}</span> per point over replacement (every non-keeper's dollars above $1, divided by their points over replacement).</li>
        <li>Worth = $1 + ${over > 0 ? over : 0} × $${b.rate.toFixed(2)} = <span class="num b">$${x.worth}</span>. Value = worth − paid = <span class="num b ${tone(x.value, 2)}">${signed(x.value, '$')}</span>.</li>
      </ol></details>` : ''}
  </section>`;
}

// Events: chart metric and season, shared by every page that shows a player.
document.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.pvmetric) { PV.metric = b.dataset.pvmetric; window.__pvRender?.(); }
  else if (b.dataset.pvyear) { PV.year = Number(b.dataset.pvyear); window.__pvRender?.(); }
});
