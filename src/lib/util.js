export const CITIES = [
  'Caloocan', 'Las Piñas', 'Makati', 'Malabon', 'Mandaluyong', 'Manila', 'Marikina',
  'Muntinlupa', 'Navotas', 'Parañaque', 'Pasay', 'Pasig', 'Pateros', 'Quezon City',
  'San Juan', 'Taguig', 'Valenzuela',
];

export const STATUS = {
  street: { label: 'On the street', cls: '' },
  care: { label: 'Needs vet care', cls: 'bad' },
  adopt: { label: 'Ready for adoption', cls: 'adopt' },
  shelter: { label: 'In a shelter', cls: 'plain' },
  adopted: { label: 'Adopted', cls: 'ok' },
};

export const TEMPER = {
  friendly: { label: 'Approachable', short: 'Approachable', cls: 'ok', tip: 'Comes to people and can usually be touched or handled.' },
  cautious: { label: 'Cautious · approach slowly', short: 'Cautious', cls: 'warn', tip: 'Takes food but keeps some distance. Move slowly and let them come to you.' },
  avoid: { label: 'Not approachable · keep distance', short: 'Keep distance', cls: 'bad', tip: "May bite, scratch or run. Leave food at a distance and don't try to touch." },
  unknown: { label: 'Not sure yet', short: '', cls: 'plain', tip: '' },
};

export const ORG_TYPES = { shelter: 'Shelter / adoption center', rescue: 'Rescue group', clinic: 'Vet clinic' };
export const ORG_SHORT = { shelter: 'Shelter', rescue: 'Rescue group', clinic: 'Vet clinic' };

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export const tagLabel = (id) => 'BK-' + String(id).toUpperCase();
export const speciesWord = (a) => (a.species === 'cat' ? 'Cat' : 'Dog');
export const sexWord = (s) => (s === 'male' ? 'Male' : s === 'female' ? 'Female' : '');

export function hoursSince(t) {
  return t ? (Date.now() - new Date(t).getTime()) / 36e5 : Infinity;
}

export function ago(t) {
  if (!t) return 'never';
  const m = Math.round((Date.now() - new Date(t).getTime()) / 6e4);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export const fmtDateTime = (t) => new Date(t).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const fmtDate = (t) => new Date(t).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

export function statusPill(a) {
  const s = STATUS[a.status] || STATUS.street;
  return `<span class="pill ${s.cls}">${s.label}</span>`;
}

export function temperPill(a) {
  const t = TEMPER[a.temper];
  return t && t.short ? `<span class="pill ${t.cls}">${t.short}</span>` : '';
}

export function fedPill(a) {
  if (!('last_fed_at' in a)) return '';
  if (a.status === 'adopted' || a.status === 'shelter') return '';
  const h = hoursSince(a.last_fed_at);
  if (h < 10) return `<span class="pill ok">Fed ${ago(a.last_fed_at)}</span>`;
  if (h < 24) return `<span class="pill warn">Due · fed ${ago(a.last_fed_at)}</span>`;
  return `<span class="pill bad">${a.last_fed_at ? 'Hungry · fed ' + ago(a.last_fed_at) : 'No feeding logged'}</span>`;
}

export const cityOptions = (sel, blank) =>
  (blank ? `<option value="">${esc(blank)}</option>` : '') +
  CITIES.map((c) => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');

export const temperOptions = (sel) =>
  Object.entries(TEMPER).map(([k, v]) => `<option value="${k}" ${(sel || 'unknown') === k ? 'selected' : ''}>${v.label}</option>`).join('');

export const statusOptions = (sel, { skipAdopted = false } = {}) =>
  Object.entries(STATUS).filter(([k]) => !(skipAdopted && k === 'adopted'))
    .map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v.label}</option>`).join('');

export const initials = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function pawIcon(size = 34) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="9" r="2"/><circle cx="9" cy="5" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="19" cy="9" r="2"/><path d="M8 17c0-3 2-5 4-5s4 2 4 5-2 3-4 3-4 0-4-3z"/></svg>`;
}

export function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

/** Turn a Supabase/PostgREST error into something a volunteer can act on. */
export function friendlyError(err, fallback = "Couldn't save. Check your connection and try again.") {
  if (!err) return fallback;
  if (err.code === '42501' || /permission|row-level security/i.test(err.message || '')) {
    return err.message && !/row-level security|permission denied/i.test(err.message)
      ? err.message
      : "You don't have permission to do that. Ask an organizer to approve your account.";
  }
  if (/Failed to fetch|NetworkError|network/i.test(err.message || '')) return 'No connection. Try again when you have signal.';
  return fallback;
}

export const safeHttps = (u) => (/^https:\/\//.test(u || '') ? u : '');
