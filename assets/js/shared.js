// Shared helpers for the storefront (app.js) and the kitchen editor (admin.js).

export const DRAFT_KEY = 'shashou.draft.v1';
export const REPO_KEY = 'shashou.repo.v1';

export const TAGS = {
  popular: { label: 'Populaire', icon: 'star' },
  new: { label: 'Nouveau', icon: 'sparkle' },
  spicy: { label: 'Épicé', icon: 'flame' },
  vegetarian: { label: 'Végétarien', icon: 'leaf' },
  vegan: { label: 'Végane', icon: 'leaf' },
  'gluten-free': { label: 'Sans gluten', icon: 'check' },
  nuts: { label: 'Contient des noix', icon: 'info' },
};

/* ---------- storage (never throws) ---------- */
export const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
};

/* ---------- data ---------- */
export async function loadPublishedSite() {
  const res = await fetch(`data/site.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Impossible de charger le menu (${res.status})`);
  return normalize(await res.json());
}

/* Default language for dates and prices; the site can override it with brand.locale. */
export let LOCALE = 'fr-FR';
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function normalize(site) {
  site.brand ??= {};
  site.brand.locale ||= 'fr-FR';
  LOCALE = site.brand.locale; site.about ??= {}; site.contact ??= {}; site.ordering ??= {};
  site.announcements ??= []; site.dates ??= []; site.categories ??= []; site.dishes ??= [];
  site.ordering.fulfillment ??= [{ id: 'pickup', label: 'À emporter', note: '', fee: 0, needsAddress: false }];
  site.ordering.sendVia ??= 'both';
  for (const d of site.dishes) { d.tags ??= []; d.dates ??= []; }
  for (const d of site.dishes) if (d.category && !site.categories.includes(d.category)) site.categories.push(d.category);
  return site;
}

/* ---------- formatting ---------- */
export function money(n, site) {
  const { currency = 'EUR', locale = LOCALE } = site.brand || {};
  try {
    const whole = Number.isInteger(+n);
    return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(+n || 0);
  } catch { return `$${(+n || 0).toFixed(2)}`; }
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const paras = (s) => esc(s).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
export const uid = (p = '') => p + Math.random().toString(36).slice(2, 8);
export const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';

/* ---------- dates ---------- */
export function parseDay(iso) { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d); }
export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
export function fmtDay(iso, style = 'long', locale) {
  const d = parseDay(iso);
  const opts = style === 'short' ? { weekday: 'short', month: 'short', day: 'numeric' }
    : style === 'chip' ? { weekday: 'short', day: 'numeric' }
    : { weekday: 'long', month: 'long', day: 'numeric' };
  return cap(d.toLocaleDateString(locale || LOCALE, opts)).replace(/\.$/, '');
}
export function fmtCutoff(cutoff, locale) {
  if (!cutoff) return '';
  const d = new Date(cutoff);
  if (isNaN(d)) return '';
  return cap(d.toLocaleString(locale || LOCALE, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }));
}
export function timeLeft(cutoff, now = new Date()) {
  if (!cutoff) return '';
  const ms = new Date(cutoff) - now;
  if (ms <= 0) return '';
  const h = Math.floor(ms / 36e5);
  if (h < 1) return `${Math.max(1, Math.round(ms / 6e4))} min`;
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} jours`;
}

/** Dates that haven't happened yet, sorted. */
export function upcomingDates(site, now = new Date()) {
  const today = todayISO(now);
  return site.dates.filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date));
}
export function dateStatus(d, now = new Date()) {
  if (d.date < todayISO(now)) return 'past';
  if (d.paused) return 'paused';
  if (d.cutoff && new Date(d.cutoff) <= now) return 'closed';
  return 'open';
}
export const openDates = (site, now) => upcomingDates(site, now).filter((d) => dateStatus(d, now) === 'open');

export function dishOnDate(dish, dateId) { return !dish.dates?.length || !dateId || dish.dates.includes(dateId); }
export function dishAvailable(dish, dateId) { return !dish.soldOut && !dish.hidden && dishOnDate(dish, dateId); }

export function activeAnnouncements(site, now = new Date()) {
  const today = todayISO(now);
  return site.announcements.filter((a) => a.active !== false && (!a.until || a.until >= today) && (a.title || a.text));
}

/* ---------- contact links ---------- */
export const digits = (n) => String(n || '').replace(/[^\d+]/g, '');
export const waLink = (n, text) => `https://wa.me/${digits(n).replace('+', '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
// "?&body=" works on both iOS and Android messaging apps.
export const smsLink = (n, text) => `sms:${digits(n)}${text ? `?&body=${encodeURIComponent(text)}` : ''}`;
export const telLink = (n) => `tel:${digits(n)}`;
export const mailLink = (e, subject, body) => `mailto:${e}?subject=${encodeURIComponent(subject || '')}${body ? `&body=${encodeURIComponent(body)}` : ''}`;
export const igLink = (h) => `https://instagram.com/${String(h).replace(/^@/, '')}`;
export const fbLink = (h) => /^https?:/.test(h) ? h : `https://facebook.com/${h}`;
export const ttLink = (h) => `https://tiktok.com/@${String(h).replace(/^@/, '')}`;

/* ---------- order ---------- */
export function orderCode() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return 'SH-' + Array.from({ length: 4 }, () => a[Math.floor(Math.random() * a.length)]).join('');
}

export function orderTotals(site, lines, fulfillmentId) {
  const subtotal = lines.reduce((s, l) => s + l.qty * l.dish.price, 0);
  const f = site.ordering.fulfillment.find((x) => x.id === fulfillmentId);
  const fee = f && subtotal > 0 ? +f.fee || 0 : 0;
  return { subtotal, fee, total: subtotal + fee };
}

export function orderMessage(site, o) {
  const date = site.dates.find((d) => d.id === o.dateId);
  const f = site.ordering.fulfillment.find((x) => x.id === o.fulfillmentId);
  const t = orderTotals(site, o.lines, o.fulfillmentId);
  const out = [];
  out.push(`Bonjour ${site.brand.name || ''} ! Je voudrais passer une commande 🙏`);
  out.push('');
  out.push(`Commande ${o.code}`);
  if (date) out.push(`📅 ${fmtDay(date.date, 'long', site.brand.locale)}${date.window ? `, ${date.window}` : ''}`);
  if (f) out.push(`📍 ${f.label}${f.needsAddress && o.address ? ` : ${o.address}` : ''}`);
  out.push('');
  for (const l of o.lines) {
    out.push(`• ${l.qty} × ${l.dish.name}${l.dish.unit ? ` (${l.dish.unit})` : ''} : ${money(l.qty * l.dish.price, site)}`);
    if (l.note) out.push(`   ↳ ${l.note}`);
  }
  out.push('');
  if (t.fee) out.push(`Sous-total : ${money(t.subtotal, site)}`, `${f.label} : ${money(t.fee, site)}`);
  out.push(`Total : ${money(t.total, site)}`);
  out.push('');
  out.push(`Nom : ${o.name}`);
  if (o.note) out.push(`Note : ${o.note}`);
  return out.join('\n');
}

/* ---------- icons (24px stroke set) ---------- */
const P = {
  plus: '<path d="M5 12h14M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  whatsapp: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.5 8.5c0 3 2.5 6 6 6l1-1.5-2-1-1 .8c-1-.4-2-1.4-2.3-2.3l.8-1-1-2-1.5 1Z" fill="currentColor" stroke="none"/>',
  sms: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  instagram: '<rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37zM17.5 6.5h.01"/>',
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  tiktok: '<path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8Z"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  trash: '<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>',
};
export function icon(name, cls = '') {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

/* Brand mark (sun + marmite), same artwork as assets/img/mark.svg */
export function markSVG(cls = 'mark') {
  return `<img class="${cls}" src="assets/img/mark.svg" alt="" width="40" height="40">`;
}

/** Branded tile used when a dish has no photo yet. */
export function placeholderTile(dish, i = 0) {
  const tones = ['red', 'blue', 'mango', 'green'];
  const tone = tones[(dish.name || '').length % tones.length];
  return `<div class="ph ph-${tone}" aria-hidden="true"><img src="assets/img/mark-mono.svg" alt=""><span>${esc(dish.name || '')}</span></div>`;
}

export function photoHTML(dish, { cls = '', resolve = (p) => p, lazy = true } = {}) {
  if (!dish.photo) return placeholderTile(dish);
  return `<img class="${cls}" src="${esc(resolve(dish.photo))}" alt="${esc(dish.name)}" ${lazy ? 'loading="lazy"' : ''} decoding="async">`;
}
