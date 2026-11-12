// v2 Search Desk: one search box, four quick questions, and the filter written out as one sentence
// so it is always clear what is being shown. Tap a player for his history.
'use strict';
const S = { q: '', pos: 'any', owner: '', seasons: 'all', keepers: 'out', sort: 'best', page: 0, player: null, quick: 'best' };
const PAGE = 25;
const QUICK = [
  ['best', 'Best bargains ever', { pos: 'any', owner: '', seasons: 'all', keepers: 'out', sort: 'best' }],
  ['worst', 'Biggest busts ever', { pos: 'any', owner: '', seasons: 'all', keepers: 'out', sort: 'worst' }],
  ['keepers', 'Keepers that paid off', { pos: 'any', owner: '', seasons: 'all', keepers: 'only', sort: 'best' }],
  ['mine', 'My drafts (Nic)', { pos: 'any', owner: 'nicholas-ferrara', seasons: 'all', keepers: 'in', sort: 'newest' }],
];
const SEASONS = [['all', 'every season'], ['last5', 'the last 5 seasons'], ['2018on', '2018 on (full data)'], ...DRAFT_YEARS.slice().reverse().map((y) => [String(y), String(y)])];
const POS = [['any', 'every position'], ['QB', 'quarterbacks'], ['RB', 'running backs'], ['WR', 'receivers'], ['TE', 'tight ends'], ['K', 'kickers'], ['D/ST', 'defenses']];
const KEEP = [['out', 'leaving out keepers'], ['in', 'including keepers'], ['only', 'keepers only']];
const SORT = [['best', 'best value first'], ['worst', 'worst value first'], ['price', 'priciest first'], ['points', 'most points first'], ['newest', 'newest first']];

function inSeasons(y) {
  if (S.seasons === 'all') return true;
  if (S.seasons === 'last5') return y > DRAFT_YEARS.at(-1) - 5;
  if (S.seasons === '2018on') return y >= 2018;
  return y === Number(S.seasons);
}
// shortcut: filters run on the main thread; 3,000 picks filter in well under a millisecond. Revisit
// (move to a worker) only if search grows to the weekly lineups, about 37,000 player-weeks.
function query() {
  const q = S.q.trim().toLowerCase();
  const rows = PICKS.filter((x) => inSeasons(x.y) && (S.pos === 'any' || x.pos === S.pos) && (!S.owner || x.o === S.owner)
    && (S.keepers === 'in' || (S.keepers === 'only' ? x.keeper : !x.keeper)) && (!q || x.name.toLowerCase().includes(q)));
  const by = { best: (a, b) => (b.value ?? -1e9) - (a.value ?? -1e9), worst: (a, b) => (a.value ?? 1e9) - (b.value ?? 1e9), price: (a, b) => b.share - a.share || b.y - a.y, points: (a, b) => (b.pts ?? -1) - (a.pts ?? -1), newest: (a, b) => b.y - a.y || b.price - a.price }[S.sort];
  return rows.sort(by);
}

const sel = (id, value, opts) => `<select id="${id}" aria-label="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

function results() {
  if (STATE.mode === 'loading') return '<p class="loading" role="status">Loading the draft archive (one 30 KB file)…</p>';
  const rows = STATE.mode === 'empty' ? [] : query();
  const players = new Set(rows.map((x) => x.p));
  if (!rows.length) return `<p class="empty">No picks match${S.q ? ` “${esc(S.q)}”` : ''} with these settings. <button type="button" class="link" data-reset="1">Start over</button></p>`;
  const one = S.q && players.size === 1 ? rows[0] : null;
  const page = rows.slice(S.page * PAGE, S.page * PAGE + PAGE);
  const pages = Math.ceil(rows.length / PAGE);
  return `<p class="sm ink2" aria-live="polite"><span class="b num">${rows.length.toLocaleString()}</span> of ${PICKS.length.toLocaleString()} picks · ${players.size.toLocaleString()} player${players.size === 1 ? '' : 's'}</p>
    ${one ? `<button type="button" class="btn btn-primary" data-player="${one.p}">Open ${esc(one.name)}'s draft history ›</button>` : ''}
    <div class="scrollx"><table class="tbl" style="min-width:40rem"><caption class="sr">Matching picks</caption>
      <thead><tr><th class="l stick">Player</th><th class="l">Year</th><th class="l">Drafted by</th><th>Paid</th><th title="Projected season points where recorded: ESPN preseason (2018 on) or Sleeper (pulled after the season, marked ‡)">Proj</th><th>Pts</th><th title="Worth minus price paid">Value</th></tr></thead>
      <tbody>${page.map((x) => `<tr>
        <td class="l stick"><span class="row" style="gap:.5rem;flex-wrap:nowrap">${posTag(x.pos)}<button type="button" class="link trunc" style="max-width:12rem" data-player="${x.p}">${esc(x.name)}</button>${keeperTag(x)}</span></td>
        <td class="l n">${x.y}</td><td class="l">${esc(crew(x.o, x.y))}</td><td class="n b">$${x.price}</td>
        <td class="n muted">${x.proj == null ? '–' : fmt(x.proj) + (x.projKind === 'sleeper' ? '‡' : '')}</td>
        <td class="n">${x.pts == null ? '<span class="muted">–</span>' : fmt(x.pts) + `<span class="muted">${ptsNote(x)}</span>`}</td>
        <td class="n b ${tone(x.value, 2)}">${x.value == null ? '–' : signed(x.value, '$')}</td></tr>`).join('')}</tbody></table></div>
    <nav class="pager" aria-label="Result pages"><button type="button" class="btn btn-quiet" data-page="${S.page - 1}" ${S.page <= 0 ? 'disabled' : ''}>‹ Prev</button><span class="num">Page ${S.page + 1} of ${pages}</span><button type="button" class="btn btn-quiet" data-page="${S.page + 1}" ${S.page >= pages - 1 ? 'disabled' : ''}>Next ›</button></nav>
    <p class="note">Value = what the season was worth minus what was paid (open any player and season for the working). Proj: ESPN preseason points (2018 on, few in 2023); ‡ Sleeper, pulled after the season. * Sleeper years: points while on a league roster. † 2026: season to date. – means not recorded.</p>`;
}

const root = document.getElementById('app');
function render() {
  const focus = document.activeElement?.id, caret = document.activeElement?.selectionStart;
  const owners = D.owners.filter((o) => !o.filler && PICKS.some((x) => x.o === o.k)).sort((a, b) => a.name.localeCompare(b.name));
  if (S.player != null && STATE.mode === 'live') {
    root.innerHTML = `${appbar()}<main class="wrap grid" style="gap:1.5rem;padding-top:1.5rem">${playerHistory(S.player, { back: '‹ Back to results' })}</main>`;
    return;
  }
  root.innerHTML = `${appbar()}<main class="wrap grid" style="gap:1.25rem;padding-top:1.5rem">
    <div class="grid" style="gap:.5rem"><p class="headline-sm">Draft archive</p><p class="ink2 measure">Every auction pick since 2010. Search a player, or start from a question.</p></div>
    <label class="grid" style="gap:.25rem"><span class="sm b">Find a player</span><input id="q" class="field" type="search" autocomplete="off" placeholder="Player name, e.g. Kelce" value="${esc(S.q)}"></label>
    <div class="grid" style="gap:.5rem"><span class="cap">Quick questions</span><div class="row" style="gap:.5rem">${QUICK.map(([k, l]) => `<button type="button" class="btn ${S.quick === k ? 'btn-primary' : ''}" aria-pressed="${S.quick === k}" data-quick="${k}">${l}</button>`).join('')}</div></div>
    <p class="sentence" id="filters">Showing ${sel('pos', S.pos, POS)} drafted by ${sel('owner', S.owner, [['', 'anyone'], ...owners.map((o) => [o.k, o.name])])} in ${sel('seasons', S.seasons, SEASONS)}, ${sel('keepers', S.keepers, KEEP)}, ${sel('sort', S.sort, SORT)}. <button type="button" class="link sm" data-reset="1">Reset</button></p>
    ${results()}
  </main>`;
  if (focus) { const el = document.getElementById(focus); if (el) { el.focus(); if (caret != null && el.setSelectionRange) el.setSelectionRange(caret, caret); } }
}
window.__pvRender = render;
document.body.prepend(chrome('v2 · Search Desk (simplified)', render));
let t = 0;
root.addEventListener('input', (e) => { if (e.target.id === 'q') { S.q = e.target.value; S.page = 0; clearTimeout(t); t = setTimeout(render, 200); } });
root.addEventListener('change', (e) => { const id = e.target.id; if (['pos', 'owner', 'seasons', 'keepers', 'sort'].includes(id)) { S[id] = e.target.value; S.quick = ''; S.page = 0; render(); } });
root.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.quick) { const q = QUICK.find((x) => x[0] === b.dataset.quick); Object.assign(S, q[2], { quick: q[0], page: 0 }); }
  else if (b.dataset.page) S.page = Number(b.dataset.page);
  else if (b.dataset.player) { S.player = Number(b.dataset.player); PV.year = null; window.scrollTo({ top: 0 }); }
  else if (b.dataset.close) S.player = null;
  else if (b.dataset.reset) { Object.assign(S, { q: '', pos: 'any', owner: '', seasons: 'all', keepers: 'out', sort: 'best', page: 0, quick: 'best' }); STATE.mode = 'live'; }
  else return;
  urlState.set({ q: S.q, pos: S.pos !== 'any' ? S.pos : null, owner: S.owner, seasons: S.seasons !== 'all' ? S.seasons : null, keepers: S.keepers !== 'out' ? S.keepers : null, sort: S.sort !== 'best' ? S.sort : null, player: S.player });
  render();
});
render();
