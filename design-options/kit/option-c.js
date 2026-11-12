// Option C: Search Desk. Search first across every draft: type a player or owner, narrow with
// filters, open a player for every year he was drafted. Filtering runs in a Web Worker.
'use strict';
const C = { q: '', from: 2010, to: 2026, owner: '', pos: 'ANY', keeper: 'any', min: '', max: '', sort: 'value', page: 0, player: null, preset: '' };
const PAGE = 25;
const PRESETS = [
  ['bargains', 'Best auction values', { sort: 'value', keeper: 'exclude', q: '', owner: '', pos: 'ANY' }],
  ['busts', 'Biggest busts', { sort: 'bust', keeper: 'exclude', q: '', owner: '', pos: 'ANY' }],
  ['keepers', 'Keepers only', { sort: 'value', keeper: 'only', q: '', owner: '', pos: 'ANY' }],
  ['mine', 'My picks (Nic)', { sort: 'year', keeper: 'any', q: '', owner: 'nicholas-ferrara', pos: 'ANY' }],
];

// ---------- worker: the index lives off the main thread ----------
const workerSrc = `
let rows = [];
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'load') { rows = m.rows; postMessage({ type: 'ready', n: rows.length }); return; }
  const f = m.f, q = f.q.trim().toLowerCase();
  const t0 = performance.now();
  let out = rows.filter((r) => r.y >= f.from && r.y <= f.to
    && (!f.owner || r.o === f.owner) && (f.pos === 'ANY' || r.pos === f.pos)
    && (f.keeper === 'any' || (f.keeper === 'only' ? r.k : !r.k))
    && (f.min === '' || r.price >= +f.min) && (f.max === '' || r.price <= +f.max)
    && (!q || r.text.includes(q)));
  const by = { value: (a, b) => (b.v ?? -1e9) - (a.v ?? -1e9), bust: (a, b) => (a.v ?? 1e9) - (b.v ?? 1e9), price: (a, b) => b.share - a.share, pts: (a, b) => (b.pts ?? -1) - (a.pts ?? -1), year: (a, b) => b.y - a.y || b.price - a.price }[f.sort];
  out.sort(by);
  const owners = {}; let spend = 0, val = 0, nv = 0;
  for (const r of out) { owners[r.o] = (owners[r.o] || 0) + 1; spend += r.share; if (r.v != null) { val += r.v; nv++; } }
  const players = new Set(out.map((r) => r.p));
  postMessage({ type: 'result', id: m.id, ids: out.map((r) => r.i), total: out.length, players: players.size, onlyPlayer: players.size === 1 ? out[0].p : null, topOwner: Object.entries(owners).sort((a, b) => b[1] - a[1])[0] || null, avgShare: out.length ? spend / out.length : null, avgValue: nv ? val / nv : null, ms: performance.now() - t0 });
};`;
const worker = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })));
let ready = false, seq = 0, result = null;
worker.onmessage = (e) => {
  if (e.data.type === 'ready') { ready = true; run(); return; }
  if (e.data.id !== seq) return; // an older answer: drop it
  result = e.data;
  if (result.onlyPlayer != null && C.q && !C.player) C.player = result.onlyPlayer;
  render();
};
// The index: one flat row per pick, with a lowercase search string (player, owner, team, NFL team).
worker.postMessage({ type: 'load', rows: PICKS.map((x) => ({ i: x.i, y: x.y, o: x.o, p: x.p, pos: x.pos, k: x.keeper, price: x.price, share: x.share, pts: x.pts, v: x.value, text: `${x.name} ${crew(x.o, x.y)} ${rowOf(x.o, x.y)?.team ?? ''} ${x.nfl ?? ''}`.toLowerCase() })) });
function run() { if (!ready) return; seq++; worker.postMessage({ type: 'query', id: seq, f: C }); }
let timer = 0;
const debounced = () => { clearTimeout(timer); timer = setTimeout(run, 200); };

// ---------- player page ----------
function playerPage(p) {
  const ps = (BY_PLAYER.get(p) ?? []).slice().sort((a, b) => a.y - b.y);
  const [nm, pos] = D.players[p];
  const maxShare = Math.max(...ps.map((x) => x.share), 0.01), maxWorth = Math.max(...ps.map((x) => (x.worth ?? 0) / BUDGET), 0.01);
  const top = Math.max(maxShare, maxWorth);
  const owners = [...new Set(ps.map((x) => crew(x.o, x.y)))];
  return `<section class="sec" aria-live="polite"><div class="head"><h2>${posTag(pos)} ${esc(nm)}</h2><span class="sm"><button type="button" class="link" data-close="1">Back to results</button></span></div>
    <p class="sm ink2 measure">Drafted in <span class="b">${ps.length}</span> of ${DRAFT_YEARS.length} drafts, by ${owners.length} different owner${owners.length > 1 ? 's' : ''}. Kept ${ps.filter((x) => x.keeper).length} time${ps.filter((x) => x.keeper).length === 1 ? '' : 's'}.</p>
    <div class="grid" style="gap:.25rem" role="img" aria-label="Price and worth by year, as a share of the budget; the table below has the numbers">
      <div class="row xs muted" style="gap:1rem"><span><span style="display:inline-block;width:.75rem;height:.5rem;background:var(--ink)"></span> Paid</span><span><span style="display:inline-block;width:.75rem;height:.5rem;background:var(--primary);opacity:.55"></span> Worth (hindsight)</span><span>share of the $200 budget</span></div>
      ${ps.map((x) => `<div style="display:grid;grid-template-columns:3rem minmax(0,1fr) 7.5rem;gap:.5rem;align-items:center" class="sm">
        <span class="num muted">${x.y}</span>
        <span style="display:grid;gap:2px"><span style="height:.5rem;background:var(--ink);width:${(x.share / top) * 100}%"></span><span style="height:.5rem;background:var(--primary);opacity:.55;width:${((x.worth ?? 0) / BUDGET / top) * 100}%"></span></span>
        <span class="num r">$${x.price} · <span class="${tone(x.value, 2)}">${x.value == null ? '–' : signed(x.value, '$')}</span></span></div>`).join('')}
    </div>
    ${pickTable(ps.slice().reverse(), ['year', 'owner', 'price', 'share', 'ref', 'pts', 'worth', 'value'], { min: '42rem', caption: `${nm} draft history` }).replace(/<th title="[^"]*">(ESPN avg \$|Est\. \$)<\/th>/, '<th title="ESPN average auction value; Sleeper years: the export\'s estimate">Price ref</th>')}
    <p class="note">Owner before and after: read down the Owner column. Weeks he started for each owner come from the lineups files (one more tap in the full build). ${VALUE_NOTE}</p></section>`;
}

// ---------- page ----------
const root = document.getElementById('app');
function results() {
  if (STATE.mode === 'loading' || !ready) return `<p class="loading" role="status">Building the search index in the background…</p>`;
  if (!result) return '';
  if (STATE.mode === 'empty' || !result.total) return `<p class="empty">No picks match “${esc(C.q || 'these filters')}”. <button type="button" class="link" data-reset="1">Clear filters</button></p>`;
  const rows = result.ids.slice(C.page * PAGE, C.page * PAGE + PAGE).map((i) => PICKS[i]);
  const pages = Math.ceil(result.total / PAGE);
  return `<div class="stats">
      <div class="stat"><span class="cap">Picks</span><span class="v num">${result.total.toLocaleString()}</span><span class="sm ink2">${result.players.toLocaleString()} players</span></div>
      <div class="stat"><span class="cap">Avg price</span><span class="v num">${pct(result.avgShare)}</span><span class="sm ink2">of the budget</span></div>
      <div class="stat"><span class="cap">Avg value</span><span class="v num ${tone(result.avgValue, 1)}">${result.avgValue == null ? '–' : signed(Math.round(result.avgValue), '$')}</span><span class="sm ink2">per pick, hindsight</span></div>
      <div class="stat"><span class="cap">Most by</span><span class="v">${result.topOwner ? esc(name(result.topOwner[0])) : '–'}</span><span class="sm ink2">${result.topOwner ? `${result.topOwner[1]} of these picks` : ''}</span></div>
    </div>
    ${pickTable(rows, ['player', 'year', 'owner', 'price', 'share', 'pts', 'worth', 'value'], { min: '46rem', caption: 'Search results' }).replace('<th class="l">Year</th>', '<th class="l">Year</th>')}
    <nav class="pager" aria-label="Result pages"><button type="button" class="btn btn-quiet" data-page="${C.page - 1}" ${C.page <= 0 ? 'disabled' : ''}>‹ Prev</button><span class="num">Page ${C.page + 1} of ${pages}</span><button type="button" class="btn btn-quiet" data-page="${C.page + 1}" ${C.page >= pages - 1 ? 'disabled' : ''}>Next ›</button><span class="xs muted">Filtered ${PICKS.length.toLocaleString()} picks in ${result.ms.toFixed(1)} ms off the main thread</span></nav>
    <p class="note">Price ref shown per pick: ESPN average auction value (ESPN years) or the export's estimate (Sleeper years, not a Sleeper number). ${VALUE_NOTE}</p>`;
}

function controls() {
  const owners = D.owners.filter((o) => !o.filler && PICKS.some((x) => x.o === o.k)).sort((a, b) => a.name.localeCompare(b.name));
  const yrSel = (id, v) => `<select class="field" id="${id}" style="width:auto">${DRAFT_YEARS.map((y) => `<option ${y === v ? 'selected' : ''}>${y}</option>`).join('')}</select>`;
  return `<div class="grid" style="gap:.75rem">
    <label class="grid" style="gap:.25rem"><span class="sm b">Search every draft</span><input id="q" class="field" type="search" autocomplete="off" placeholder="Player, owner or team name, e.g. Kelce" value="${esc(C.q)}" aria-describedby="qhelp"></label>
    <p id="qhelp" class="xs muted">Results update as you type (200 ms pause). Every filter is in the link, so a view can go straight to the group chat.</p>
    <div class="row"><span class="cap">Views</span>${PRESETS.map(([k, l]) => `<button type="button" class="btn ${C.preset === k ? 'btn-primary' : ''}" data-preset="${k}">${l}</button>`).join('')}</div>
    <details class="fold" style="border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)" open><summary><span class="sm b">Filters</span><span class="xs muted">${[C.owner && name(C.owner), C.pos !== 'ANY' && C.pos, C.keeper !== 'any' && (C.keeper === 'only' ? 'keepers only' : 'no keepers'), (C.from !== 2010 || C.to !== 2026) && `${C.from}–${C.to}`, (C.min || C.max) && `$${C.min || 1}–$${C.max || 200}`].filter(Boolean).join(' · ') || 'none'}</span></summary>
      <div class="grid" style="gap:.75rem;padding-bottom:.75rem;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr))">
        <div class="grid" style="gap:.25rem"><span class="xs muted">Seasons</span><span class="row" style="gap:.5rem;flex-wrap:nowrap">${yrSel('from', C.from)}<span>to</span>${yrSel('to', C.to)}</span></div>
        <label class="grid" style="gap:.25rem"><span class="xs muted">Owner</span><select id="owner" class="field"><option value="">Anyone</option>${owners.map((o) => `<option value="${o.k}" ${C.owner === o.k ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
        <div class="grid" style="gap:.25rem"><span class="xs muted">Position</span><div class="seg" role="group" aria-label="Position" style="max-width:100%;overflow-x:auto">${['ANY', 'QB', 'RB', 'WR', 'TE', 'K', 'D/ST'].map((p) => `<button type="button" data-pos="${p}" aria-pressed="${C.pos === p}">${p === 'ANY' ? 'Any' : p}</button>`).join('')}</div></div>
        <div class="grid" style="gap:.25rem"><span class="xs muted">Keepers</span><div class="seg" role="group" aria-label="Keepers">${[['any', 'Include'], ['exclude', 'Leave out'], ['only', 'Only']].map(([k, l]) => `<button type="button" data-keeper="${k}" aria-pressed="${C.keeper === k}">${l}</button>`).join('')}</div></div>
        <div class="grid" style="gap:.25rem"><span class="xs muted">Price paid ($)</span><span class="row" style="gap:.5rem;flex-wrap:nowrap"><input id="min" class="field num" inputmode="numeric" placeholder="1" value="${esc(C.min)}" style="width:5rem" aria-label="Minimum price"><span>to</span><input id="max" class="field num" inputmode="numeric" placeholder="200" value="${esc(C.max)}" style="width:5rem" aria-label="Maximum price"></span></div>
        <label class="grid" style="gap:.25rem"><span class="xs muted">Sort</span><select id="sort" class="field">${[['value', 'Best value'], ['bust', 'Worst value'], ['price', 'Price (share of budget)'], ['pts', 'Season points'], ['year', 'Newest first']].map(([k, l]) => `<option value="${k}" ${C.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div></details></div>`;
}

function render() {
  const focus = document.activeElement?.id, caret = document.activeElement?.selectionStart;
  root.innerHTML = `${appbar()}<main class="wrap grid" style="gap:1.5rem;padding-top:1.5rem">
    <div class="grid" style="gap:.5rem"><p class="headline-sm">Search the draft archive</p><p class="ink2 measure">${PICKS.length.toLocaleString()} auction picks from ${DRAFT_YEARS.length} drafts, 2010 to 2026. Season drawers, owner pages and box scores stay where they are; this desk sits in the All seasons drawer as a Search tab.</p></div>
    ${controls()}
    ${STATE.mode === 'partial' ? `<div class="partial"><span class="b">Some years are partial.</span> ${[2010, 2017, 2019, 2024].map((y) => `${y}: ${coverage(y).filter((c) => c.k !== 'full' && c.label !== 'Your model' && c.detail).map((c) => `${c.label.toLowerCase()} ${c.detail.charAt(0).toLowerCase() + c.detail.slice(1)}`).join('; ')}.`).join(' ')}</div>` : ''}
    ${C.player != null && STATE.mode === 'live' ? playerPage(C.player) : results()}
  </main>`;
  if (focus) { const el = document.getElementById(focus); if (el) { el.focus(); if (caret != null && el.setSelectionRange) el.setSelectionRange(caret, caret); } }
}
function changed(fast) { C.page = 0; C.player = null; urlState.set({ q: C.q, from: C.from !== 2010 ? C.from : null, to: C.to !== 2026 ? C.to : null, owner: C.owner, pos: C.pos !== 'ANY' ? C.pos : null, keeper: C.keeper !== 'any' ? C.keeper : null, min: C.min, max: C.max, sort: C.sort }); if (fast) run(); else debounced(); }
document.body.prepend(chrome('Option C · Search Desk', () => { if (STATE.mode === 'partial') { C.preset = ''; } render(); }));
root.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'q') { C.q = t.value; C.preset = ''; changed(false); }
  else if (t.id === 'min' || t.id === 'max') { C[t.id] = t.value.replace(/\D/g, ''); changed(false); }
});
root.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'from' || t.id === 'to') C[t.id] = Number(t.value);
  else if (t.id === 'owner' || t.id === 'sort') C[t.id] = t.value;
  else return;
  C.preset = ''; changed(true);
});
root.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.pos) { C.pos = b.dataset.pos; C.preset = ''; changed(true); }
  else if (b.dataset.keeper) { C.keeper = b.dataset.keeper; C.preset = ''; changed(true); }
  else if (b.dataset.preset) { const p = PRESETS.find((x) => x[0] === b.dataset.preset); Object.assign(C, p[2]); C.preset = p[0]; changed(true); }
  else if (b.dataset.page) { C.page = Number(b.dataset.page); render(); }
  else if (b.dataset.player) { C.player = Number(b.dataset.player); render(); window.scrollTo({ top: 0 }); }
  else if (b.dataset.owner) { C.owner = b.dataset.owner; C.preset = ''; changed(true); }
  else if (b.dataset.close) { C.player = null; render(); }
  else if (b.dataset.reset) { Object.assign(C, { q: '', from: 2010, to: 2026, owner: '', pos: 'ANY', keeper: 'any', min: '', max: '', sort: 'value', preset: '' }); STATE.mode = 'live'; changed(true); }
});
// Start on a question people ask: every Travis Kelce pick (an exact match opens his page).
C.q = 'travis kelce';
render();
