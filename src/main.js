import './style.css';
import {
  $, $$, esc, tagLabel, speciesWord, sexWord, hoursSince, ago, fmtDateTime, fmtDate,
  statusPill, temperPill, fedPill, cityOptions, temperOptions, statusOptions, initials,
  pawIcon, toast, friendlyError, safeHttps, STATUS, TEMPER, ORG_TYPES, ORG_SHORT,
} from './lib/util.js';
import { supabase, configured, photoUrl, projectContact, googleSignIn } from './lib/supabase.js';
import { preparePhoto } from './lib/photos.js';
import { drawTag, downloadTag, qrSvg, tagUrl } from './lib/tag.js';

const view = $('#view');
const topbar = $('#topbar');
const nav = $('#nav');

const state = {
  session: null,
  profile: null,
  animals: new Map(),
  orgs: new Map(),
  members: [],
  people: new Map(),
  loaded: false,
  loading: null,
  filter: { kind: 'all', city: '', q: '' },
  draftPhoto: null,
};

const isVol = () => ['volunteer', 'admin'].includes(state.profile?.role);
const isAdmin = () => state.profile?.role === 'admin';
const myOrgIds = () => state.members.filter((m) => m.user_id === state.session?.user.id).map((m) => m.org_id);
const personName = (id) => state.people.get(id)?.display_name || 'A volunteer';

/* ------------------------------------------------------------------ routing */
function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path);
  render();
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a || a.target || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin) return;
  e.preventDefault();
  if (u.pathname + u.search !== location.pathname + location.search) navigate(u.pathname + u.search);
});
window.addEventListener('popstate', render);

function currentRoute() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  let m;
  if ((m = path.match(/^\/a\/([A-Za-z0-9]{6})$/))) return { name: 'animal', id: m[1].toUpperCase() };
  if ((m = path.match(/^\/o\/([A-Za-z0-9]{6})$/))) return { name: 'org', id: m[1].toUpperCase() };
  const simple = { '/': 'home', '/feed': 'feed', '/report': 'report', '/shelters': 'shelters', '/tags': 'tags', '/admin': 'admin', '/signin': 'signin', '/account': 'account' };
  return { name: simple[path] || 'notfound' };
}

/* ------------------------------------------------------------------ chrome */
const ICONS = {
  animals: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="9" r="2"/><circle cx="9" cy="5" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="19" cy="9" r="2"/><path d="M8 17c0-3 2-5 4-5s4 2 4 5-2 3-4 3-4 0-4-3z"/></svg>',
  feed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18l-2 7H5z"/><path d="M8 12c0-3 2-5 4-5s4 2 4 5"/></svg>',
  add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  shelters: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/></svg>',
};
const LOGO = '<svg class="paw" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="11" fill="var(--brand)"/><g fill="var(--paper)"><ellipse cx="20" cy="25" rx="7.5" ry="6.2"/><ellipse cx="11.5" cy="17" rx="3" ry="3.8"/><ellipse cx="17" cy="11.5" rx="3" ry="3.8"/><ellipse cx="23" cy="11.5" rx="3" ry="3.8"/><ellipse cx="28.5" cy="17" rx="3" ry="3.8"/></g></svg>';

function renderChrome(route) {
  let right = '';
  if (!state.session) right = '<a class="btn sm" href="/signin">Sign in</a>';
  else right = `${isAdmin() ? '<a class="btn sm" href="/admin">Admin</a>' : ''}<a class="btn sm" href="/account" aria-label="Your account">${esc(initials(state.profile?.display_name || state.session.user.email))}</a>`;
  topbar.innerHTML = `<a class="brandlink" href="/">${LOGO}<div class="brand">Bantay Kalye<small>Metro Manila stray watch</small></div></a><div class="spacer"></div>${right}`;

  nav.hidden = !isVol();
  if (!isVol()) return;
  const tab = { home: 'home', animal: 'home', feed: 'feed', report: 'report', shelters: 'shelters', org: 'shelters', tags: 'home' }[route.name] || '';
  const link = (href, key, label, icon, extra = '') =>
    `<a href="${href}" ${tab === key ? 'aria-current="page"' : ''} ${extra}>${icon}${label}</a>`;
  nav.innerHTML = `<div class="nav-in">
    ${link('/', 'home', 'Animals', ICONS.animals)}
    ${link('/feed', 'feed', 'Feeding', ICONS.feed)}
    ${link('/report', 'report', 'Report', `<span class="dot">${ICONS.add}</span>`, 'class="add"')}
    ${link('/shelters', 'shelters', 'Shelters', ICONS.shelters)}
  </div>`;
}

/* ------------------------------------------------------------------ data */
async function loadProfile() {
  if (!state.session) { state.profile = null; return; }
  const { data } = await supabase.from('profiles').select('id, display_name, role').eq('id', state.session.user.id).maybeSingle();
  state.profile = data || { id: state.session.user.id, display_name: '', role: 'pending' };
}

async function loadAll() {
  if (!isVol()) return;
  if (state.loading) return state.loading;
  state.loading = (async () => {
    const [animals, orgs, members, people] = await Promise.all([
      supabase.from('animals').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('orgs').select('*').order('name'),
      supabase.from('org_members').select('org_id, user_id'),
      supabase.from('profiles').select('id, display_name, role'),
    ]);
    if (animals.error) throw animals.error;
    state.animals = new Map((animals.data || []).map((a) => [a.id, a]));
    state.orgs = new Map((orgs.data || []).map((o) => [o.id, o]));
    state.members = members.data || [];
    state.people = new Map((people.data || []).map((p) => [p.id, p]));
    state.loaded = true;
  })().finally(() => { state.loading = null; });
  return state.loading;
}

async function refresh() {
  try { await loadAll(); } catch { /* keep showing what we have */ }
  const r = currentRoute();
  const active = document.activeElement;
  if (active && /INPUT|TEXTAREA|SELECT/.test(active.tagName) && active.id !== 'fQ') return;
  if (r.name !== 'report') render();
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && isVol()) refresh(); });
setInterval(() => { if (document.visibilityState === 'visible' && isVol() && ['home', 'feed'].includes(currentRoute().name)) refresh(); }, 120000);

/* ------------------------------------------------------------------ shared bits */
function thumbHtml(a, cls = 'ph') {
  const src = photoUrl(a.thumb_path || a.photo_path);
  return src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy">` : `<div class="${cls}">${pawIcon(26)}</div>`;
}

function cardHtml(a) {
  const org = a.org_id && state.orgs.get(a.org_id);
  return `<a class="card" href="/a/${esc(a.id)}">${thumbHtml(a)}
    <div class="body"><div class="name">${esc(a.name || 'No name yet')}<span class="code">${tagLabel(a.id)}</span></div>
    <div class="meta">${speciesWord(a)} · ${esc(a.city || 'City not set')}${a.landmark ? ' · ' + esc(a.landmark) : ''}${org ? ' · ' + esc(org.name) : ''}</div>
    <div class="pills">${statusPill(a)}${temperPill(a)}${fedPill(a)}</div></div></a>`;
}

function temperCallout(a) {
  const t = TEMPER[a.temper];
  if (!t || !t.tip) return '';
  return `<div class="callout ${a.temper === 'avoid' ? 'bad' : a.temper === 'cautious' ? 'warn' : ''}"><b>${t.label}.</b> ${t.tip}</div>`;
}

function loadingView(msg = 'Loading…') {
  view.innerHTML = `<div class="empty"><strong>${esc(msg)}</strong></div>`;
}

async function copyText(text, fallbackEl) {
  try { await navigator.clipboard.writeText(text); toast('Link copied'); }
  catch {
    if (fallbackEl) { const r = document.createRange(); r.selectNodeContents(fallbackEl); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    toast('Link selected. Copy it from here.');
  }
}

/* ------------------------------------------------------------------ public pages */
async function renderPublicHome() {
  const pending = state.session && !isVol();
  view.innerHTML = `
    ${pending ? accountStatusCallout() : ''}
    <section class="hero">
      <h1>Every stray here has someone looking out for them.</h1>
      <p class="lede">Bantay Kalye volunteers feed and watch over dogs and cats on the streets of Metro Manila, and work with local shelters to find them homes. If you scanned a collar tag, you've met one of ours.</p>
      ${state.session ? '' : '<div class="row"><a class="btn primary" href="/signin">Volunteer sign in</a></div>'}
    </section>
    <section class="stack"><h2>Ready for adoption</h2><div id="adoptGrid" class="adopt-grid"><p class="note">Loading…</p></div></section>
    <section class="stack"><h2>Partner shelters and rescues</h2><div id="orgList" class="list"><p class="note">Loading…</p></div></section>`;
  const [animals, orgs] = await Promise.all([
    supabase.from('public_animals').select('*').eq('status', 'adopt').order('created_at', { ascending: false }).limit(60),
    supabase.from('public_orgs').select('*').order('name'),
  ]);
  const grid = $('#adoptGrid');
  if (grid) {
    const rows = animals.data || [];
    grid.innerHTML = rows.length ? rows.map((a) => `<a class="adopt-card" href="/a/${esc(a.id)}">${thumbHtml(a)}<b>${esc(a.name || 'No name yet')}</b><span class="note">${speciesWord(a)} · ${esc(a.city)}</span></a>`).join('')
      : '<div class="empty" style="grid-column:1/-1"><strong>No adoption posts right now</strong><span>Shelters post animals here when they are ready for a home.</span></div>';
  }
  const list = $('#orgList');
  if (list) {
    const rows = orgs.data || [];
    list.innerHTML = rows.length ? rows.map((o) => orgCardHtml(o)).join('') : '<p class="note">Shelters will appear here once they join.</p>';
  }
}

function orgCardHtml(o, extra = '') {
  return `<a class="orgcard" href="/o/${esc(o.id)}"><div class="mark">${esc(initials(o.name))}</div>
    <div class="body"><b>${esc(o.name)}</b><div class="note">${esc(ORG_SHORT[o.type] || 'Shelter')}${o.city ? ' · ' + esc(o.city) : ''}</div>${extra}</div></a>`;
}

async function renderPublicAnimal(id) {
  loadingView();
  const { data: a } = await supabase.from('public_animals').select('*').eq('id', id).maybeSingle();
  if (!a) {
    view.innerHTML = `<div class="empty"><strong>Tag ${esc(tagLabel(id))} not found</strong><span>This animal may have been removed. Thank you for checking on them.</span><a class="btn" href="/">About Bantay Kalye</a></div>`;
    return;
  }
  let org = null;
  if (a.org_id) ({ data: org } = await supabase.from('public_orgs').select('*').eq('id', a.org_id).maybeSingle());
  const photo = photoUrl(a.photo_path || a.thumb_path);
  document.title = `${a.name || tagLabel(a.id)} · Bantay Kalye`;
  view.innerHTML = `
    ${photo ? `<img class="hero-photo" src="${esc(photo)}" alt="Photo of ${esc(a.name || 'this animal')}">` : `<div class="hero-photo">${pawIcon(56)}</div>`}
    <div><div class="row"><h1>${esc(a.name || 'No name yet')}</h1><span class="code" style="font-size:13px">${tagLabel(a.id)}</span></div>
      <div class="pills" style="margin-top:8px">${statusPill(a)}${temperPill(a)}</div></div>
    ${temperCallout(a)}
    <dl class="facts">
      <div><dt>Species</dt><dd>${speciesWord(a)}${a.sex ? ' · ' + sexWord(a.sex) : ''}</dd></div>
      <div><dt>Markings</dt><dd>${esc(a.color || '—')}</dd></div>
      <div><dt>Area</dt><dd>${esc(a.city || 'Metro Manila')}</dd></div>
      <div><dt>Cared for by</dt><dd>${org ? `<a href="/o/${esc(org.id)}">${esc(org.name)}</a>` : 'Bantay Kalye volunteers'}</dd></div>
    </dl>
    ${a.bio ? `<p style="max-width:65ch">${esc(a.bio)}</p>` : ''}
    ${org && a.status === 'adopt' ? `<div class="panel"><h3>Want to adopt ${esc(a.name || 'this animal')}?</h3><p class="note">Contact ${esc(org.name)} and mention tag <b class="mono">${tagLabel(a.id)}</b>.</p><div class="mono" style="font-weight:700;user-select:all;overflow-wrap:anywhere">${esc(org.contact)}</div></div>` : ''}
    <div class="panel">
      <h3>You found one of our animals</h3>
      <p>Volunteers feed and check on ${esc(a.name || 'this animal')} regularly. Please leave the collar on.${a.temper === 'avoid' ? " Please don't try to touch or pick them up." : ''}</p>
      ${projectContact ? `<p class="note">If they look hurt or sick, message us: <b class="mono" style="user-select:all">${esc(projectContact)}</b></p>` : ''}
    </div>`;
}

async function renderPublicOrg(id) {
  loadingView();
  const [{ data: o }, { data: animals }] = await Promise.all([
    supabase.from('public_orgs').select('*').eq('id', id).maybeSingle(),
    supabase.from('public_animals').select('*').eq('org_id', id).order('created_at', { ascending: false }),
  ]);
  if (!o) { view.innerHTML = '<a class="back" href="/">‹ Home</a><div class="empty"><strong>Organization not found</strong></div>'; return; }
  const rows = (animals || []).filter((a) => a.status !== 'adopted');
  view.innerHTML = `<a class="back" href="/">‹ Home</a>
    ${orgHeaderHtml(o)}
    <h2>Their animals</h2>
    <div class="adopt-grid">${rows.length ? rows.map((a) => `<a class="adopt-card" href="/a/${esc(a.id)}">${thumbHtml(a)}<b>${esc(a.name || 'No name yet')}</b>${statusPill(a)}</a>`).join('') : '<p class="note">No animals posted yet.</p>'}</div>`;
}

function orgHeaderHtml(o, verifiedBadge = '') {
  return `<div class="row" style="flex-wrap:nowrap"><div class="orgcard" style="border:0;padding:0;background:none;min-width:0"><div class="mark" style="width:60px;height:60px;font-size:22px">${esc(initials(o.name))}</div>
      <div class="body"><h1>${esc(o.name)}</h1><div class="note">${esc(ORG_SHORT[o.type] || 'Shelter')}${o.city ? ' · ' + esc(o.city) : ''}</div>${verifiedBadge}</div></div></div>
    ${o.about ? `<p style="max-width:65ch">${esc(o.about)}</p>` : ''}
    ${o.contact ? `<div class="panel"><span class="label">Contact</span><div class="mono" style="font-weight:700;user-select:all;overflow-wrap:anywhere">${esc(o.contact)}</div></div>` : ''}`;
}

function accountStatusCallout() {
  if (state.profile?.role === 'blocked') return '<div class="callout bad"><b>Your account is paused.</b> Contact an organizer if you think this is a mistake.</div>';
  return `<div class="callout warn"><b>Thanks for signing up!</b> An organizer needs to approve your account before you can see locations and log feedings. You can set your name on the <a href="/account">account page</a> so they recognize you.</div>`;
}

/* ------------------------------------------------------------------ volunteer: animals */
function renderList() {
  const all = [...state.animals.values()];
  const f = state.filter;
  const rows = all.filter((a) => {
    if (f.kind === 'stray' && !['street', 'care'].includes(a.status)) return false;
    if (f.kind === 'care' && a.status !== 'care') return false;
    if (f.kind === 'adopt' && a.status !== 'adopt') return false;
    if (f.kind === 'friendly' && a.temper !== 'friendly') return false;
    if (f.city && a.city !== f.city) return false;
    if (f.q) {
      const q = f.q.toLowerCase();
      if (!`${a.name} ${a.id} ${a.landmark} ${a.color}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const chip = (k, l) => `<button class="chip" type="button" data-kind="${k}" aria-pressed="${f.kind === k}">${l}</button>`;
  view.innerHTML = `
    <div class="row between"><div><h1>Animals we look after</h1><p class="lede">${all.length} animal${all.length === 1 ? '' : 's'} across Metro Manila.</p></div>
      <a class="btn sm" href="/tags">Print collar tags</a></div>
    <div class="chips">${chip('all', 'All')}${chip('stray', 'Strays')}${chip('care', 'Needs vet')}${chip('friendly', 'Approachable')}${chip('adopt', 'For adoption')}</div>
    <div class="grid2">
      <label class="field"><span>City</span><select id="fCity">${cityOptions(f.city, 'All of Metro Manila')}</select></label>
      <label class="field"><span>Search</span><input type="search" id="fQ" placeholder="Name, tag code, landmark" value="${esc(f.q)}"></label>
    </div>
    <div class="list" id="animalList">${rows.length ? rows.map(cardHtml).join('') : emptyList(all.length)}</div>`;
  $$('.chip', view).forEach((b) => (b.onclick = () => { f.kind = b.dataset.kind; renderList(); }));
  $('#fCity').onchange = (e) => { f.city = e.target.value; renderList(); };
  const q = $('#fQ');
  q.oninput = () => {
    clearTimeout(q._t);
    q._t = setTimeout(() => { f.q = q.value; renderList(); const n = $('#fQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250);
  };
}

function emptyList(total) {
  if (total) return '<div class="empty"><strong>No matches</strong><span>Try another city or clear the search.</span></div>';
  return `<div class="empty">${pawIcon(40)}<strong>No animals logged yet</strong><span>When you spot a stray, snap a photo and note the barangay or landmark. It shows up here for every volunteer.</span><a class="btn accent" href="/report">Report the first animal</a></div>`;
}

async function renderAnimal(id) {
  const a = state.animals.get(id);
  if (!a) {
    view.innerHTML = `<a class="back" href="/">‹ All animals</a><div class="empty"><strong>Tag ${esc(tagLabel(id))} not found</strong><span>This animal may have been removed.</span></div>`;
    return;
  }
  const org = a.org_id && state.orgs.get(a.org_id);
  const photo = photoUrl(a.photo_path || a.thumb_path);
  const canDelete = isAdmin() || a.created_by === state.session.user.id;
  const orgChoices = [...state.orgs.values()].filter((o) => isAdmin() || myOrgIds().includes(o.id) || o.id === a.org_id);
  view.innerHTML = `
    <a class="back" href="/">‹ All animals</a>
    ${photo ? `<img class="hero-photo" src="${esc(photo)}" alt="Photo of ${esc(a.name || 'this animal')}">` : `<div class="hero-photo">${pawIcon(56)}</div>`}
    <div><div class="row"><h1>${esc(a.name || 'No name yet')}</h1><span class="code" style="font-size:13px">${tagLabel(a.id)}</span></div>
      <div class="pills" style="margin-top:8px">${statusPill(a)}${temperPill(a)}${fedPill(a)}</div></div>
    ${temperCallout(a)}
    <dl class="facts">
      <div><dt>Species</dt><dd>${speciesWord(a)}${a.sex ? ' · ' + sexWord(a.sex) : ''}</dd></div>
      <div><dt>Markings</dt><dd>${esc(a.color || '—')}</dd></div>
      <div><dt>Usually found</dt><dd>${esc(a.city || '—')}${a.landmark ? `<br><span class="note">${esc(a.landmark)}</span>` : ''}</dd></div>
      <div><dt>${org ? 'Posted by' : 'First reported'}</dt><dd>${org ? `<a href="/o/${esc(org.id)}">${esc(org.name)}</a>` : `${esc(personName(a.created_by))}<br><span class="note">${fmtDate(a.created_at)}</span>`}</dd></div>
    </dl>
    ${a.notes ? `<p style="max-width:65ch;white-space:pre-line">${esc(a.notes)}</p>` : ''}
    ${safeHttps(a.map_url) ? `<div><a class="btn" href="${esc(a.map_url)}" target="_blank" rel="noopener">Open location in Maps</a></div>` : ''}

    <section class="panel" aria-labelledby="fedH">
      <h2 id="fedH">Feeding log</h2>
      <form id="feedForm" class="grid2">
        <label class="field"><span>What did you give?</span><input type="text" id="ffFood" maxlength="80" placeholder="Dry kibble, rice + chicken, water"></label>
        <label class="field"><span>Note (optional)</span><input type="text" id="ffNote" maxlength="200" placeholder="Limping on left leg, ate well"></label>
        <button class="btn primary block" style="grid-column:1/-1" type="submit">I fed ${esc(a.name || 'this animal')} just now</button>
      </form>
      <ul class="log" id="logList"><li><span></span><span class="note">Loading feedings…</span></li></ul>
    </section>

    <section class="panel" aria-labelledby="tagH">
      <h2 id="tagH">Collar QR tag</h2>
      <div class="tagwrap"><canvas id="tagCanvas" aria-label="Collar tag preview"></canvas>
        <div class="stack" style="gap:10px;min-width:0">
          <p class="note">Anyone who scans this sees ${esc(a.name || 'this animal')}'s public page: photo, name, area and whether they're approachable. Landmarks and feeding times stay private to volunteers.</p>
          <div class="row"><button class="btn accent" id="saveTag" type="button">Download tag</button><a class="btn" href="/tags?ids=${esc(a.id)}">Print at collar size</a></div>
          <div class="row"><button class="btn" id="shareLink" type="button">Share page</button><a class="btn" href="${esc(tagUrl(a.id))}" target="_blank" rel="noopener">Preview public page</a></div>
          <div class="note mono" id="linkText" style="overflow-wrap:anywhere;user-select:all">${esc(tagUrl(a.id))}</div>
        </div></div>
    </section>

    <details class="panel"><summary>Edit details</summary>
      <form id="editForm" class="stack" style="margin-top:12px">
        <div class="grid2">
          <label class="field"><span>Name</span><input type="text" id="eName" maxlength="40" value="${esc(a.name)}"></label>
          <label class="field"><span>Status</span><select id="eStatus">${statusOptions(a.status)}</select></label>
          <label class="field"><span>Approachable?</span><select id="eTemper">${temperOptions(a.temper)}</select></label>
          <label class="field"><span>Sex</span><select id="eSex"><option value="">Not sure</option><option value="male" ${a.sex === 'male' ? 'selected' : ''}>Male</option><option value="female" ${a.sex === 'female' ? 'selected' : ''}>Female</option></select></label>
          <label class="field"><span>City</span><select id="eCity">${cityOptions(a.city, 'Not set')}</select></label>
          <label class="field"><span>Barangay or landmark</span><input type="text" id="eLand" maxlength="120" value="${esc(a.landmark)}"></label>
        </div>
        <label class="field"><span>Color and markings</span><input type="text" id="eColor" maxlength="80" value="${esc(a.color)}"></label>
        <label class="field"><span>Google Maps link</span><input type="url" id="eMap" maxlength="300" value="${esc(a.map_url)}"></label>
        ${orgChoices.length ? `<label class="field"><span>Posted for</span><select id="eOrg"><option value="">No organization</option>${orgChoices.map((o) => `<option value="${esc(o.id)}" ${o.id === a.org_id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span>Notes</span><textarea id="eNotes" maxlength="800">${esc(a.notes)}</textarea><small>${a.org_id ? 'Shown publicly as the adoption bio once the organization is verified.' : 'Private to volunteers.'}</small></label>
        <label class="field"><span>Replace photo</span><input type="file" id="ePhoto" accept="image/*"></label>
        <div class="row"><button class="btn primary" type="submit">Save changes</button>
          ${canDelete ? '<button class="btn danger" type="button" id="delBtn">Delete animal</button>' : ''}</div>
        <div id="delConfirm" hidden class="callout bad"><p><b>Delete ${esc(a.name || tagLabel(a.id))} for good?</b> Their feeding log goes too, and printed tags will stop working.</p>
          <div class="row" style="margin-top:8px"><button class="btn danger" type="button" id="delYes">Yes, delete</button><button class="btn" type="button" id="delNo">Keep</button></div></div>
        <p class="note" id="eMsg" role="status"></p>
      </form>
    </details>`;

  const canvas = $('#tagCanvas');
  const draw = () => drawTag(canvas, a);
  draw();
  document.fonts?.ready.then(() => { if ($('#tagCanvas') === canvas) draw(); });
  $('#saveTag').onclick = () => downloadTag(canvas, a);
  $('#shareLink').onclick = async () => {
    const url = tagUrl(a.id);
    if (navigator.share) { try { await navigator.share({ title: a.name || tagLabel(a.id), url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    copyText(url, $('#linkText'));
  };

  loadFeedLog(a);

  $('#feedForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const { error } = await supabase.from('feedings').insert({ animal_id: a.id, food: $('#ffFood').value.trim(), note: $('#ffNote').value.trim() });
    btn.disabled = false;
    if (error) { toast(friendlyError(error)); return; }
    toast('Feeding logged. Salamat!');
    e.target.reset();
    await loadAll().catch(() => {});
    renderAnimal(id);
  };

  $('#editForm').onsubmit = async (e) => {
    e.preventDefault();
    const msg = $('#eMsg');
    msg.textContent = 'Saving…';
    const map = $('#eMap').value.trim();
    if (map && !safeHttps(map)) { msg.textContent = 'The map link must start with https://'; return; }
    const patch = {
      name: $('#eName').value.trim(), status: $('#eStatus').value, temper: $('#eTemper').value, sex: $('#eSex').value,
      city: $('#eCity').value, landmark: $('#eLand').value.trim(), color: $('#eColor').value.trim(), map_url: map, notes: $('#eNotes').value.trim(),
    };
    if ($('#eOrg')) patch.org_id = $('#eOrg').value || null;
    const file = $('#ePhoto').files[0];
    if (file) {
      try { Object.assign(patch, await uploadPhotos(a.id, file)); }
      catch (err) { msg.textContent = friendlyError(err, "The photo didn't upload. Try again."); return; }
    }
    const { error } = await supabase.from('animals').update(patch).eq('id', a.id);
    if (error) { msg.textContent = friendlyError(error); return; }
    toast('Saved');
    await loadAll().catch(() => {});
    renderAnimal(id);
  };

  const del = $('#delBtn');
  if (del) {
    del.onclick = () => { $('#delConfirm').hidden = false; };
    $('#delNo').onclick = () => { $('#delConfirm').hidden = true; };
    $('#delYes').onclick = async () => {
      const { error } = await supabase.from('animals').delete().eq('id', a.id);
      if (error) { toast(friendlyError(error)); return; }
      state.animals.delete(a.id);
      toast('Deleted');
      navigate('/', { replace: true });
    };
  }
}

async function loadFeedLog(a) {
  const { data, error } = await supabase.from('feedings').select('id, fed_at, food, note, fed_by')
    .eq('animal_id', a.id).order('fed_at', { ascending: false }).limit(40);
  const el = $('#logList');
  if (!el) return;
  if (error) { el.innerHTML = '<li><span></span><span class="note">Couldn\'t load the feeding log.</span></li>'; return; }
  const me = state.session.user.id;
  el.innerHTML = data.length ? data.map((f) => `<li><span class="when">${fmtDateTime(f.fed_at)}</span>
      <div><b>${esc(personName(f.fed_by))}</b>${f.food ? ` · ${esc(f.food)}` : ''}${f.note ? `<div class="note">${esc(f.note)}</div>` : ''}</div>
      ${f.fed_by === me || isAdmin() ? `<button class="linkbtn note" type="button" data-del-feed="${f.id}" aria-label="Remove this entry">Remove</button>` : '<span></span>'}</li>`).join('')
    : '<li><span></span><span class="note">No feedings logged yet. Be the first.</span><span></span></li>';
  $$('[data-del-feed]', el).forEach((b) => (b.onclick = async () => {
    const { error: err } = await supabase.from('feedings').delete().eq('id', b.dataset.delFeed);
    if (err) { toast(friendlyError(err)); return; }
    loadFeedLog(a);
  }));
}

async function uploadPhotos(id, file) {
  const { full, thumb } = await preparePhoto(file);
  const stamp = Date.now();
  const photo_path = `${id}/${stamp}.jpg`;
  const thumb_path = `${id}/${stamp}-thumb.jpg`;
  const opts = { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false };
  const up1 = await supabase.storage.from('animal-photos').upload(photo_path, full, opts);
  if (up1.error) throw up1.error;
  const up2 = await supabase.storage.from('animal-photos').upload(thumb_path, thumb, opts);
  if (up2.error) throw up2.error;
  return { photo_path, thumb_path };
}

/* ------------------------------------------------------------------ volunteer: feeding rounds */
function renderFeed() {
  const live = [...state.animals.values()].filter((a) => a.status === 'street' || a.status === 'care');
  const fed = live.filter((a) => hoursSince(a.last_fed_at) < 10).length;
  const due = live.filter((a) => { const h = hoursSince(a.last_fed_at); return h >= 10 && h < 24; }).length;
  const hungry = live.length - fed - due;
  const byCity = {};
  live.forEach((a) => { (byCity[a.city || 'City not set'] ||= []).push(a); });
  const worst = (c) => Math.max(...byCity[c].map((a) => hoursSince(a.last_fed_at)));
  const cities = Object.keys(byCity).sort((x, y) => worst(y) - worst(x) || x.localeCompare(y));
  view.innerHTML = `
    <div><h1>Feeding rounds</h1><p class="lede">Street animals sorted by who has gone longest without food. Tap <b>Fed</b> when you feed one so the next volunteer skips it.</p></div>
    <div class="stats"><div class="stat bad"><b>${hungry}</b><span>Not fed in 24h</span></div><div class="stat warn"><b>${due}</b><span>Due soon</span></div><div class="stat ok"><b>${fed}</b><span>Fed recently</span></div></div>
    ${live.length ? cities.map((c) => {
      const list = byCity[c].sort((x, y) => hoursSince(y.last_fed_at) - hoursSince(x.last_fed_at));
      return `<div class="citybar"><h3>${esc(c)}</h3><span>${list.length} animal${list.length === 1 ? '' : 's'}</span></div>
        <div class="list">${list.map((a) => `<div class="feedrow"><a href="/a/${esc(a.id)}">${thumbHtml(a)}</a>
          <a class="body" href="/a/${esc(a.id)}"><b>${esc(a.name || 'No name yet')}</b> <span class="code">${tagLabel(a.id)}</span>
            <div class="note" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.landmark || '')}</div>
            <div class="pills">${fedPill(a)}${temperPill(a)}</div></a>
          <button class="btn" data-fed="${esc(a.id)}" type="button">Fed</button></div>`).join('')}</div>`;
    }).join('') : '<div class="empty"><strong>No street animals on the rounds yet</strong><span>Animals marked “On the street” or “Needs vet care” appear here with how long since they last ate.</span><a class="btn accent" href="/report">Report an animal</a></div>'}`;
  $$('[data-fed]', view).forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    const { error } = await supabase.from('feedings').insert({ animal_id: b.dataset.fed });
    if (error) { toast(friendlyError(error)); b.disabled = false; return; }
    toast('Logged. Salamat!');
    await loadAll().catch(() => {});
    renderFeed();
  }));
}

/* ------------------------------------------------------------------ volunteer: report */
function renderReport() {
  const params = new URLSearchParams(location.search);
  const orgChoices = [...state.orgs.values()].filter((o) => isAdmin() || myOrgIds().includes(o.id));
  const pre = params.get('org') || '';
  view.innerHTML = `
    <div><h1>Report an animal</h1><p class="lede">One photo and where you usually see them is enough. Other volunteers can fill in the rest.</p></div>
    <form id="addForm" class="stack">
      <label class="photo-drop" id="drop"><span id="dropTxt">${pawIcon(40)}<br><b>Take or choose a photo</b><br><small>Face and markings, if you can</small></span>
        <input type="file" id="pPhoto" accept="image/*" capture="environment"></label>
      <div class="seg" role="radiogroup" aria-label="Species">
        <label><input type="radio" name="sp" value="dog" checked><span>Dog · Aso</span></label>
        <label><input type="radio" name="sp" value="cat"><span>Cat · Pusa</span></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Name</span><input type="text" id="pName" maxlength="40" placeholder="Brownie, Muning…"><small>Leave blank if they don't have one yet</small></label>
        <label class="field"><span>Sex</span><select id="pSex"><option value="">Not sure</option><option value="male">Male</option><option value="female">Female</option></select></label>
      </div>
      <label class="field"><span>Can people approach them?</span><select id="pTemper">${temperOptions('unknown')}</select><small>Helps the next volunteer know whether to hand-feed or leave food at a distance</small></label>
      <label class="field"><span>Color and markings</span><input type="text" id="pColor" maxlength="80" placeholder="Tan aspin, white chest, notched left ear"></label>
      <div class="grid2">
        <label class="field"><span>City</span><select id="pCity" required>${cityOptions('Quezon City')}</select></label>
        <label class="field"><span>Barangay or landmark</span><input type="text" id="pLand" maxlength="120" placeholder="Brgy. Teachers Village, near 7-Eleven"></label>
      </div>
      <div class="field"><span>Exact spot (volunteers only)</span>
        <div class="row"><button class="btn" type="button" id="useLoc">Use my current location</button><span class="note" id="locMsg"></span></div>
        <input type="url" id="pMap" maxlength="300" placeholder="or paste a Google Maps link"></div>
      <div class="grid2">
        <label class="field"><span>Status</span><select id="pStatus">${statusOptions('street', { skipAdopted: true })}</select></label>
        ${orgChoices.length ? `<label class="field"><span>Posting for</span><select id="pOrg"><option value="">Myself, as a volunteer</option>${orgChoices.map((o) => `<option value="${esc(o.id)}" ${o.id === pre ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>` : ''}
      </div>
      <label class="field"><span>Notes</span><textarea id="pNotes" maxlength="800" placeholder="Friendly, shy around men, has a skin condition, already spayed…"></textarea></label>
      <button class="btn primary block" type="submit" id="pSubmit">Save animal</button>
      <p class="note" id="pMsg" role="status"></p>
    </form>`;

  const showDraft = () => {
    const d = $('#drop');
    if (!d || !state.draftPhoto) return;
    $('#dropTxt').innerHTML = '';
    let im = d.querySelector('img');
    if (!im) { im = document.createElement('img'); im.alt = 'Selected photo'; d.insertBefore(im, d.firstChild); }
    if (im.dataset.url) URL.revokeObjectURL(im.dataset.url);
    im.dataset.url = URL.createObjectURL(state.draftPhoto.full);
    im.src = im.dataset.url;
  };
  showDraft();

  $('#pPhoto').onchange = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    $('#dropTxt').textContent = 'Preparing photo…';
    try { state.draftPhoto = await preparePhoto(f); showDraft(); }
    catch { state.draftPhoto = null; $('#dropTxt').innerHTML = "<b>That photo couldn't be read.</b><br><small>Try a JPG or PNG.</small>"; }
  };

  $('#useLoc').onclick = () => {
    const msg = $('#locMsg');
    if (!navigator.geolocation) { msg.textContent = "This phone can't share its location here."; return; }
    msg.textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(
      (p) => { $('#pMap').value = `https://www.google.com/maps?q=${p.coords.latitude.toFixed(6)},${p.coords.longitude.toFixed(6)}`; msg.textContent = `Pinned within about ${Math.round(p.coords.accuracy)} m`; },
      () => { msg.textContent = 'Location is off. Allow it in your browser, or paste a Maps link.'; },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  $('#addForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#pSubmit');
    const msg = $('#pMsg');
    const map = $('#pMap').value.trim();
    if (map && !safeHttps(map)) { msg.textContent = 'The map link must start with https://'; return; }
    btn.disabled = true;
    msg.textContent = 'Saving…';
    const row = {
      name: $('#pName').value.trim(), species: $('input[name=sp]:checked').value, sex: $('#pSex').value, temper: $('#pTemper').value,
      color: $('#pColor').value.trim(), city: $('#pCity').value, landmark: $('#pLand').value.trim(), map_url: map,
      status: $('#pStatus').value, org_id: $('#pOrg')?.value || null, notes: $('#pNotes').value.trim(),
    };
    const { data, error } = await supabase.from('animals').insert(row).select('id').single();
    if (error) { btn.disabled = false; msg.textContent = friendlyError(error); return; }
    if (state.draftPhoto) {
      msg.textContent = 'Uploading photo…';
      try {
        const file = new File([state.draftPhoto.full], 'photo.jpg', { type: 'image/jpeg' });
        const paths = await uploadPhotos(data.id, file);
        await supabase.from('animals').update(paths).eq('id', data.id);
      } catch {
        toast('Saved, but the photo didn\'t upload. Add it from Edit details.');
      }
    }
    state.draftPhoto = null;
    toast(`Saved as ${tagLabel(data.id)}`);
    await loadAll().catch(() => {});
    navigate(`/a/${data.id}`, { replace: true });
  };
}

/* ------------------------------------------------------------------ shelters */
function renderShelters() {
  const list = [...state.orgs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const adoptCount = (id) => [...state.animals.values()].filter((a) => a.org_id === id && a.status === 'adopt').length;
  view.innerHTML = `
    <div><h1>Shelters and rescues</h1><p class="lede">Partner shelters, rescue groups and vet clinics post their animals here, next to the strays volunteers are feeding. New organizations appear publicly once an organizer verifies them.</p></div>
    <div class="list">${list.length ? list.map((o) => orgCardHtml(o, `<div class="pills" style="margin-top:4px">${o.verified ? '' : '<span class="pill warn">Waiting for verification</span>'}${adoptCount(o.id) ? `<span class="pill adopt">${adoptCount(o.id)} ready for adoption</span>` : ''}</div>`)).join('')
      : '<div class="empty"><strong>No organizations yet</strong><span>Shelters and rescue groups can register below, then post their animals for adoption.</span></div>'}</div>
    <details class="panel"><summary>Register a shelter or rescue</summary>
      <form id="orgForm" class="stack" style="margin-top:12px">
        <label class="field"><span>Organization name</span><input type="text" id="oName" required minlength="2" maxlength="80" placeholder="e.g. Barangay Animal Rescue"></label>
        <div class="grid2">
          <label class="field"><span>Type</span><select id="oType">${Object.entries(ORG_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label class="field"><span>City</span><select id="oCity">${cityOptions('Quezon City')}</select></label>
        </div>
        <label class="field"><span>How adopters reach you</span><input type="text" id="oContact" maxlength="160" placeholder="0917 123 4567 · Facebook page · email"><small>Shown publicly once verified</small></label>
        <label class="field"><span>About</span><textarea id="oAbout" maxlength="800" placeholder="Hours, adoption process, donation drives"></textarea></label>
        <button class="btn primary" type="submit">Register organization</button>
        <p class="note" id="oMsg" role="status"></p>
      </form></details>`;
  $('#orgForm').onsubmit = async (e) => {
    e.preventDefault();
    const row = { name: $('#oName').value.trim(), type: $('#oType').value, city: $('#oCity').value, contact: $('#oContact').value.trim(), about: $('#oAbout').value.trim() };
    const { data, error } = await supabase.from('orgs').insert(row).select('id').single();
    if (error) { $('#oMsg').textContent = friendlyError(error); return; }
    toast('Registered. An organizer will verify it.');
    await loadAll().catch(() => {});
    navigate(`/o/${data.id}`);
  };
}

function renderOrg(id) {
  const o = state.orgs.get(id);
  if (!o) { view.innerHTML = '<a class="back" href="/shelters">‹ Shelters</a><div class="empty"><strong>Organization not found</strong></div>'; return; }
  const canManage = isAdmin() || myOrgIds().includes(id);
  const memberIds = state.members.filter((m) => m.org_id === id).map((m) => m.user_id);
  const candidates = [...state.people.values()].filter((p) => ['volunteer', 'admin'].includes(p.role) && !memberIds.includes(p.id));
  const mine = [...state.animals.values()].filter((a) => a.org_id === id)
    .sort((x, y) => (x.status === 'adopt' ? 0 : 1) - (y.status === 'adopt' ? 0 : 1) || new Date(y.created_at) - new Date(x.created_at));
  view.innerHTML = `
    <a class="back" href="/shelters">‹ Shelters</a>
    ${orgHeaderHtml(o, o.verified ? '<span class="pill ok" style="margin-top:4px">Verified</span>' : '<span class="pill warn" style="margin-top:4px">Waiting for verification</span>')}
    <div class="row between"><h2>Their animals</h2>${canManage ? `<a class="btn accent" href="/report?org=${esc(id)}">Post an animal</a>` : ''}</div>
    <div class="list">${mine.length ? mine.map(cardHtml).join('') : '<div class="empty"><strong>No animals posted yet</strong><span>Post animals in your care with a photo so adopters and volunteers can find them.</span></div>'}</div>
    <section class="panel"><h3>Members</h3>
      <div class="people">${memberIds.length ? memberIds.map((uid) => `<div class="person"><div class="who">${esc(personName(uid))}</div>${canManage && uid !== state.session.user.id ? `<button class="linkbtn note" type="button" data-rm="${esc(uid)}">Remove</button>` : '<span></span>'}</div>`).join('') : '<p class="note">No members.</p>'}</div>
      ${canManage && candidates.length ? `<div class="row"><select id="addMember" style="flex:1;min-width:0"><option value="">Add a volunteer…</option>${candidates.map((p) => `<option value="${esc(p.id)}">${esc(p.display_name || 'Unnamed volunteer')}</option>`).join('')}</select><button class="btn" type="button" id="addMemberBtn">Add</button></div>` : ''}
    </section>
    ${canManage ? `<details class="panel"><summary>Edit organization</summary>
      <form id="orgEdit" class="stack" style="margin-top:12px">
        <label class="field"><span>Name</span><input type="text" id="oeName" minlength="2" maxlength="80" value="${esc(o.name)}" required></label>
        <div class="grid2">
          <label class="field"><span>Type</span><select id="oeType">${Object.entries(ORG_TYPES).map(([k, v]) => `<option value="${k}" ${o.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="field"><span>City</span><select id="oeCity">${cityOptions(o.city)}</select></label>
        </div>
        <label class="field"><span>Contact</span><input type="text" id="oeContact" maxlength="160" value="${esc(o.contact)}"></label>
        <label class="field"><span>About</span><textarea id="oeAbout" maxlength="800">${esc(o.about)}</textarea></label>
        <button class="btn primary" type="submit">Save</button>
      </form></details>` : ''}`;

  $$('[data-rm]', view).forEach((b) => (b.onclick = async () => {
    const { error } = await supabase.rpc('admin_set_org_member', { org: id, member: b.dataset.rm, is_member: false });
    if (error) { toast(friendlyError(error)); return; }
    await loadAll().catch(() => {});
    renderOrg(id);
  }));
  const addBtn = $('#addMemberBtn');
  if (addBtn) addBtn.onclick = async () => {
    const uid = $('#addMember').value;
    if (!uid) return;
    const { error } = await supabase.rpc('admin_set_org_member', { org: id, member: uid, is_member: true });
    if (error) { toast(friendlyError(error)); return; }
    toast('Member added');
    await loadAll().catch(() => {});
    renderOrg(id);
  };
  const edit = $('#orgEdit');
  if (edit) edit.onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await supabase.from('orgs').update({
      name: $('#oeName').value.trim(), type: $('#oeType').value, city: $('#oeCity').value, contact: $('#oeContact').value.trim(), about: $('#oeAbout').value.trim(),
    }).eq('id', id);
    if (error) { toast(friendlyError(error)); return; }
    toast('Saved');
    await loadAll().catch(() => {});
    renderOrg(id);
  };
}

/* ------------------------------------------------------------------ collar tag printing */
function renderTags() {
  const pre = new Set((new URLSearchParams(location.search).get('ids') || '').toUpperCase().split(',').filter(Boolean));
  const rows = [...state.animals.values()].filter((a) => a.status !== 'adopted').sort((x, y) => (x.city || '').localeCompare(y.city || '') || (x.name || '').localeCompare(y.name || ''));
  view.innerHTML = `
    <a class="back" href="/">‹ All animals</a>
    <div><h1>Print collar tags</h1><p class="lede">Pick the animals, then print. Tags come out at 3 × 4.5 cm with cut lines. Laminate them and thread the collar through the circle at the top.</p></div>
    <div class="row"><button class="btn primary" type="button" id="printBtn">Print selected</button><button class="linkbtn" type="button" id="selAll">Select all</button><button class="linkbtn" type="button" id="selNone">Clear</button><span class="note" id="selCount"></span></div>
    <div class="list">${rows.map((a) => `<label class="tagcheck"><input type="checkbox" value="${esc(a.id)}" ${pre.has(a.id) ? 'checked' : ''}>${thumbHtml(a)}
      <span><b>${esc(a.name || 'No name yet')}</b> <span class="code">${tagLabel(a.id)}</span><br><span class="note">${esc(a.city || '')}</span></span></label>`).join('') || '<p class="note">No animals yet.</p>'}</div>
    <p class="note">On a phone, use your browser's Share › Print, or download single tags from each animal's page.</p>`;
  const boxes = $$('.tagcheck input', view);
  const count = () => { $('#selCount').textContent = `${boxes.filter((b) => b.checked).length} selected`; };
  boxes.forEach((b) => (b.onchange = count));
  count();
  $('#selAll').onclick = () => { boxes.forEach((b) => (b.checked = true)); count(); };
  $('#selNone').onclick = () => { boxes.forEach((b) => (b.checked = false)); count(); };
  $('#printBtn').onclick = () => {
    const chosen = boxes.filter((b) => b.checked).map((b) => state.animals.get(b.value)).filter(Boolean);
    if (!chosen.length) { toast('Pick at least one animal'); return; }
    $('#printSheet').innerHTML = chosen.map((a) => `<div class="ptag"><span class="hole"></span><span class="nm">${esc(a.name || 'Scan me')}</span>${qrSvg(a.id)}<span class="cd">${tagLabel(a.id)}</span><span class="ln">Cared for by volunteers.<br>Please don't remove.</span></div>`).join('');
    window.print();
  };
}

/* ------------------------------------------------------------------ admin */
async function renderAdmin() {
  if (!isAdmin()) { view.innerHTML = '<div class="empty"><strong>Admins only</strong></div>'; return; }
  loadingView();
  const { data: people, error } = await supabase.rpc('admin_list_people');
  if (error) { view.innerHTML = `<div class="empty"><strong>Couldn't load people</strong><span>${esc(friendlyError(error, 'Try again.'))}</span></div>`; return; }
  const pending = people.filter((p) => p.role === 'pending');
  const others = people.filter((p) => p.role !== 'pending');
  const unverified = [...state.orgs.values()].filter((o) => !o.verified);
  const verified = [...state.orgs.values()].filter((o) => o.verified);
  const me = state.session.user.id;
  const roleSelect = (p) => p.id === me ? `<span class="pill">${p.role}</span>` :
    `<select data-role="${esc(p.id)}" aria-label="Role for ${esc(p.display_name || p.email)}">${['pending', 'volunteer', 'admin', 'blocked'].map((r) => `<option ${p.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select>`;
  view.innerHTML = `
    <div><h1>Admin</h1><p class="lede">Approve volunteers before they can see locations, and verify shelters before they appear publicly.</p></div>
    <section class="panel"><h2>Waiting for approval <span class="note">(${pending.length})</span></h2>
      <div class="people">${pending.length ? pending.map((p) => `<div class="person"><div class="who"><b>${esc(p.display_name || '—')}</b><div class="note">${esc(p.email)} · signed up ${fmtDate(p.created_at)}</div></div>
        <div class="row"><button class="btn sm primary" type="button" data-approve="${esc(p.id)}">Approve</button><button class="btn sm" type="button" data-block="${esc(p.id)}">Decline</button></div></div>`).join('') : '<p class="note">Nobody waiting.</p>'}</div>
    </section>
    <section class="panel"><h2>Shelters to verify <span class="note">(${unverified.length})</span></h2>
      <div class="people">${unverified.length ? unverified.map((o) => `<div class="person"><div class="who"><a href="/o/${esc(o.id)}"><b>${esc(o.name)}</b></a><div class="note">${esc(ORG_SHORT[o.type])} · ${esc(o.city)} · ${esc(o.contact || 'no contact')}</div></div>
        <button class="btn sm primary" type="button" data-verify="${esc(o.id)}">Verify</button></div>`).join('') : '<p class="note">Nothing to verify.</p>'}</div>
      ${verified.length ? `<details><summary>Verified (${verified.length})</summary><div class="people" style="margin-top:8px">${verified.map((o) => `<div class="person"><div class="who">${esc(o.name)}</div><button class="linkbtn note" type="button" data-unverify="${esc(o.id)}">Unverify</button></div>`).join('')}</div></details>` : ''}
    </section>
    <section class="panel"><h2>Everyone</h2>
      <div class="people">${others.map((p) => `<div class="person"><div class="who"><b>${esc(p.display_name || '—')}</b><div class="note">${esc(p.email)}</div></div>${roleSelect(p)}</div>`).join('')}</div>
    </section>`;
  const setRole = async (id, role) => {
    const { error: err } = await supabase.rpc('admin_set_role', { target: id, new_role: role });
    if (err) { toast(friendlyError(err)); return; }
    toast(role === 'volunteer' ? 'Approved' : 'Updated');
    await loadAll().catch(() => {});
    renderAdmin();
  };
  $$('[data-approve]', view).forEach((b) => (b.onclick = () => setRole(b.dataset.approve, 'volunteer')));
  $$('[data-block]', view).forEach((b) => (b.onclick = () => setRole(b.dataset.block, 'blocked')));
  $$('[data-role]', view).forEach((s) => (s.onchange = () => setRole(s.dataset.role, s.value)));
  const verify = async (org, v) => {
    const { error: err } = await supabase.rpc('admin_verify_org', { org, is_verified: v });
    if (err) { toast(friendlyError(err)); return; }
    toast(v ? 'Verified' : 'Unverified');
    await loadAll().catch(() => {});
    renderAdmin();
  };
  $$('[data-verify]', view).forEach((b) => (b.onclick = () => verify(b.dataset.verify, true)));
  $$('[data-unverify]', view).forEach((b) => (b.onclick = () => verify(b.dataset.unverify, false)));
}

/* ------------------------------------------------------------------ sign in / account */
function renderSignin() {
  if (state.session) { navigate('/', { replace: true }); return; }
  view.innerHTML = `
    <div><h1>Volunteer sign in</h1><p class="lede">We'll email you a sign-in link. New volunteers are approved by an organizer before they can see locations and feeding logs.</p></div>
    <form id="signinForm" class="panel">
      <label class="field"><span>Email</span><input type="email" id="sEmail" required autocomplete="email" placeholder="you@example.com"></label>
      <button class="btn primary" type="submit">Email me a sign-in link</button>
      <p class="note" id="sMsg" role="status"></p>
    </form>
    ${googleSignIn ? '<button class="btn block" type="button" id="gBtn">Continue with Google</button>' : ''}`;
  $('#signinForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const { error } = await supabase.auth.signInWithOtp({ email: $('#sEmail').value.trim(), options: { emailRedirectTo: `${location.origin}/` } });
    btn.disabled = false;
    $('#sMsg').textContent = error
      ? (/rate/i.test(error.message) ? 'Too many sign-in emails just now. Wait a few minutes and try again.' : "Couldn't send the email. Check the address and try again.")
      : 'Check your inbox for the sign-in link. It can take a minute; check spam too.';
  };
  const g = $('#gBtn');
  if (g) g.onclick = () => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/` } });
}

function renderAccount() {
  if (!state.session) { navigate('/signin', { replace: true }); return; }
  const p = state.profile || {};
  const roleText = { pending: 'Waiting for approval', volunteer: 'Volunteer', admin: 'Organizer (admin)', blocked: 'Paused' }[p.role] || p.role;
  view.innerHTML = `
    <div><h1>Your account</h1><p class="lede">${esc(state.session.user.email)} · ${esc(roleText)}</p></div>
    ${isVol() ? '' : accountStatusCallout()}
    <form id="acctForm" class="panel">
      <label class="field"><span>Your name</span><input type="text" id="aName" maxlength="60" value="${esc(p.display_name)}" placeholder="How other volunteers see you"><small>Shown on feeding logs</small></label>
      <button class="btn primary" type="submit">Save</button>
    </form>
    <div class="panel"><h3>Put Bantay Kalye on your home screen</h3>
      <p class="note">Android: open the browser menu and tap <b>Add to Home screen</b>. iPhone: tap <b>Share</b>, then <b>Add to Home Screen</b>.</p></div>
    <button class="btn" type="button" id="signOut">Sign out</button>`;
  $('#acctForm').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await supabase.from('profiles').update({ display_name: $('#aName').value.trim() }).eq('id', state.session.user.id);
    if (error) { toast(friendlyError(error)); return; }
    await loadProfile();
    toast('Saved');
    renderChrome(currentRoute());
  };
  $('#signOut').onclick = async () => { await supabase.auth.signOut(); navigate('/', { replace: true }); };
}

/* ------------------------------------------------------------------ render */
let renderSeq = 0;
async function render() {
  const route = currentRoute();
  const seq = ++renderSeq;
  document.title = 'Bantay Kalye';
  renderChrome(route);
  if (!configured) {
    view.innerHTML = '<div class="empty"><strong>Not connected yet</strong><span>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild. See README.md.</span></div>';
    return;
  }
  try {
    if (route.name === 'signin') return renderSignin();
    if (route.name === 'account') return renderAccount();

    if (!isVol()) {
      if (route.name === 'animal') return await renderPublicAnimal(route.id);
      if (route.name === 'org') return await renderPublicOrg(route.id);
      if (route.name === 'home') return await renderPublicHome();
      if (!state.session) { navigate('/signin', { replace: true }); return; }
      return renderPublicHome();
    }

    if (!state.loaded) {
      loadingView('Loading animals…');
      await loadAll();
      if (seq !== renderSeq) return;
    }
    switch (route.name) {
      case 'home': return renderList();
      case 'animal': return await renderAnimal(route.id);
      case 'feed': return renderFeed();
      case 'report': return renderReport();
      case 'shelters': return renderShelters();
      case 'org': return renderOrg(route.id);
      case 'tags': return renderTags();
      case 'admin': return await renderAdmin();
      default:
        view.innerHTML = '<div class="empty"><strong>Page not found</strong><a class="btn" href="/">Go home</a></div>';
    }
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="empty"><strong>Something went wrong</strong><span>${esc(friendlyError(err, 'Check your connection and reload the page.'))}</span><button class="btn" type="button" onclick="location.reload()">Reload</button></div>`;
  }
}

/* ------------------------------------------------------------------ boot */
async function boot() {
  if (!configured) { render(); return; }
  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  await loadProfile();
  render();
  supabase.auth.onAuthStateChange(async (event, session) => {
    const changed = (session?.user.id || null) !== (state.session?.user.id || null);
    state.session = session;
    if (!changed && event !== 'USER_UPDATED') return;
    // Defer Supabase calls out of the auth callback, as the client library recommends.
    setTimeout(async () => {
      state.loaded = false;
      state.animals = new Map();
      await loadProfile();
      render();
    }, 0);
  });
}

boot();
