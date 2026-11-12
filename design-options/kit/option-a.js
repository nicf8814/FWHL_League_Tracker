// Option A: Ledger Archive. Keeps the drawer-per-season page; adds a Draft view in each season and
// an all-time Drafts tab in the All seasons drawer.
'use strict';
const A = {
  open: new Set(['all', 2025]), allTab: 'drafts', preset: 'best', page: 0,
  view: { 2025: 'draft' }, group: {}, round: {}, vpage: {},
};
const PAGE = 25;

function teamSeasons(y) {
  const ps = BY_YEAR.get(y) ?? [];
  const s = SEASON.get(y);
  const owners = s ? s.rows.map((r) => r.o) : [...new Set(ps.map((x) => x.o))];
  return owners.map((o) => {
    const mine = ps.filter((x) => x.o === o);
    const r = rowOf(o, y);
    return { o, r, picks: mine.sort((a, b) => b.price - a.price), spent: mine.reduce((a, x) => a + x.price, 0), keepers: mine.filter((x) => x.keeper).length, value: mine.some((x) => x.value != null) ? mine.reduce((a, x) => a + (x.value ?? 0), 0) : null };
  });
}

function pager(id, page, total) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return `<nav class="pager" aria-label="Pages"><button type="button" class="btn btn-quiet" data-page="${id}:${page - 1}" ${page <= 0 ? 'disabled' : ''}>‹ Prev</button>
    <span class="num">Page ${page + 1} of ${pages}</span><span class="muted">(${total} picks)</span>
    <button type="button" class="btn btn-quiet" data-page="${id}:${page + 1}" ${page >= pages - 1 ? 'disabled' : ''}>Next ›</button></nav>`;
}

function seg(attr, value, options, label) {
  return `<div class="seg" role="group" aria-label="${esc(label)}" style="max-width:100%;overflow-x:auto">${options.map(([v, l]) => `<button type="button" ${attr}="${v}" aria-pressed="${String(v) === String(value)}">${esc(l)}</button>`).join('')}</div>`;
}

// ---------- one season ----------
function seasonLine(s) {
  if (s.live) { const lead = s.rows[0]; return `In progress · ${esc(lead.crew)} leads at ${lead.w}-${lead.l} · draft ${BY_YEAR.has(s.y) ? 'recorded' : 'not recorded'}`; }
  const c = s.rows.find((r) => r.o === s.podium[0]);
  return `<span class="b" style="color:var(--ink)">🏆 ${esc(c?.crew)}</span> <span class="muted">· ${esc(c?.team)}</span>`;
}

function standings(s) {
  return `<div class="scrollx"><table class="tbl" style="min-width:36rem"><thead><tr><th class="l">${s.live ? 'Now' : 'Final'}</th><th class="l stick">Team</th><th>W-L</th><th>PF</th><th>Pts vs avg</th><th>Luck</th></tr></thead><tbody>
  ${s.rows.map((r, i) => `<tr><td class="l n">${s.live ? i + 1 : r.finish === 1 ? '🏆' : r.finish}</td><td class="l stick">${esc(r.crew)}<br><span class="xs muted">${esc(r.team)}</span></td><td class="n">${r.w}-${r.l}</td><td class="n">${fmt(r.pf, 1)}</td><td class="n">${signed(Math.round((r.index - 1) * 100))}%</td><td class="n ${tone(r.luck, 0.5)}">${signed(fmt(r.luck, 1) * 1)}</td></tr>`).join('')}
  </tbody></table></div><p class="note">Unchanged from the live page.</p>`;
}

function partialNotes(y) {
  const gaps = coverage(y).filter((c) => c.k !== 'full' && c.label !== 'Your model' && c.detail);
  if (!gaps.length) return '';
  return `<div class="partial"><span class="b">Partial data for ${y}.</span> ${gaps.map((c) => `${esc(c.label)}: ${esc(c.detail)}.`).join(' ')}</div>`;
}

function draftView(s) {
  const y = s.y;
  if (STATE.mode === 'loading') return `<p class="loading" role="status">Loading the ${y} draft…</p>`;
  if (STATE.mode === 'empty' || !BY_YEAR.has(y)) return `<p class="empty">No draft recorded for ${y}. Picks arrive with the season's draft export (npm run data -- drafts).</p>`;
  const g = A.group[y] ?? 'team';
  const ts = teamSeasons(y);
  const cols = ['player', 'price', 'share', 'ref', 'vsref', 'pts', 'worth', 'value'];
  const head = `<div class="row between">${seg('data-group', g, [['team', 'By team'], ['round', 'By round'], ['value', 'Best value']], 'Group the draft')}<span class="xs muted">Source: ${s.plat === 'Sleeper' ? 'Sleeper draft export' : 'ESPN draft export'} · price ref: ${esc(refLabel(y))}</span></div>`;
  let body = '';
  if (g === 'team') {
    body = ts.map((t, i) => `<details class="fold" style="border-top:1px solid var(--rule)" ${i === 0 ? 'open' : ''}>
      <summary><span><span class="b">${esc(crew(t.o, y))}</span> <span class="muted sm">${esc(t.r?.team ?? '')}</span></span>
      <span class="num sm muted">${t.r?.finish ? place(t.r.finish) + ' · ' : ''}spent $${t.spent} · ${t.keepers} K · <span class="${tone(t.value, 2)}">${t.value == null ? '–' : signed(t.value, '$')}</span></span></summary>
      ${pickTable(t.picks, cols, { year: y, caption: `${crew(t.o, y)} ${y} draft` })}</details>`).join('');
  } else if (g === 'round') {
    const rounds = Math.max(...BY_YEAR.get(y).map((x) => x.round));
    const r = A.round[y] ?? 1;
    const rows = BY_YEAR.get(y).filter((x) => x.round === r).sort((a, b) => a.overall - b.overall);
    body = `<div class="row">${seg('data-round', r, Array.from({ length: rounds }, (_, i) => [i + 1, String(i + 1)]), 'Round')}<span class="xs muted">Nomination rounds (auction): 12 picks each</span></div>${pickTable(rows, ['pick', 'player', 'owner', 'price', 'ref', 'pts', 'value'], { year: y, min: '40rem' })}`;
  } else {
    const all = BY_YEAR.get(y).filter((x) => !x.keeper && x.value != null).sort((a, b) => b.value - a.value);
    const p = A.vpage[y] ?? 0;
    body = `${pickTable(all.slice(p * PAGE, p * PAGE + PAGE), ['player', 'owner', 'price', 'pts', 'worth', 'value'], { year: y, min: '38rem' })}${pager('v' + y, p, all.length)}<p class="note">Keepers left out: a keeper price is not a market price.</p>`;
  }
  return `${partialNotes(y)}${head}<div>${body}</div><p class="note">${VALUE_NOTE}</p>`;
}

function seasonBody(s) {
  const v = A.view[s.y] ?? 'standings';
  const tabs = seg(`data-view="${s.y}" data-v`, v, [['standings', 'Standings'], ['weeks', 'Week by week'], ['draft', 'Draft']], `${s.y} view`).replace(/data-view="\d+" data-v="(\w+)"/g, `data-view="${s.y}" data-v="$1"`);
  return `${tabs}${v === 'standings' ? standings(s) : v === 'weeks' ? '<p class="note">Week picker, scoreboard, box scores and player sheets: unchanged from the live page.</p>' : draftView(s)}`;
}

// ---------- all seasons: Drafts tab ----------
function covStrip() {
  const years = DRAFT_YEARS;
  const labels = coverage(years[0]).map((c) => c.label);
  return `<div class="scrollx"><table class="tbl cov" style="min-width:60rem"><caption class="sr">Data coverage by season</caption><thead><tr><th class="l stick">Recorded</th>${years.map((y) => `<th>${String(y).slice(2)}</th>`).join('')}</tr></thead><tbody>
  ${labels.map((l, i) => `<tr><td class="l stick sm">${esc(l)}</td>${years.map((y) => { const c = coverage(y)[i]; return `<td class="mark ${c.k === 'none' ? 'muted' : c.k === 'part' ? 'gold' : ''}" title="${y} ${esc(l)}: ${MARK_WORD[c.k]}. ${esc(c.detail)}">${MARK[c.k]}<span class="sr">${MARK_WORD[c.k]}</span></td>`; }).join('')}</tr>`).join('')}
  </tbody></table></div><p class="note">● complete · ½ partial · – not recorded. Hover or tap a mark for the detail. Years are 20xx.</p>`;
}

function presetRows() {
  const open = PICKS.filter((x) => x.value != null && x.y !== LIVE);
  switch (A.preset) {
    case 'best': return open.filter((x) => !x.keeper).sort((a, b) => b.value - a.value);
    case 'worst': return open.filter((x) => !x.keeper).sort((a, b) => a.value - b.value);
    case 'priciest': return PICKS.filter((x) => !x.keeper).sort((a, b) => b.share - a.share || b.y - a.y);
    case 'keepers': return open.filter((x) => x.keeper).sort((a, b) => b.value - a.value);
  }
}

function ownerStyles() {
  const cur = SEASON.get(LIVE).rows.map((r) => r.o);
  const rows = cur.map((o) => {
    const ps = PICKS.filter((x) => x.o === o);
    const years = [...new Set(ps.map((x) => x.y))];
    const spend = ps.reduce((a, x) => a + x.price, 0) || 1;
    const by = (pos) => ps.filter((x) => (pos === 'other' ? !['QB', 'RB', 'WR', 'TE'].includes(x.pos) : x.pos === pos)).reduce((a, x) => a + x.price, 0) / spend;
    const top3 = years.map((y) => ps.filter((x) => x.y === y).sort((a, b) => b.price - a.price).slice(0, 3).reduce((a, x) => a + x.price, 0) / BUDGET);
    const vals = years.filter((y) => y !== LIVE).map((y) => ps.filter((x) => x.y === y).reduce((a, x) => a + (x.value ?? 0), 0));
    return { o, years: years.length, mix: { QB: by('QB'), RB: by('RB'), WR: by('WR'), TE: by('TE'), other: by('other') }, top3: top3.reduce((a, b) => a + b, 0) / top3.length, keepers: ps.filter((x) => x.keeper).length / years.length, value: vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length) };
  }).sort((a, b) => b.top3 - a.top3);
  const bar = (m) => `<div class="stack" role="img" aria-label="Budget share: QB ${pct(m.QB)}, RB ${pct(m.RB)}, WR ${pct(m.WR)}, TE ${pct(m.TE)}, other ${pct(m.other)}">${['QB', 'RB', 'WR', 'TE'].map((p) => `<span class="pos ${p}" style="width:${m[p] * 100}%;border-radius:0">${m[p] > 0.12 ? p : ''}</span>`).join('')}<span style="width:${m.other * 100}%;background:var(--sunk)"></span></div>`;
  return `<div class="scrollx"><table class="tbl" style="min-width:48rem"><thead><tr><th class="l stick">Owner</th><th>Drafts</th><th class="l" style="width:16rem">Budget by position</th><th title="Share of the budget on the three priciest picks, average">Top 3 share</th><th>Keepers / yr</th><th title="Average total draft value per season (hindsight)">Value / yr</th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td class="l stick">${esc(name(r.o))}</td><td class="n">${r.years}</td><td class="l">${bar(r.mix)}</td><td class="n">${pct(r.top3)}</td><td class="n">${fmt(r.keepers, 1)}</td><td class="n ${tone(r.value, 5)}">${signed(Math.round(r.value), '$')}</td></tr>`).join('')}
  </tbody></table></div><p class="note">Sorted by top-3 share: high means stars and scrubs, low means balanced. Current owners, all their seasons (co-owned seasons count for the team). Bars show length and the label; the table carries the numbers.</p>`;
}

function draftVsFinish() {
  const rows = DRAFT_YEARS.filter((y) => y !== LIVE).map((y) => { const ts = teamSeasons(y).filter((t) => t.value != null).sort((a, b) => b.value - a.value); return { y, best: ts[0], worst: ts.at(-1) }; });
  const top3 = rows.filter((r) => (r.best.r?.finish ?? 99) <= 3).length;
  return `<p class="sm ink2 measure">The best draft (most hindsight value) finished in the top 3 in <span class="b">${top3} of ${rows.length}</span> seasons.</p>
  <div class="scrollx"><table class="tbl" style="min-width:38rem"><thead><tr><th class="l">Year</th><th class="l">Best draft</th><th>Value</th><th>Finish</th><th class="l">Worst draft</th><th>Value</th><th>Finish</th></tr></thead><tbody>
  ${rows.reverse().map((r) => `<tr><td class="l n">${r.y}</td><td class="l">${esc(crew(r.best.o, r.y))}</td><td class="n gain">${signed(r.best.value, '$')}</td><td class="n">${place(r.best.r?.finish)}</td><td class="l">${esc(crew(r.worst.o, r.y))}</td><td class="n ${tone(r.worst.value)}">${signed(r.worst.value, '$')}</td><td class="n">${place(r.worst.r?.finish)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function draftsTab() {
  if (STATE.mode === 'loading') return `<p class="loading" role="status">Loading the draft summary (one small index file)…</p>`;
  const rows = STATE.mode === 'empty' ? [] : presetRows();
  const label = { best: 'Best values', worst: 'Worst values', priciest: 'Priciest picks', keepers: 'Keepers that paid off' }[A.preset];
  return `<section class="sec"><div class="head"><h2>What we have</h2><span class="sm muted">${PICKS.length.toLocaleString()} picks · ${DRAFT_YEARS.length} drafts · ${D.players.length} players</span></div>${covStrip()}</section>
  <section class="sec"><div class="head"><h2>${label}</h2>${seg('data-preset', A.preset, [['best', 'Best values'], ['worst', 'Worst values'], ['priciest', 'Priciest'], ['keepers', 'Keepers that paid off']], 'Ranking')}</div>
    ${rows.length ? pickTable(rows.slice(A.page * PAGE, A.page * PAGE + PAGE), ['player', 'year', 'owner', 'price', 'share', 'pts', 'worth', 'value'], { min: '46rem', caption: label }) + pager('all', A.page, rows.length) : '<p class="empty">No picks match. Try another ranking.</p>'}
    <p class="note">${A.preset === 'keepers' ? 'Keepers only: worth against the keeper price.' : 'Keepers left out: a keeper price is not a market price.'} Price as a share of the $200 budget compares eras with 16, 15 and 13 rounds. Sources: ESPN draft export 2010 to 2023 and 2026, Sleeper draft export 2024 and 2025. ${VALUE_NOTE}</p></section>
  <section class="sec"><div class="head"><h2>How each owner drafts</h2></div>${ownerStyles()}</section>
  <section class="sec"><div class="head"><h2>Draft and finish</h2></div>${draftVsFinish()}</section>`;
}

function allBody() {
  const tabs = seg('data-alltab', A.allTab, [['champions', 'Champions'], ['owners', 'Owners'], ['luck', 'Luck'], ['rivals', 'Rivals'], ['records', 'Records'], ['drafts', 'Drafts']], 'All seasons section');
  return `${tabs}${A.allTab === 'drafts' ? draftsTab() : '<p class="note">Unchanged from the live page. The Drafts tab is the new part.</p>'}`;
}

// ---------- page ----------
const root = document.getElementById('app');
function render() {
  if (STATE.mode === 'partial') { A.open = new Set(['all', 2017, 2024]); A.view[2017] = 'draft'; A.view[2024] = 'draft'; }
  const seasons = D.seasons.slice().reverse();
  root.innerHTML = `${appbar()}<main class="wrap grid" style="gap:1.5rem;padding-top:1.5rem">
    <div class="grid" style="gap:.5rem"><p class="headline-sm">${D.seasons.length} seasons of Favre's Waffle House</p><p class="ink2 measure">Open a season for its standings, weeks and draft, or All seasons for titles, owners, luck, rivals, records and drafts.</p></div>
    <div class="drawers">
      <details class="drawer" data-d="all" ${A.open.has('all') ? 'open' : ''}><summary><span class="yr">All seasons<span class="xs muted" style="display:block;font-family:var(--font-sans);font-weight:400">2010–2026</span></span><span class="sm ink2" style="flex:1">Champions, owners, luck, rivals, records and drafts</span><span class="chev">›</span></summary><div class="body">${A.open.has('all') ? allBody() : ''}</div></details>
      ${seasons.map((s) => `<details class="drawer" data-d="${s.y}" ${A.open.has(s.y) ? 'open' : ''}><summary><span class="yr">${s.y}${s.plat === 'Sleeper' ? '<span class="xs muted" style="display:block;font-family:var(--font-sans);font-weight:400">Sleeper</span>' : ''}</span><span class="sm ink2 trunc" style="flex:1">${seasonLine(s)}</span><span class="chev">›</span></summary><div class="body">${A.open.has(s.y) ? seasonBody(s) : ''}</div></details>`).join('')}
    </div></main>`;
}
document.body.prepend(chrome('Option A · Ledger Archive', render));
root.addEventListener('toggle', (e) => {
  const d = e.target.closest?.('details.drawer'); if (!d) return;
  const k = d.dataset.d === 'all' ? 'all' : Number(d.dataset.d);
  const was = A.open.has(k);
  if (d.open === was) return;
  if (d.open) A.open.add(k); else A.open.delete(k);
  render();
}, true);
root.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.v) { A.view[b.dataset.view] = b.dataset.v; }
  else if (b.dataset.group) { const y = Number(b.closest('details.drawer').dataset.d); A.group[y] = b.dataset.group; }
  else if (b.dataset.round) { const y = Number(b.closest('details.drawer').dataset.d); A.round[y] = Number(b.dataset.round); }
  else if (b.dataset.preset) { A.preset = b.dataset.preset; A.page = 0; }
  else if (b.dataset.alltab) { A.allTab = b.dataset.alltab; }
  else if (b.dataset.page) { const [id, p] = b.dataset.page.split(':'); if (id === 'all') A.page = Number(p); else A.vpage[Number(id.slice(1))] = Number(p); }
  else return;
  urlState.set({ tab: A.allTab, preset: A.preset, page: A.page || null });
  render();
});
render();
