import {
  DRAFT_KEY, REPO_KEY, TAGS, store, loadPublishedSite, normalize, money, esc, paras, fmtDay, fmtCutoff, timeLeft,
  upcomingDates, dateStatus, openDates, dishOnDate, activeAnnouncements, waLink, smsLink, telLink, mailLink, igLink,
  fbLink, ttLink, orderCode, orderTotals, orderMessage, icon, photoHTML, parseDay,
} from './shared.js';

const BAG_KEY = 'shashou.bag.v1';
const LAST_KEY = 'shashou.last.v1';
const DISMISS_KEY = 'shashou.dismissed.v1';

const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const params = new URLSearchParams(location.search);
const PREVIEW = params.has('preview');

let site;
let bag = store.get(BAG_KEY) || {};
bag.items ??= []; bag.name ??= ''; bag.address ??= ''; bag.note ??= '';
let last = store.get(LAST_KEY);
let dismissed = store.get(DISMISS_KEY, []);
let errors = {};

const saveBag = () => store.set(BAG_KEY, bag);

/* In preview mode, photos may not be deployed yet: read them straight from the repo. */
let resolve = (p) => p;
function setupPreview() {
  const repo = store.get(REPO_KEY);
  if (repo?.owner && repo?.repo) {
    resolve = (p) => (!p || /^(data:|https?:|blob:)/.test(p) ? p : `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${repo.branch || 'main'}/${p}`);
  }
}

/* ---------- derived ---------- */
const dishById = (id) => site.dishes.find((d) => d.id === id);
const visibleDishes = () => site.dishes.filter((d) => !d.hidden);
function bagLines() {
  return bag.items.map((it) => ({ ...it, dish: dishById(it.id) })).filter((l) => l.dish && !l.dish.hidden);
}
const bagCount = () => bagLines().reduce((n, l) => n + l.qty, 0);
function qtyInBag(id) { return bag.items.find((i) => i.id === id)?.qty || 0; }

function selectedDate() {
  const up = upcomingDates(site);
  let d = up.find((x) => x.id === bag.dateId);
  if (!d) d = openDates(site)[0] || up[0];
  return d || null;
}

function dayLabels(ids) {
  return ids.map((id) => site.dates.find((d) => d.id === id)).filter((d) => d && dateStatus(d) !== 'past')
    .map((d) => fmtDay(d.date, 'short', site.brand.locale));
}

/* ---------- small UI helpers ---------- */
let toastTimer;
function toast(msg, ic = 'check') {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.innerHTML = `${icon(ic)}<span>${esc(msg)}</span>`;
  requestAnimationFrame(() => t.classList.add('in'));
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('in'), 2200);
}

let sheetEl = null, scrimEl = null, sheetOnClose = null, lastFocus = null;
function openSheet(html, cls = '', onClose) {
  closeSheet(true);
  lastFocus = document.activeElement;
  scrimEl = document.createElement('div'); scrimEl.className = 'scrim';
  sheetEl = document.createElement('div'); sheetEl.className = `sheet ${cls}`;
  sheetEl.setAttribute('role', 'dialog'); sheetEl.setAttribute('aria-modal', 'true');
  sheetEl.innerHTML = html;
  document.body.append(scrimEl, sheetEl);
  document.body.style.overflow = 'hidden';
  scrimEl.addEventListener('click', () => requestClose());
  requestAnimationFrame(() => { scrimEl.classList.add('in'); sheetEl.classList.add('in'); });
  sheetOnClose = onClose;
  setTimeout(() => sheetEl?.querySelector('[data-autofocus]')?.focus({ preventScroll: true }), 50);
  return sheetEl;
}
function closeSheet(immediate = false) {
  if (!sheetEl) return;
  const s = sheetEl, sc = scrimEl; sheetEl = scrimEl = null;
  document.body.style.overflow = '';
  if (immediate) { s.remove(); sc.remove(); }
  else { s.classList.remove('in'); sc.classList.remove('in'); setTimeout(() => { s.remove(); sc.remove(); }, 320); }
  const cb = sheetOnClose; sheetOnClose = null; cb?.();
  lastFocus?.focus?.({ preventScroll: true });
}
/* Sheets with a route (#/dish/...) close through history so the phone's back button works too. */
let sheetFromRoute = false;
function requestClose() {
  if (sheetFromRoute) { sheetFromRoute = false; if (history.state?.inApp) history.back(); else location.replace('#/'); }
  else closeSheet();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetEl) requestClose(); });

/* ---------- shared fragments ---------- */
function tagHTML(t) { const m = TAGS[t]; return m ? `<span class="tag tag-${t}">${icon(m.icon)}${m.label}</span>` : ''; }

function topbar() {
  const b = site.brand;
  return `
  ${PREVIEW ? `<div class="preview-banner">Preview of your unpublished changes. Customers can't see this yet.</div>` : ''}
  <header class="topbar"><div class="wrap">
    <a class="brand" href="#/" aria-label="${esc(b.name)} home"><img class="mark" src="assets/img/mark.svg" alt="" width="40" height="40">
      <span><b>${esc(b.name)}</b><small>${esc(b.tagline || '')}</small></span></a>
    <a class="icon-btn" href="#/about" aria-label="About & info">${icon('info')}</a>
    <button class="icon-btn contact-icon" data-act="contact" aria-label="Contact ${esc(b.name)}">${icon('chat')}</button>
    <button class="btn btn-dark btn-sm contact-btn" data-act="contact">${icon('chat')} Contact</button>
  </div></header>`;
}

function footer() {
  const c = site.contact, b = site.brand;
  const soc = [
    c.instagram && `<a href="${igLink(c.instagram)}" target="_blank" rel="noopener" aria-label="Instagram">${icon('instagram')}</a>`,
    c.facebook && `<a href="${fbLink(c.facebook)}" target="_blank" rel="noopener" aria-label="Facebook">${icon('facebook')}</a>`,
    c.tiktok && `<a href="${ttLink(c.tiktok)}" target="_blank" rel="noopener" aria-label="TikTok">${icon('tiktok')}</a>`,
    c.whatsapp && `<a href="${waLink(c.whatsapp)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('whatsapp')}</a>`,
    c.email && `<a href="${mailLink(c.email, b.name)}" aria-label="Email">${icon('mail')}</a>`,
  ].filter(Boolean).join('');
  return `<footer class="foot"><div class="wrap">
    <a class="brand" href="#/"><img class="mark" src="assets/img/mark.svg" alt="" width="40" height="40"><span><b>${esc(b.name)}</b><small>${esc(b.tagline || '')}</small></span></a>
    <p>${esc(site.about.area || '')}</p>
    ${soc ? `<div class="socials">${soc}</div>` : ''}
    <div class="tiny"><span>© ${new Date().getFullYear()} ${esc(b.name)} · Fèt ak lanmou (made with love)</span><a href="#/about">About</a><a href="admin.html">Kitchen login</a></div>
  </div></footer>`;
}

/* ---------- HOME ---------- */
function whenPanel() {
  const up = upcomingDates(site);
  const c = site.contact;
  if (!up.length) {
    return `<section class="when card" aria-label="Next cook-up"><div class="when-empty">
      <div class="when-head"><h2>No cook-up scheduled yet</h2><span class="pill pill-closed">Taking a break</span></div>
      <p class="muted">The next dates will be posted here soon. Want a heads-up? Send a message and you'll be the first to know.</p>
      <div class="row">
        ${c.whatsapp ? `<a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="${waLink(c.whatsapp, `Hi ${site.brand.name}! Please let me know when your next cook-up is 🙏`)}">${icon('whatsapp')} Notify me</a>` : ''}
        ${c.instagram ? `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${igLink(c.instagram)}">${icon('instagram')} Follow</a>` : ''}
      </div></div></section>`;
  }
  const sel = selectedDate();
  const st = dateStatus(sel);
  const pill = st === 'open' ? `<span class="pill pill-open">Taking orders</span>` : st === 'paused' ? `<span class="pill pill-paused">Orders paused</span>` : `<span class="pill pill-closed">Orders closed</span>`;
  const chips = up.length > 1 ? `<div class="date-chips" role="group" aria-label="Choose a date">${up.map((d) => {
    const s = dateStatus(d); const dt = parseDay(d.date);
    return `<button class="date-chip ${s !== 'open' ? 'closed' : ''}" data-date="${d.id}" aria-pressed="${d.id === sel.id}">
      <small>${dt.toLocaleDateString(site.brand.locale, { weekday: 'short' })}</small><b>${dt.getDate()}</b>
      <i>${s === 'open' ? dt.toLocaleDateString(site.brand.locale, { month: 'short' }) : s === 'paused' ? 'Paused' : 'Closed'}</i></button>`;
  }).join('')}</div>` : '';
  const left = st === 'open' ? timeLeft(sel.cutoff) : '';
  return `<section class="when card" aria-label="Ordering for">
    <div class="when-head"><div><p class="eyebrow">${up.length > 1 ? 'Ordering for' : 'Next cook-up'}</p><h2>${fmtDay(sel.date, 'long', site.brand.locale)}</h2></div>${pill}</div>
    ${chips}
    <div class="when-detail">
      ${sel.label ? `<div>${icon('sparkle')}<span><strong>${esc(sel.label)}</strong></span></div>` : ''}
      ${sel.window ? `<div>${icon('clock')}<span>Ready ${esc(sel.window)}</span></div>` : ''}
      ${sel.cutoff ? `<div>${icon('calendar')}<span>${st === 'open' ? `Order by <strong>${fmtCutoff(sel.cutoff, site.brand.locale)}</strong>${left ? ` · ${left} left` : ''}` : `Orders closed ${fmtCutoff(sel.cutoff, site.brand.locale)}`}</span></div>` : ''}
      ${sel.note ? `<div>${icon('info')}<span>${esc(sel.note)}</span></div>` : ''}
    </div>
  </section>`;
}

function newsHTML() {
  const list = activeAnnouncements(site).filter((a) => !dismissed.includes(a.id));
  if (!list.length) return '';
  const ic = { highlight: 'megaphone', info: 'info', important: 'flame' };
  return `<div class="news">${list.map((a) => `
    <div class="notice notice-${a.tone || 'highlight'}" role="note">${icon(ic[a.tone] || 'megaphone')}
      <div class="grow">${a.title ? `<b>${esc(a.title)}</b>` : ''}${a.text ? `<p>${esc(a.text)}</p>` : ''}</div>
      <button class="icon-btn x" data-dismiss="${esc(a.id)}" aria-label="Dismiss">${icon('x')}</button></div>`).join('')}</div>`;
}

function dishState(d, sel) {
  if (d.soldOut) return { cls: 'is-out', stamp: 'Sold out' };
  if (sel && !dishOnDate(d, sel.id)) {
    const days = dayLabels(d.dates);
    return { cls: 'is-elsewhere', stamp: days.length ? `Only ${days.join(', ')}` : 'Not this week' };
  }
  return { cls: '', stamp: '' };
}

function dishCard(d, sel) {
  const st = dishState(d, sel);
  const q = qtyInBag(d.id);
  const flag = d.tags.find((t) => ['popular', 'new', 'spicy'].includes(t));
  return `<article class="dish ${st.cls}" data-open="${esc(d.id)}">
    <div class="dish-photo">${photoHTML(d, { resolve })}
      ${flag ? `<span class="flag">${tagHTML(flag)}</span>` : ''}
      ${st.stamp ? `<span class="stamp">${esc(st.stamp)}</span>` : `<button class="add ${q ? 'has' : ''}" data-add="${esc(d.id)}" aria-label="${q ? `${q} in order. Add another ${esc(d.name)}` : `Add ${esc(d.name)}`}">${q ? q : icon('plus')}</button>`}
    </div>
    <div class="dish-body"><h3>${esc(d.name)}</h3>${d.subtitle ? `<p class="sub">${esc(d.subtitle)}</p>` : ''}
      <div class="dish-foot"><span class="price">${money(d.price, site)}${d.unit ? ` <small>/ ${esc(d.unit)}</small>` : ''}</span></div></div>
  </article>`;
}

function homeView() {
  const b = site.brand;
  const sel = upcomingDates(site).length ? selectedDate() : null;
  const dishes = visibleDishes();
  const featured = dishes.filter((d) => d.featured && !d.soldOut);
  const cats = site.categories.filter((c) => dishes.some((d) => d.category === c));
  const uncategorized = dishes.filter((d) => !site.categories.includes(d.category));
  const heroImg = featured.find((d) => d.photo)?.photo || dishes.find((d) => d.photo)?.photo;
  const headline = esc(b.headline || b.name).replace(/,\s*(.+)$/, ',<br><em>$1</em>');
  return `${topbar()}
  <main>
    <section class="hero"><div class="wrap">
      <div>
        <p class="eyebrow">${esc(b.tagline || '')}</p>
        <h1>${headline}</h1>
        ${b.intro ? `<p class="lead">${esc(b.intro)}</p>` : ''}
      </div>
      ${heroImg ? `<div class="hero-art"><img src="${esc(resolve(heroImg))}" alt="" fetchpriority="high"><div class="sun"><img src="assets/img/mark.svg" alt=""></div></div>` : ''}
    </div></section>
    <div class="wrap">${whenPanel()}${newsHTML()}</div>

    ${featured.length ? `<section class="section"><div class="wrap">
      <div class="section-head"><div><h2>This weekend's favorites</h2><p>Swipe to see more →</p></div></div>
      <div class="rail">${featured.map((d) => { const st = dishState(d, sel); return `
        <button class="feature" data-open="${esc(d.id)}" aria-label="${esc(d.name)}, ${money(d.price, site)}">
          ${photoHTML(d, { resolve })}
          <span class="price-badge">${money(d.price, site)}</span>
          ${st.stamp ? `<span class="flag"><span class="tag">${esc(st.stamp)}</span></span>` : ''}
          <span class="meta"><h3>${esc(d.name)}</h3><span>${esc(d.subtitle || '')}</span></span>
        </button>`; }).join('')}</div>
    </div></section>` : ''}

    <nav class="catnav" aria-label="Menu sections"><div class="wrap">
      ${cats.map((c, i) => `<a class="chip ${i === 0 ? 'is-on' : ''}" href="#cat-${i}" data-cat="${i}">${esc(c)}</a>`).join('')}
    </div></nav>
    <div class="wrap" id="menu">
      ${cats.map((c, i) => `<section class="cat" id="cat-${i}" aria-labelledby="cat-h-${i}"><h2 id="cat-h-${i}">${esc(c)}</h2>
        <div class="grid">${dishes.filter((d) => d.category === c).map((d) => dishCard(d, sel)).join('')}</div></section>`).join('')}
      ${uncategorized.length ? `<section class="cat"><h2>More</h2><div class="grid">${uncategorized.map((d) => dishCard(d, sel)).join('')}</div></section>` : ''}
      ${!dishes.length ? `<div class="empty"><img src="assets/img/mark.svg" alt=""><h2>The menu is being cooked up</h2><p class="muted">Check back soon!</p></div>` : ''}

      <section class="section"><div class="section-head"><h2>How ordering works</h2></div>
        <div class="steps">
          <div class="step card"><div><b>Pick your dishes</b><p>Choose a date and fill your order. Every plate is cooked fresh for that day.</p></div></div>
          <div class="step card"><div><b>Send it by ${site.ordering.sendVia === 'sms' ? 'text' : 'WhatsApp or text'}</b><p>Your order is written up for you. Just hit send, no account needed.</p></div></div>
          <div class="step card"><div><b>Vasthie confirms</b><p>${esc(site.ordering.paymentNote || 'You get a reply with the details. Pay when you pick up.')}</p></div></div>
        </div>
      </section>
    </div>
  </main>
  ${footer()}`;
}

/* ---------- DISH SHEET ---------- */
function openDish(id, fromRoute) {
  const d = dishById(id);
  if (!d || d.hidden) { location.replace('#/'); return; }
  const existing = bag.items.find((i) => i.id === id);
  let qty = existing?.qty || 1;
  const sel = upcomingDates(site).length ? selectedDate() : null;
  const st = dishState(d, sel);
  const days = dayLabels(d.dates);
  const max = d.maxPerOrder || 20;
  const render = () => `
    <div class="photo">${photoHTML(d, { resolve, lazy: false })}<div class="grabber"></div>
      <button class="icon-btn on-photo" data-act="close" aria-label="Close">${icon('x')}</button></div>
    <div class="body">
      ${d.tags.length ? `<div class="tags">${d.tags.map(tagHTML).join('')}</div>` : ''}
      <div><h2 id="dish-title">${esc(d.name)}</h2>${d.subtitle ? `<p class="sub">${esc(d.subtitle)}</p>` : ''}</div>
      <p class="pricebig">${money(d.price, site)}${d.unit ? ` <small>/ ${esc(d.unit)}</small>` : ''}</p>
      ${d.description ? `<div class="desc">${paras(d.description)}</div>` : ''}
      ${d.soldOut ? `<div class="avail">${icon('info')}<span><b>Sold out for now.</b> Check back next cook-up, or message Vasthie to ask.</span></div>`
        : days.length ? `<div class="avail">${icon('calendar')}<span>Available <b>${days.join(', ')}</b> only.${st.cls ? ' Switch your date to order it.' : ''}</span></div>` : ''}
      <label class="field"><span>Special request <span class="faint">(optional)</span></span>
        <textarea class="textarea" id="dish-note" rows="2" maxlength="160" placeholder="e.g. extra pikliz, no onions…">${esc(existing?.note || '')}</textarea></label>
    </div>
    <div class="sheet-foot">
      ${d.soldOut ? `<button class="btn btn-primary" disabled>Sold out</button>` : `
      <div class="stepper lg"><button data-q="-1" aria-label="Fewer" ${qty <= (existing ? 0 : 1) ? 'disabled' : ''}>${icon('minus')}</button><output aria-live="polite">${qty}</output><button data-q="1" aria-label="More" ${qty >= max ? 'disabled' : ''}>${icon('plus')}</button></div>
      <button class="btn btn-primary" data-act="add-dish">${existing ? (qty ? 'Update' : 'Remove') : 'Add'}<span class="spacer"></span>${qty ? money(qty * d.price, site) : ''}</button>`}
    </div>`;
  const el = openSheet(render(), 'dsheet');
  el.setAttribute('aria-labelledby', 'dish-title');
  sheetFromRoute = !!fromRoute;
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-q],[data-act]'); if (!t) return;
    if (t.dataset.q) {
      qty = Math.max(existing ? 0 : 1, Math.min(max, qty + +t.dataset.q));
      const note = $('#dish-note', el).value;
      el.innerHTML = render(); $('#dish-note', el).value = note;
    } else if (t.dataset.act === 'close') requestClose();
    else if (t.dataset.act === 'add-dish') {
      const note = $('#dish-note', el).value.trim();
      setQty(d.id, qty, note);
      toast(qty ? (existing ? 'Order updated' : `${d.name} added`) : `${d.name} removed`);
      requestClose();
    }
  });
}

function setQty(id, qty, note) {
  const it = bag.items.find((i) => i.id === id);
  if (qty <= 0) bag.items = bag.items.filter((i) => i.id !== id);
  else if (it) { it.qty = qty; if (note !== undefined) it.note = note; }
  else bag.items.push({ id, qty, note: note || '' });
  saveBag();
  refreshBagUI();
}

/* Update counters without re-rendering the whole page (keeps scroll position). */
function refreshBagUI() {
  document.querySelectorAll('[data-add]').forEach((b) => {
    const q = qtyInBag(b.dataset.add);
    b.classList.toggle('has', !!q);
    b.innerHTML = q ? q : icon('plus');
  });
  renderBagbar(true);
}

function renderBagbar(bump) {
  let bar = $('.bagbar');
  if (!bar) { bar = document.createElement('div'); bar.className = 'bagbar'; document.body.append(bar); }
  const n = bagCount();
  const show = n > 0 && (route().name === 'home');
  if (n) {
    const t = orderTotals(site, bagLines(), null);
    bar.innerHTML = `<a href="#/order" aria-label="View order: ${n} items, ${money(t.subtotal, site)}"><span class="count">${n}</span><span class="lbl">View order</span><span class="tot">${money(t.subtotal, site)}</span></a>`;
  }
  bar.classList.toggle('in', show);
  if (bump && show) { bar.classList.remove('bump'); void bar.offsetWidth; bar.classList.add('bump'); }
}

/* ---------- CONTACT SHEET ---------- */
function openContact() {
  const c = site.contact, b = site.brand;
  const hello = `Hi ${b.name}! `;
  const rows = [
    c.whatsapp && ['wa', 'whatsapp', 'WhatsApp', 'Usually the fastest reply', waLink(c.whatsapp, hello), true],
    c.phone && ['sms', 'sms', 'Send a text', c.phone, smsLink(c.phone, hello)],
    c.phone && ['tel', 'phone', 'Call', c.phone, telLink(c.phone)],
    c.instagram && ['ig', 'instagram', 'Instagram', '@' + String(c.instagram).replace(/^@/, ''), igLink(c.instagram), true],
    c.email && ['mail', 'mail', 'Email', c.email, mailLink(c.email, `Question for ${b.name}`)],
  ].filter(Boolean);
  const el = openSheet(`<div class="grabber"></div><div class="csheet">
    <h2 id="c-title">Talk to Vasthie</h2><p>Questions, big orders, catering for a party? Send a message and she'll get back to you.</p>
    <div class="clist">${rows.map(([k, ic, t, s, href, ext]) => `
      <a class="crow" href="${esc(href)}" ${ext ? 'target="_blank" rel="noopener"' : ''}><span class="ico ico-${k}">${icon(ic)}</span>
      <span class="grow"><b>${t}</b><small>${esc(s)}</small></span>${icon('next')}</a>`).join('') || '<p class="muted">Contact details are coming soon.</p>'}</div>
    ${site.about.area ? `<p class="hint" style="margin-top:16px;display:flex;gap:8px">${icon('pin')}<span>${esc(site.about.area)}</span></p>` : ''}
  </div>`, 'contact');
  el.setAttribute('aria-labelledby', 'c-title');
}

/* ---------- ORDER (checkout) ---------- */
function orderView() {
  const lines = bagLines();
  if (!lines.length) {
    return `${pagebar('Your order')}<main class="wrap narrow"><div class="empty">
      <img src="assets/img/mark.svg" alt=""><h2>Your order is empty</h2><p class="muted">Browse the menu and add a few plates.</p>
      <a class="btn btn-primary" href="#/">See the menu</a></div></main>`;
  }
  const up = upcomingDates(site);
  const open = up.filter((d) => dateStatus(d) === 'open');
  if (!bag.dateId || !open.some((d) => d.id === bag.dateId)) bag.dateId = open[0]?.id || null;
  const ful = site.ordering.fulfillment;
  if (!ful.some((f) => f.id === bag.fulfillmentId)) bag.fulfillmentId = ful[0]?.id;
  const f = ful.find((x) => x.id === bag.fulfillmentId);
  const t = orderTotals(site, lines, bag.fulfillmentId);
  const via = site.ordering.sendVia;
  const c = site.contact;
  const canWa = via !== 'sms' && c.whatsapp;
  const canSms = via !== 'whatsapp' && (c.phone || c.whatsapp);

  return `${pagebar('Your order', `<button class="ghost-link" data-act="clear">Clear</button>`)}
  <main class="wrap narrow" style="padding-bottom:48px">
    <section class="block" style="margin-top:8px"><div class="lines card">
      ${lines.map((l) => {
        const unavailable = bag.dateId && !dishOnDate(l.dish, bag.dateId);
        return `<div class="line">
          <div class="thumb">${photoHTML(l.dish, { resolve })}</div>
          <div><b>${esc(l.dish.name)}</b><small>${money(l.dish.price, site)}${l.dish.unit ? ` / ${esc(l.dish.unit)}` : ''}</small>
            ${l.note ? `<small class="note">“${esc(l.note)}”</small>` : ''}
            ${l.dish.soldOut ? `<small class="warn">Sold out, please remove</small>` : unavailable ? `<small class="warn">Not available on this date</small>` : ''}
            <button class="textlink" style="padding:4px 0;font-size:13px" data-open="${esc(l.dish.id)}">Edit</button></div>
          <div class="right"><b>${money(l.qty * l.dish.price, site)}</b>
            <div class="stepper"><button data-line="${esc(l.dish.id)}" data-d="-1" aria-label="Fewer ${esc(l.dish.name)}">${icon(l.qty === 1 ? 'trash' : 'minus')}</button><output>${l.qty}</output><button data-line="${esc(l.dish.id)}" data-d="1" aria-label="More ${esc(l.dish.name)}">${icon('plus')}</button></div></div>
        </div>`; }).join('')}
    </div><a class="add-more" href="#/">${icon('plus')} Add more dishes</a></section>

    <section class="block" id="f-date"><h2>When${open.length ? '' : ' <small>No open dates</small>'}</h2>
      ${open.length ? `<div class="options" role="radiogroup">${open.map((d) => `
        <label class="option"><input type="radio" name="date" value="${d.id}" ${d.id === bag.dateId ? 'checked' : ''}><span class="dot"></span>
          <span class="grow"><b>${fmtDay(d.date, 'long', site.brand.locale)}</b><small>${[d.label, d.window && `Ready ${d.window}`, d.cutoff && `order by ${fmtCutoff(d.cutoff, site.brand.locale)}`].filter(Boolean).map(esc).join(' · ')}</small></span></label>`).join('')}</div>`
      : `<div class="errbox">Orders are closed for now. Check back soon, or message Vasthie.</div>`}
      ${errors.date ? `<p class="err" style="margin-top:8px">${esc(errors.date)}</p>` : ''}
    </section>

    <section class="block"><h2>How</h2><div class="options" role="radiogroup">
      ${ful.map((x) => `<label class="option"><input type="radio" name="ful" value="${esc(x.id)}" ${x.id === bag.fulfillmentId ? 'checked' : ''}><span class="dot"></span>
        <span class="grow"><b>${esc(x.label)}</b>${x.note ? `<small>${esc(x.note)}</small>` : ''}</span><b>${+x.fee ? `+${money(x.fee, site)}` : 'Free'}</b></label>`).join('')}
    </div></section>

    <section class="block"><h2>Your details</h2><div style="display:grid;gap:14px">
      <label class="field" id="f-name"><span>Your name</span><input class="input ${errors.name ? 'is-invalid' : ''}" name="name" autocomplete="name" value="${esc(bag.name)}" placeholder="So Vasthie knows who's ordering">
        ${errors.name ? `<span class="err">${esc(errors.name)}</span>` : ''}</label>
      ${f?.needsAddress ? `<label class="field" id="f-address"><span>Delivery address</span><textarea class="textarea ${errors.address ? 'is-invalid' : ''}" name="address" rows="2" autocomplete="street-address" placeholder="Street, apt, city">${esc(bag.address)}</textarea>
        ${errors.address ? `<span class="err">${esc(errors.address)}</span>` : ''}</label>` : ''}
      <label class="field"><span>Note for Vasthie <span class="faint">(optional)</span></span><textarea class="textarea" name="note" rows="2" placeholder="Allergies, preferred pickup time, a party order…">${esc(bag.note)}</textarea></label>
    </div></section>

    <section class="block"><div class="summary card">
      <div class="row"><span>Subtotal</span><span>${money(t.subtotal, site)}</span></div>
      ${t.fee ? `<div class="row"><span>${esc(f.label)}</span><span>${money(t.fee, site)}</span></div>` : ''}
      <div class="row total"><span>Total</span><span>${money(t.total, site)}</span></div>
    </div>
    ${site.ordering.paymentNote ? `<div class="payment">${icon('heart')}<span>${esc(site.ordering.paymentNote)}</span></div>` : ''}
    </section>

    ${errors.general ? `<div class="errbox" role="alert">${esc(errors.general)}</div>` : ''}
    <div class="send">
      ${canWa ? `<button class="btn btn-wa btn-block" data-send="wa" ${open.length ? '' : 'disabled'}>${icon('whatsapp')} Send order on WhatsApp</button>` : ''}
      ${canSms ? `<button class="btn ${canWa ? 'btn-ghost' : 'btn-primary'} btn-block" data-send="sms" ${open.length ? '' : 'disabled'}>${icon('sms')} Send by text message</button>` : ''}
    </div>
    <p class="fine">${esc(site.ordering.confirmNote || '')} Tapping send opens your messaging app with the order already written.</p>
  </main>`;
}

function pagebar(title, right = '<span style="width:44px"></span>') {
  return `${PREVIEW ? `<div class="preview-banner">Preview of unpublished changes</div>` : ''}
  <header class="pagebar"><div class="wrap narrow"><a class="icon-btn" href="#/" aria-label="Back to menu">${icon('back')}</a><h1>${title}</h1>${right}</div></header>`;
}

function readForm() {
  const v = (n) => document.querySelector(`[name="${n}"]`);
  if (v('name')) bag.name = v('name').value.trim();
  if (v('address')) bag.address = v('address').value.trim();
  if (v('note')) bag.note = v('note').value.trim();
  saveBag();
}

function validate() {
  errors = {};
  const lines = bagLines();
  const f = site.ordering.fulfillment.find((x) => x.id === bag.fulfillmentId);
  const date = site.dates.find((d) => d.id === bag.dateId);
  if (!date || dateStatus(date) !== 'open') errors.date = 'Please choose a date.';
  else {
    const bad = lines.filter((l) => !dishOnDate(l.dish, date.id)).map((l) => l.dish.name);
    if (bad.length) errors.date = `${bad.join(', ')} ${bad.length > 1 ? "aren't" : "isn't"} available on ${fmtDay(date.date, 'short', site.brand.locale)}. Pick another date or remove ${bad.length > 1 ? 'them' : 'it'}.`;
  }
  const out = lines.filter((l) => l.dish.soldOut);
  if (out.length) errors.general = `${out.map((l) => l.dish.name).join(', ')} sold out. Please remove ${out.length > 1 ? 'them' : 'it'} from your order.`;
  if (!bag.name) errors.name = 'Please add your name.';
  if (f?.needsAddress && !bag.address) errors.address = 'Please add a delivery address.';
  const min = +site.ordering.minOrder || 0;
  if (min && orderTotals(site, lines, null).subtotal < min) errors.general = `The minimum order is ${money(min, site)}.`;
  return !Object.keys(errors).length;
}

function sendOrder(channel) {
  readForm();
  if (!validate()) {
    render();
    const first = $('#f-date .err') ? '#f-date' : errors.name ? '#f-name' : errors.address ? '#f-address' : '.errbox';
    $(first)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const lines = bagLines();
  const o = { code: orderCode(), dateId: bag.dateId, fulfillmentId: bag.fulfillmentId, name: bag.name, address: bag.address, note: bag.note, lines };
  const message = orderMessage(site, o);
  const c = site.contact;
  const link = channel === 'wa' ? waLink(c.whatsapp, message) : smsLink(c.phone || c.whatsapp, message);
  last = {
    code: o.code, message, channel, at: Date.now(), dateId: o.dateId, fulfillmentId: o.fulfillmentId, address: o.address,
    lines: lines.map((l) => ({ name: l.dish.name, qty: l.qty, price: l.dish.price, note: l.note })),
    totals: orderTotals(site, lines, o.fulfillmentId),
  };
  store.set(LAST_KEY, last);
  bag.items = []; bag.note = ''; saveBag();
  location.hash = '#/sent';
  if (channel === 'wa') window.open(link, '_blank', 'noopener'); else location.href = link;
}

/* ---------- SENT ---------- */
function sentView() {
  if (!last) { location.replace('#/'); return ''; }
  const date = site.dates.find((d) => d.id === last.dateId);
  const f = site.ordering.fulfillment.find((x) => x.id === last.fulfillmentId);
  const c = site.contact;
  const isWa = last.channel === 'wa';
  const other = isWa ? (c.phone || c.whatsapp) && site.ordering.sendVia !== 'whatsapp' && smsLink(c.phone || c.whatsapp, last.message)
    : c.whatsapp && site.ordering.sendVia !== 'sms' && waLink(c.whatsapp, last.message);
  return `${pagebar('Order', '<span style="width:44px"></span>')}
  <main class="wrap narrow"><div class="sent">
    <div class="burst"><img src="assets/img/mark.svg" alt=""></div>
    <p class="eyebrow">Mèsi anpil!</p>
    <h1>Almost done.<br>Just hit send.</h1>
    <p class="lead">Your order is written in ${isWa ? 'WhatsApp' : 'your messages app'}. Send it, and Vasthie will reply to confirm. ${esc(site.ordering.paymentNote || '')}</p>
    <div class="receipt card">
      <div class="code">ORDER ${esc(last.code)}</div>
      <div class="rmeta">
        ${date ? `<div>${icon('calendar')}${fmtDay(date.date, 'long', site.brand.locale)}${date.window ? ` · ${esc(date.window)}` : ''}</div>` : ''}
        ${f ? `<div>${icon('pin')}${esc(f.label)}${f.needsAddress && last.address ? `: ${esc(last.address)}` : ''}</div>` : ''}
      </div>
      ${last.lines.map((l) => `<div class="rline"><span>${l.qty} × ${esc(l.name)}</span><span>${money(l.qty * l.price, site)}</span></div>`).join('')}
      ${last.totals.fee ? `<div class="rline faint"><span>${esc(f?.label || 'Fee')}</span><span>${money(last.totals.fee, site)}</span></div>` : ''}
      <div class="rline" style="font-weight:700;font-size:18px;border-top:1.5px dashed var(--line-strong);margin-top:6px;padding-top:12px"><span>Total</span><span>${money(last.totals.total, site)}</span></div>
    </div>
    <div class="actions">
      <a class="btn ${isWa ? 'btn-wa' : 'btn-primary'} btn-block" ${isWa ? 'target="_blank" rel="noopener"' : ''} href="${esc(isWa ? waLink(c.whatsapp, last.message) : smsLink(c.phone || c.whatsapp, last.message))}">${icon(isWa ? 'whatsapp' : 'sms')} ${isWa ? 'Open WhatsApp again' : 'Open messages again'}</a>
      <button class="btn btn-ghost btn-block" data-act="copy">${icon('copy')} Copy order text</button>
      ${other ? `<a class="textlink" href="${esc(other)}" ${isWa ? '' : 'target="_blank" rel="noopener"'}>Send by ${isWa ? 'text message' : 'WhatsApp'} instead</a>` : ''}
      <a class="textlink" href="#/">Back to the menu</a>
    </div>
  </div></main>`;
}

/* ---------- ABOUT ---------- */
function aboutView() {
  const a = site.about, c = site.contact;
  const up = upcomingDates(site);
  return `${pagebar('About')}
  <main class="wrap narrow about" style="padding-bottom:40px">
    ${a.photo ? `<div class="about-photo"><img src="${esc(resolve(a.photo))}" alt=""></div>` : ''}
    <p class="eyebrow" style="margin-top:22px">${esc(site.brand.tagline || '')}</p>
    <h1>${esc(a.title || site.brand.name)}</h1>
    <div class="story">${paras(a.text || '')}</div>

    <section class="block"><h2>Upcoming cook-ups</h2>
      ${up.length ? `<div class="dates-list card">${up.map((d) => { const dt = parseDay(d.date); const s = dateStatus(d); return `
        <div class="drow"><div class="cal"><small>${dt.toLocaleDateString(site.brand.locale, { month: 'short' })}</small><b>${dt.getDate()}</b></div>
        <div class="grow"><b>${fmtDay(d.date, 'long', site.brand.locale)}</b><small>${[d.label, d.window].filter(Boolean).map(esc).join(' · ')}</small></div>
        <span class="pill ${s === 'open' ? 'pill-open' : s === 'paused' ? 'pill-paused' : 'pill-closed'}">${s === 'open' ? 'Open' : s === 'paused' ? 'Paused' : 'Closed'}</span></div>`; }).join('')}</div>`
      : `<p class="muted">No dates yet. Follow along to hear about the next one!</p>`}
    </section>

    ${a.area ? `<section class="block"><h2>Pickup & delivery</h2><div class="card" style="padding:16px;display:flex;gap:12px">${icon('pin')}<span>${esc(a.area)}</span></div></section>` : ''}

    <section class="block"><h2>Get in touch</h2>
      <button class="btn btn-dark btn-block" data-act="contact">${icon('chat')} Contact Vasthie</button>
      ${c.instagram ? `<a class="btn btn-ghost btn-block" style="margin-top:10px" target="_blank" rel="noopener" href="${igLink(c.instagram)}">${icon('instagram')} @${esc(String(c.instagram).replace(/^@/, ''))}</a>` : ''}
    </section>
    <p class="fine" style="margin-top:32px"><a href="images/CREDITS.md">Photo credits</a></p>
  </main>`;
}

/* ---------- router ---------- */
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, arg] = h.split('/');
  if (name === 'dish') return { name: 'home', dish: arg };
  if (['order', 'sent', 'about'].includes(name)) return { name };
  return { name: 'home' };
}

let currentView = null;
function render() {
  const r = route();
  if (r.name !== currentView || r.name !== 'home') {
    const html = r.name === 'order' ? orderView() : r.name === 'sent' ? sentView() : r.name === 'about' ? aboutView() : homeView();
    if (r.name !== currentView) window.scrollTo(0, 0);
    app.innerHTML = html;
    currentView = r.name;
    document.title = r.name === 'home' ? `${site.brand.name} · ${site.brand.tagline || ''}` : `${{ order: 'Your order', sent: 'Order ready to send', about: 'About' }[r.name]} · ${site.brand.name}`;
    if (r.name === 'home') setupScrollSpy();
  }
  if (r.dish) openDish(r.dish, true);
  else if (sheetEl && sheetEl.classList.contains('dsheet')) closeSheet();
  renderBagbar();
}

window.addEventListener('hashchange', () => {
  const r = route();
  if (r.name === 'home' && currentView === 'home' && !r.dish && !location.hash.startsWith('#cat')) { if (sheetEl) closeSheet(); renderBagbar(); return; }
  if (location.hash.startsWith('#cat-')) return;
  errors = {};
  render();
});

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-add],[data-open],[data-act],[data-date],[data-dismiss],[data-line],[data-send],[data-cat]');
  if (!t) return;
  if (t.dataset.add) {
    e.stopPropagation();
    const d = dishById(t.dataset.add);
    setQty(d.id, qtyInBag(d.id) + 1);
    toast(`${d.name} added`);
    return;
  }
  if (t.dataset.open) { history.pushState({ inApp: true }, '', `#/dish/${t.dataset.open}`); openDish(t.dataset.open, true); return; }
  if (t.dataset.date) {
    bag.dateId = t.dataset.date; saveBag();
    const y = window.scrollY; currentView = null; render(); window.scrollTo(0, y);
    return;
  }
  if (t.dataset.dismiss) { dismissed.push(t.dataset.dismiss); store.set(DISMISS_KEY, dismissed); t.closest('.notice').remove(); return; }
  if (t.dataset.line) { readForm(); const q = qtyInBag(t.dataset.line) + +t.dataset.d; setQty(t.dataset.line, q); render(); return; }
  if (t.dataset.send) { sendOrder(t.dataset.send); return; }
  if (t.dataset.cat) {
    e.preventDefault();
    document.getElementById(`cat-${t.dataset.cat}`)?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  switch (t.dataset.act) {
    case 'contact': openContact(); break;
    case 'clear':
      if (confirm('Remove everything from your order?')) { bag.items = []; saveBag(); render(); }
      break;
    case 'copy':
      navigator.clipboard?.writeText(last.message).then(() => toast('Order copied. Paste it in any chat.', 'copy'), () => prompt('Copy your order:', last.message));
      break;
  }
});

document.addEventListener('change', (e) => {
  if (e.target.name === 'date') { readForm(); bag.dateId = e.target.value; saveBag(); errors = {}; const y = scrollY; render(); scrollTo(0, y); }
  if (e.target.name === 'ful') { readForm(); bag.fulfillmentId = e.target.value; saveBag(); const y = scrollY; render(); scrollTo(0, y); }
});
document.addEventListener('input', (e) => { if (['name', 'address', 'note'].includes(e.target.name)) { bag[e.target.name] = e.target.value; saveBag(); } });

/* Sticky header shadow + category scroll-spy */
let spy;
function setupScrollSpy() {
  spy?.disconnect();
  const chips = [...document.querySelectorAll('.catnav .chip')];
  if (!chips.length || !('IntersectionObserver' in window)) return;
  spy = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) {
      const i = en.target.id.split('-')[1];
      chips.forEach((c) => c.classList.toggle('is-on', c.dataset.cat === i));
      const on = chips[i]; on?.parentElement.scrollTo({ left: on.offsetLeft - 16, behavior: 'smooth' });
    }
  }, { rootMargin: '-140px 0px -60% 0px' });
  document.querySelectorAll('.cat[id]').forEach((s) => spy.observe(s));
}
addEventListener('scroll', () => $('.topbar')?.classList.toggle('scrolled', scrollY > 8), { passive: true });

/* ---------- boot ---------- */
async function boot() {
  app.innerHTML = `<div class="loading"><img src="assets/img/mark.svg" alt="Loading"></div>`;
  try {
    const draft = PREVIEW && store.get(DRAFT_KEY);
    if (draft?.site) { site = normalize(draft.site); setupPreview(); }
    else site = await loadPublishedSite();
  } catch (err) {
    app.innerHTML = `<div class="empty"><img src="assets/img/mark.svg" alt=""><h2>We couldn't load the menu</h2><p class="muted">Check your connection and try again.</p><button class="btn btn-primary" onclick="location.reload()">Try again</button></div>`;
    return;
  }
  render();
}
boot();

if ('serviceWorker' in navigator && !PREVIEW && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
