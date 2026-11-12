// v2 Team Season: Option B without the grid. Pick a season, pick a team, see its season and its
// drafted roster. Tap a player for his history (the same view the Search Desk uses), in a sheet.
'use strict';
const T = { y: 2025, o: 'nicholas-ferrara', player: null };

function teamPanel(y, o) {
  const s = SEASON.get(y); const r = rowOf(o, y);
  if (!r) return '<p class="empty">Pick a team.</p>';
  if (STATE.mode === 'loading') return `<p class="loading" role="status">Loading the ${y} draft…</p>`;
  const ps = STATE.mode === 'empty' ? [] : (BY_YEAR.get(y) ?? []).filter((x) => x.o === o).sort((a, b) => b.price - a.price);
  const open = ps.filter((x) => x.value != null && !x.keeper);
  const best = open.slice().sort((a, b) => b.value - a.value)[0], worst = open.slice().sort((a, b) => a.value - b.value)[0];
  const gaps = coverage(y).filter((c) => c.k !== 'full' && c.label !== 'Your model' && c.detail);
  const hasProj = ps.some((x) => x.proj != null);
  const usage = (x) => {
    if (!x.held) return '<span class="muted">–</span>';
    const mine = x.held.find((h) => h.o === o);
    const later = x.held.filter((h) => h.o !== o && h.from > (mine?.from ?? 0));
    return `${mine ? mine.started : 0}${later.length ? ` <span class="xs muted">→ ${esc(short(later[0].o, y))} wk ${later[0].from}</span>` : !mine ? ' <span class="xs muted">never rostered</span>' : ''}`;
  };
  return `<section class="sec"><div class="head"><h2>${esc(crew(o, y))} · ${y}</h2><span class="sm muted">${esc(r.team)}</span></div>
    <div class="stats">
      <div class="stat"><span class="cap">Finish</span><span class="v">${s.live ? 'In progress' : place(r.finish)}</span><span class="sm ink2">${r.w}-${r.l}${r.t ? '-' + r.t : ''} · ${signed(Math.round((r.index - 1) * 100))}% pts vs avg</span></div>
      <div class="stat"><span class="cap">Luck</span><span class="v num ${tone(r.luck, 0.5)}">${signed(r.luck.toFixed(1) * 1)}</span><span class="sm ink2">wins vs what the scores earned</span></div>
      <div class="stat"><span class="cap">Draft</span><span class="v num">${ps.length ? '$' + ps.reduce((a, x) => a + x.price, 0) : '–'}</span><span class="sm ink2">${ps.length ? `${ps.length} players · ${ps.filter((x) => x.keeper).length} keepers · <span class="${tone(ps.reduce((a, x) => a + (x.value ?? 0), 0), 2)}">${signed(ps.reduce((a, x) => a + (x.value ?? 0), 0), '$')}</span> value` : 'No draft recorded'}</span></div>
      <div class="stat"><span class="cap">Best · worst buy</span><span class="sm" style="padding-top:.25rem">${best ? `${esc(best.name)} <span class="num gain">${signed(best.value, '$')}</span>` : '–'}</span><span class="sm">${worst ? `${esc(worst.name)} <span class="num loss">${signed(worst.value, '$')}</span>` : ''}</span></div>
    </div>
    ${gaps.length ? `<div class="partial"><span class="b">Partial data for ${y}.</span> ${gaps.map((c) => `${esc(c.label)}: ${esc(c.detail)}.`).join(' ')}</div>` : ''}
    ${!ps.length ? `<p class="empty">No draft recorded for ${esc(crew(o, y))} in ${y}.</p>` : `<div class="scrollx"><table class="tbl" style="min-width:44rem"><caption class="sr">${esc(crew(o, y))} ${y} draft</caption>
      <thead><tr><th class="l stick">Player</th><th>Paid</th><th title="${esc(refTitle(y))}">${refLabel(y)}</th>${hasProj ? `<th title="${s.plat === 'Sleeper' ? 'Sleeper projection, pulled after the season' : 'ESPN preseason projection'}">Proj</th>` : ''}<th>Pts</th><th title="Worth minus price paid">Value</th><th title="Weeks this team started him; an arrow shows where he went">Starts</th></tr></thead>
      <tbody>${ps.map((x) => `<tr>
        <td class="l stick"><span class="row" style="gap:.5rem;flex-wrap:nowrap">${posTag(x.pos)}<button type="button" class="link trunc" style="max-width:12rem" data-player="${x.p}">${esc(x.name)}</button>${keeperTag(x)}</span></td>
        <td class="n b">$${x.price}</td><td class="n muted">${x.ref == null ? '–' : '$' + Math.round(x.ref)}</td>
        ${hasProj ? `<td class="n muted">${x.proj == null ? '–' : fmt(x.proj)}</td>` : ''}
        <td class="n">${x.pts == null ? '<span class="muted">–</span>' : fmt(x.pts) + `<span class="muted">${ptsNote(x)}</span>`}</td>
        <td class="n b ${tone(x.value, 2)}">${x.value == null ? '–' : signed(x.value, '$')}</td>
        <td class="n">${usage(x)}</td></tr>`).join('')}</tbody></table></div>`}
    <p class="note">Drafted roster only; in-season pickups are in the week-by-week box scores. ${hasProj ? '' : `No projections recorded for ${y}. `}Value = what the season was worth minus what was paid; tap a player for the working. ${s.plat === 'Sleeper' ? '* Points while on a league roster.' : ''}</p>
  </section>`;
}

const root = document.getElementById('app');
const sheet = document.createElement('dialog');
sheet.className = 'sheet';
sheet.style.maxWidth = '56rem';
document.body.appendChild(sheet);
function drawSheet() {
  if (T.player == null) { if (sheet.open) sheet.close(); return; }
  sheet.innerHTML = `<div style="max-height:88dvh;overflow-y:auto"><header class="row between" style="position:sticky;top:0;background:var(--surface);border-bottom:1px solid var(--rule);padding:.75rem 1.25rem;z-index:2"><span class="sm muted">Player history</span><button type="button" class="btn btn-quiet" data-closesheet="1">Close</button></header><div style="padding:1.25rem">${playerHistory(T.player, { year: T.y })}</div></div>`;
  if (!sheet.open) sheet.showModal();
}
sheet.addEventListener('close', () => { T.player = null; });
sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('[data-closesheet]')) sheet.close(); });

function render() {
  if (STATE.mode === 'partial') { T.y = 2024; T.o = 'ty-carlson'; }
  const s = SEASON.get(T.y);
  if (!rowOf(T.o, T.y)) T.o = s.rows[0].o;
  root.innerHTML = `${appbar()}<main class="wrap grid" style="gap:1.5rem;padding-top:1.5rem">
    <div class="grid" style="gap:.5rem"><p class="headline-sm">Every team, every season</p><p class="ink2 measure">Pick a season, then a team, for its record, its draft and every player it bought.</p></div>
    <div class="grid" style="gap:.5rem"><span class="cap" id="ylab">Season</span><div class="years" role="group" aria-labelledby="ylab">${YEARS.slice().reverse().map((y) => `<button type="button" data-y="${y}" aria-pressed="${y === T.y}">${y}</button>`).join('')}</div></div>
    <div class="split">
      <div class="grid" style="gap:.5rem"><span class="cap" id="olab">${T.y} teams${s.live ? ' · standings now' : ' · final order'}</span>
        <div class="pick-list" role="group" aria-labelledby="olab">${s.rows.map((r, i) => `<button type="button" data-o="${r.o}" aria-pressed="${r.o === T.o}"><span class="num b">${s.live ? i + 1 : r.finish === 1 ? '🏆' : r.finish}</span><span class="grid" style="gap:0;min-width:0"><span class="trunc">${esc(r.crew)}</span><span class="xs muted trunc">${esc(r.team)}</span></span><span class="num sm">${r.w}-${r.l}</span></button>`).join('')}</div></div>
      ${teamPanel(T.y, T.o)}
    </div></main>`;
  drawSheet();
}
window.__pvRender = render;
document.body.prepend(chrome('v2 · Team Season (Option B without the grid)', render));
document.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.y) { T.y = Number(b.dataset.y); }
  else if (b.dataset.o) { T.o = b.dataset.o; }
  else if (b.dataset.player) { T.player = Number(b.dataset.player); PV.year = T.y; }
  else return;
  urlState.set({ y: T.y, o: T.o, player: T.player });
  render();
});
render();
