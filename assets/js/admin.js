import {
  DRAFT_KEY, REPO_KEY, TAGS, store, normalize, money, esc, uid, slug, fmtDay, fmtCutoff, todayISO, parseDay,
  upcomingDates, dateStatus, icon, photoHTML,
} from './shared.js';

const $ = (s, el = document) => el.querySelector(s);
const root = $('#admin');

let repo = store.get(REPO_KEY);       // { owner, repo, branch, token } or { demo: true }
let draft = null;                     // { site, base (published JSON string), sha }
let tab = sessionStorage.getItem('shashou.tab') || 'menu';
const S = () => draft.site;

/* ======================= GitHub ======================= */
const gh = {
  async req(path, opts = {}) {
    const res = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}${path}`, {
      ...opts,
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${repo.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) },
    });
    if (!res.ok) {
      let msg = `GitHub said ${res.status}`;
      try { msg = (await res.json()).message || msg; } catch {}
      const e = new Error(msg); e.status = res.status; throw e;
    }
    return res.status === 204 ? null : res.json();
  },
  async getFile(path) {
    const j = await this.req(`/contents/${path}?ref=${encodeURIComponent(repo.branch)}&t=${Date.now()}`);
    return { text: b64decode(j.content), sha: j.sha };
  },
  async putFile(path, base64, message, sha) {
    return this.req(`/contents/${path}`, { method: 'PUT', body: JSON.stringify({ message, content: base64, branch: repo.branch, ...(sha ? { sha } : {}) }) });
  },
};
function b64encode(str) { const bytes = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); }
function b64decode(b64) { const bin = atob(b64.replace(/\n/g, '')); return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))); }
const connected = () => repo && !repo.demo && repo.token;

/* Show new photos straight from the repo; GitHub Pages takes a minute to catch up. */
function resolve(p) {
  if (!p || /^(data:|https?:|blob:)/.test(p)) return p;
  if (connected()) return `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${repo.branch}/${p}`;
  return p;
}

/* ======================= draft ======================= */
const json = (site) => JSON.stringify(site, null, 2) + '\n';
const dirty = () => draft && json(S()) !== draft.base;
function save() { store.set(DRAFT_KEY, draft) || toast('Phone storage is full. Publish soon so nothing is lost.', 'info'); updateChrome(); }

async function loadPublished() {
  if (connected()) {
    const f = await gh.getFile('data/site.json');
    return { text: f.text, sha: f.sha };
  }
  const res = await fetch(`data/site.json?t=${Date.now()}`, { cache: 'no-store' });
  return { text: await res.text(), sha: null };
}

/* ======================= UI helpers ======================= */
let toastTimer;
function toast(msg, ic = 'check') {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.innerHTML = `${icon(ic)}<span>${esc(msg)}</span>`;
  requestAnimationFrame(() => t.classList.add('in'));
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('in'), 2600);
}

let sheetEl, scrimEl;
function openSheet(html, cls = '') {
  closeSheet(true);
  scrimEl = document.createElement('div'); scrimEl.className = 'scrim';
  sheetEl = document.createElement('div'); sheetEl.className = `sheet ${cls}`;
  sheetEl.setAttribute('role', 'dialog'); sheetEl.setAttribute('aria-modal', 'true');
  sheetEl.innerHTML = html;
  document.body.append(scrimEl, sheetEl);
  document.body.style.overflow = 'hidden';
  scrimEl.addEventListener('click', () => closeSheet());
  requestAnimationFrame(() => { scrimEl.classList.add('in'); sheetEl.classList.add('in'); });
  return sheetEl;
}
function closeSheet(now) {
  if (!sheetEl) return;
  const s = sheetEl, sc = scrimEl; sheetEl = scrimEl = null; document.body.style.overflow = '';
  if (now) { s.remove(); sc.remove(); return; }
  s.classList.remove('in'); sc.classList.remove('in'); setTimeout(() => { s.remove(); sc.remove(); }, 320);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

const sw = (name, checked, cls = '') => `<label class="switch ${cls}"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span></span></label>`;
const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; };

/* ======================= image handling ======================= */
async function resizeImage(file, max = 1400, quality = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  } finally { URL.revokeObjectURL(url); }
}
/** Returns a path in the repo (connected) or a data: URL (demo mode). */
async function storePhoto(file, name) {
  if (!connected()) return resizeImage(file, 900, 0.75);
  const dataUrl = await resizeImage(file);
  const path = `images/dishes/${slug(name)}-${Date.now().toString(36)}.jpg`;
  await gh.putFile(path, dataUrl.split(',')[1], `Add photo: ${name}`);
  return path;
}
function photoPicker(current, label = 'Add a photo', small = false) {
  return `<div class="photo-pick ${current ? 'has' : ''} ${small ? 'photo-sm' : ''}" data-photo>
    ${current ? `<img src="${esc(resolve(current))}" alt="">` : `<span class="cta">${icon('camera')}${label}<small class="faint" style="font-weight:500">Take one or choose from your photos</small></span>`}
    <input type="file" accept="image/*" aria-label="${label}">
    ${current ? `<div class="over"><span class="pill-btn">${icon('camera')} Change</span><button type="button" class="pill-btn" data-remove-photo>${icon('trash')} Remove</button></div>` : ''}
  </div>`;
}
function wirePhoto(el, getName, onDone) {
  const box = $('[data-photo]', el); if (!box) return;
  $('input', box).addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    box.classList.add('busy');
    try { onDone(await storePhoto(file, getName())); }
    catch (err) { toast(`Photo upload failed: ${err.message}`, 'info'); box.classList.remove('busy'); }
  });
  $('[data-remove-photo]', box)?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onDone(''); });
}

/* ======================= shell ======================= */
function shell() {
  const tabs = [['menu', 'utensils', 'Menu'], ['dates', 'calendar', 'Dates'], ['news', 'megaphone', 'News'], ['settings', 'sliders', 'Settings']];
  root.innerHTML = `
  <header class="a-top"><div class="a-wrap">
    <img class="mark" src="assets/img/mark.svg" alt="">
    <div class="ttl"><b>Kitchen</b><small>${esc(S().brand.name)}${connected() ? '' : ' · demo mode'}</small></div>
    <a class="icon-btn" href="index.html?preview" target="_blank" rel="noopener" aria-label="Preview the site">${icon('eye')}</a>
    <button class="btn btn-primary btn-sm pub" data-act="publish">${icon('send')} Publish<span class="dot" hidden></span></button>
  </div></header>
  <main class="a-main"><div class="a-wrap" id="view"></div></main>
  <nav class="tabbar" aria-label="Sections"><div class="a-wrap">
    ${tabs.map(([k, ic, l]) => `<button data-tab="${k}" ${tab === k ? 'aria-current="page"' : ''}>${icon(ic)}${l}</button>`).join('')}
  </div></nav>
  <div id="fab"></div>`;
  renderTab();
}
function updateChrome() {
  const d = dirty();
  const dot = $('.pub .dot'); if (dot) dot.hidden = !d;
  const u = $('#unsaved'); if (u) u.hidden = !d;
}
function unsavedBanner() {
  return `<div class="unsaved" id="unsaved" ${dirty() ? '' : 'hidden'}>${icon('info')}<span class="grow">You have changes customers can't see yet.</span><button class="btn btn-dark btn-sm" data-act="publish">Publish</button></div>`;
}
function renderTab() {
  document.querySelectorAll('.tabbar button').forEach((b) => (b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  const v = $('#view');
  v.innerHTML = unsavedBanner() + ({ menu: menuTab, dates: datesTab, news: newsTab, settings: settingsTab }[tab])();
  $('#fab').innerHTML = { menu: `<button class="fab" data-act="new-dish">${icon('plus')} Add dish</button>`, dates: `<button class="fab" data-act="new-date">${icon('plus')} Add date</button>`, news: `<button class="fab" data-act="new-news">${icon('plus')} New post</button>` }[tab] || '';
  if (tab === 'settings') wireSettings(v);
  updateChrome();
}

/* ======================= MENU ======================= */
function dateChipLabel(id) { const d = S().dates.find((x) => x.id === id); return d ? fmtDay(d.date, 'short') : null; }
function menuTab() {
  const s = S();
  const out = s.dishes.filter((d) => d.soldOut).length;
  const cats = [...s.categories, ...(s.dishes.some((d) => !s.categories.includes(d.category)) ? [null] : [])];
  return `<div class="a-h1"><div><h1>Menu</h1><p>${s.dishes.length} dishes${out ? ` · ${out} sold out` : ''}</p></div>
    <button class="btn btn-ghost btn-sm" data-act="categories">${icon('edit')} Categories</button></div>
    ${!s.dishes.length ? `<div class="list empty-card"><img src="assets/img/mark.svg" alt=""><h3>Add your first dish</h3><p>Snap a photo, set a price, and it shows up on your menu.</p></div>` : ''}
    ${cats.map((c) => {
      const list = s.dishes.filter((d) => (c === null ? !s.categories.includes(d.category) : d.category === c));
      if (!list.length && c === null) return '';
      return `<section class="group"><h2>${esc(c ?? 'No category')}<span>${list.length}</span></h2><div class="list">
        ${list.length ? list.map((d) => {
          const days = (d.dates || []).map(dateChipLabel).filter(Boolean);
          return `<div class="item tap ${d.hidden ? 'is-muted' : ''}" data-dish="${esc(d.id)}">
            <div class="thumb">${photoHTML(d, { resolve })}</div>
            <div class="grow"><b>${esc(d.name || 'Untitled')}</b><small>${money(d.price, s)}${d.unit ? ` / ${esc(d.unit)}` : ''}</small>
              <div class="badges">${d.soldOut ? '<span class="tag badge-out">Sold out</span>' : ''}${d.hidden ? '<span class="tag badge-hidden">Hidden</span>' : ''}${d.featured ? `<span class="tag tag-popular">${icon('star')}Favorite</span>` : ''}${days.length ? `<span class="tag">${icon('calendar')}${days.join(', ')}</span>` : ''}</div></div>
            <label class="sw" data-stop>${sw(`avail-${d.id}`, !d.soldOut)}<span>${d.soldOut ? 'Sold out' : 'Available'}</span></label>
          </div>`; }).join('') : `<div class="item"><small>No dishes yet in this category.</small></div>`}
      </div></section>`; }).join('')}`;
}

function dishEditor(id) {
  const s = S();
  const isNew = !id;
  const d = isNew ? { id: uid('dish-'), name: '', subtitle: '', category: s.categories[0] || '', price: '', unit: 'plate', description: '', photo: '', tags: [], featured: false, soldOut: false, hidden: false, dates: [] }
    : structuredClone(s.dishes.find((x) => x.id === id));
  const up = upcomingDates(s);
  const render = () => `<div class="ed">
    <div class="ed-head"><button class="icon-btn" data-x aria-label="Close">${icon('x')}</button><h2>${isNew ? 'New dish' : 'Edit dish'}</h2><span style="width:40px"></span></div>
    <form class="ed-body" novalidate>
      ${photoPicker(d.photo)}
      <label class="field"><span>Name</span><input class="input" name="name" value="${esc(d.name)}" placeholder="e.g. Griot" required></label>
      <label class="field"><span>Short description <span class="faint">(optional)</span></span><input class="input" name="subtitle" value="${esc(d.subtitle)}" placeholder="e.g. Crispy fried pork"></label>
      <div class="row2">
        <label class="field"><span>Price</span><input class="input" name="price" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(d.price)}" placeholder="18"></label>
        <label class="field"><span>Per</span><input class="input" name="unit" value="${esc(d.unit)}" list="units" placeholder="plate"></label>
      </div>
      <datalist id="units"><option>plate</option><option>bowl</option><option>quart</option><option>tray (serves 6)</option><option>each</option><option>dozen</option><option>16 oz jar</option><option>slice</option></datalist>
      <label class="field"><span>Category</span><select class="select" name="category">
        ${s.categories.map((c) => `<option ${c === d.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="__new">+ New category…</option></select></label>
      <label class="field"><span>Full description</span><textarea class="textarea" name="description" rows="4" placeholder="What's in it, how it's made, what it comes with…">${esc(d.description)}</textarea></label>
      <div class="field"><span>Labels</span><div class="chips">${Object.entries(TAGS).map(([k, t]) => `<button type="button" class="chip" data-tag="${k}" aria-pressed="${d.tags.includes(k)}">${icon(t.icon)}${t.label}</button>`).join('')}</div></div>
      <div class="field"><span>When is it available?</span>
        <div class="chips"><button type="button" class="chip" data-alldates aria-pressed="${!d.dates.length}">Every cook-up</button>
        ${up.map((x) => `<button type="button" class="chip" data-date="${x.id}" aria-pressed="${d.dates.includes(x.id)}">${fmtDay(x.date, 'short')}</button>`).join('')}</div>
        <small>Pick specific dates for specials, like soup joumou on Sundays.</small></div>
      <div class="list">
        <label class="toggle-row"><span class="grow"><b>Sold out</b><small>Still shown, but customers can't order it</small></span>${sw('soldOut', d.soldOut, 'danger')}</label>
        <label class="toggle-row"><span class="grow"><b>Favorite</b><small>Shown big at the top of the menu</small></span>${sw('featured', d.featured)}</label>
        <label class="toggle-row"><span class="grow"><b>Hide from menu</b><small>Keep it saved for later</small></span>${sw('hidden', d.hidden)}</label>
      </div>
      <label class="field"><span>Max per order <span class="faint">(optional)</span></span><input class="input" name="maxPerOrder" type="number" inputmode="numeric" min="1" value="${esc(d.maxPerOrder || '')}" placeholder="No limit"></label>
      ${isNew ? '' : `<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div style="display:flex;gap:8px"><button type="button" class="btn btn-soft btn-sm" data-move="-1">${icon('up')} Move up</button><button type="button" class="btn btn-soft btn-sm" data-move="1">${icon('down')} Move down</button></div>
        <button type="button" class="danger-link" data-del>${icon('trash')} Delete dish</button></div>`}
      <p class="err" id="ed-err" hidden></p>
    </form>
    <div class="ed-foot"><button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" data-save>${isNew ? 'Add to menu' : 'Save'}</button></div></div>`;
  const el = openSheet(render(), 'full');
  const readForm = () => {
    const f = $('form', el); const v = (n) => f.elements[n];
    d.name = v('name').value.trim(); d.subtitle = v('subtitle').value.trim(); d.price = v('price').value === '' ? '' : +v('price').value;
    d.unit = v('unit').value.trim(); d.description = v('description').value.trim(); d.soldOut = v('soldOut').checked;
    d.featured = v('featured').checked; d.hidden = v('hidden').checked; d.maxPerOrder = +v('maxPerOrder').value || undefined;
    if (v('category').value !== '__new') d.category = v('category').value;
  };
  const rerender = () => { readForm(); el.innerHTML = render(); wire(); };
  const wire = () => {
    wirePhoto(el, () => $('[name=name]', el).value || 'dish', (p) => { readForm(); d.photo = p; el.innerHTML = render(); wire(); });
    $('[name=category]', el).addEventListener('change', (e) => {
      if (e.target.value !== '__new') return;
      const name = prompt('Name of the new category')?.trim();
      if (name) { if (!s.categories.includes(name)) s.categories.push(name); d.category = name; save(); }
      rerender();
    });
  };
  wire();
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.tag) { t.setAttribute('aria-pressed', t.getAttribute('aria-pressed') !== 'true'); d.tags = [...el.querySelectorAll('[data-tag][aria-pressed="true"]')].map((x) => x.dataset.tag); }
    else if (t.hasAttribute('data-alldates')) { d.dates = []; rerender(); }
    else if (t.dataset.date) { d.dates = d.dates.includes(t.dataset.date) ? d.dates.filter((x) => x !== t.dataset.date) : [...d.dates, t.dataset.date]; rerender(); }
    else if (t.hasAttribute('data-x')) closeSheet();
    else if (t.dataset.move) {
      const i = s.dishes.findIndex((x) => x.id === d.id);
      // move within the same category
      const same = s.dishes.map((x, k) => [x, k]).filter(([x]) => x.category === s.dishes[i].category).map(([, k]) => k);
      const pos = same.indexOf(i); const j = same[pos + +t.dataset.move];
      if (j === undefined) return toast(+t.dataset.move < 0 ? 'Already first' : 'Already last', 'info');
      [s.dishes[i], s.dishes[j]] = [s.dishes[j], s.dishes[i]]; save(); renderTab(); toast('Moved');
    } else if (t.hasAttribute('data-del')) {
      if (confirm(`Delete “${d.name}” from the menu?`)) { s.dishes = s.dishes.filter((x) => x.id !== d.id); save(); closeSheet(); renderTab(); toast('Dish deleted'); }
    } else if (t.hasAttribute('data-save')) {
      readForm();
      const err = !d.name ? 'Give the dish a name.' : (d.price === '' || isNaN(d.price)) ? 'Add a price.' : '';
      if (err) { const p = $('#ed-err', el); p.textContent = err; p.hidden = false; p.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
      if (!d.maxPerOrder) delete d.maxPerOrder;
      if (isNew) s.dishes.push(d); else s.dishes[s.dishes.findIndex((x) => x.id === d.id)] = d;
      if (d.category && !s.categories.includes(d.category)) s.categories.push(d.category);
      save(); closeSheet(); renderTab(); toast(isNew ? `${d.name} added` : 'Saved');
    }
  });
}

function categoriesEditor() {
  const s = S();
  const render = () => `<div class="ed">
    <div class="ed-head"><button class="icon-btn" data-x aria-label="Close">${icon('x')}</button><h2>Categories</h2><span style="width:40px"></span></div>
    <div class="ed-body"><p class="muted">Sections of your menu, in the order customers see them.</p>
    <div class="list">${s.categories.map((c, i) => `<div class="item"><div class="grow"><input class="input" data-cat="${i}" value="${esc(c)}" aria-label="Category name"></div>
      <button class="icon-btn plain" data-up="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
      <button class="icon-btn plain" data-rm="${i}" aria-label="Delete">${icon('trash')}</button></div>`).join('')}</div>
    <button class="btn btn-soft" data-add>${icon('plus')} Add category</button></div>
    <div class="ed-foot"><button class="btn btn-primary" data-x>Done</button></div></div>`;
  const el = openSheet(render(), 'full');
  el.addEventListener('change', (e) => {
    const i = e.target.dataset.cat; if (i === undefined) return;
    const old = s.categories[i], name = e.target.value.trim(); if (!name) { e.target.value = old; return; }
    s.categories[i] = name; s.dishes.forEach((d) => { if (d.category === old) d.category = name; }); save();
  });
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.hasAttribute('data-x')) { closeSheet(); renderTab(); return; }
    if (t.dataset.up) { const i = +t.dataset.up; [s.categories[i - 1], s.categories[i]] = [s.categories[i], s.categories[i - 1]]; }
    if (t.dataset.rm) {
      const i = +t.dataset.rm, c = s.categories[i]; const n = s.dishes.filter((d) => d.category === c).length;
      if (n) return toast(`Move or delete the ${n} dish${n > 1 ? 'es' : ''} in “${c}” first`, 'info');
      s.categories.splice(i, 1);
    }
    if (t.hasAttribute('data-add')) s.categories.push('New category');
    save(); el.innerHTML = render();
  });
}

/* ======================= DATES ======================= */
function datesTab() {
  const s = S();
  const up = upcomingDates(s);
  const past = s.dates.filter((d) => dateStatus(d) === 'past').sort((a, b) => b.date.localeCompare(a.date));
  const row = (d) => {
    const st = dateStatus(d); const dt = parseDay(d.date);
    const special = s.dishes.filter((x) => x.dates?.includes(d.id)).length;
    return `<div class="item tap ${st === 'past' ? 'past is-muted' : ''}" data-dateid="${d.id}">
      <div class="cal"><small>${dt.toLocaleDateString('en-US', { month: 'short' })}</small><b>${dt.getDate()}</b></div>
      <div class="grow"><b>${fmtDay(d.date)}${d.label ? ` · ${esc(d.label)}` : ''}</b>
        <small>${[d.window && `Ready ${esc(d.window)}`, d.cutoff && `orders close ${fmtCutoff(d.cutoff)}`].filter(Boolean).join(' · ') || 'No times set'}</small>
        <div class="badges">${st === 'open' ? '<span class="tag tag-vegan">Taking orders</span>' : st === 'paused' ? '<span class="tag tag-popular">Paused</span>' : st === 'closed' ? '<span class="tag">Orders closed</span>' : ''}${special ? `<span class="tag">${special} special${special > 1 ? 's' : ''}</span>` : ''}</div></div>
      ${st !== 'past' ? `<label class="sw" data-stop>${sw(`open-${d.id}`, !d.paused)}<span>${d.paused ? 'Paused' : 'Open'}</span></label>` : ''}
    </div>`;
  };
  return `<div class="a-h1"><div><h1>Cook-up dates</h1><p>Customers can only order for these days.</p></div></div>
    <div class="add-row"><button class="btn btn-soft btn-sm" data-quick="6">${icon('plus')} Next Saturday</button><button class="btn btn-soft btn-sm" data-quick="0">${icon('plus')} Next Sunday</button></div>
    <section class="group"><h2>Coming up</h2>${up.length ? `<div class="list">${up.map(row).join('')}</div>`
      : `<div class="list empty-card"><img src="assets/img/mark.svg" alt=""><h3>No dates yet</h3><p>Add your next cook-up so customers can start ordering.</p></div>`}</section>
    ${past.length ? `<section class="group"><h2>Past<button data-act="clear-past">Remove all</button></h2><div class="list">${past.slice(0, 6).map(row).join('')}</div></section>` : ''}`;
}

function nextWeekday(dow) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const taken = new Set(S().dates.map((x) => x.date));
  do { d.setDate(d.getDate() + 1); } while (d.getDay() !== dow || taken.has(todayISO(d)));
  return todayISO(d);
}
function defaultCutoff(iso, daysBefore = 2) { const d = parseDay(iso); d.setDate(d.getDate() - daysBefore); return `${todayISO(d)}T20:00`; }

function dateEditor(id, presetDate) {
  const s = S();
  const isNew = !id;
  const lastDate = [...s.dates].sort((a, b) => b.date.localeCompare(a.date))[0];
  const d = isNew ? { id: uid('d'), date: presetDate || nextWeekday(6), label: '', window: lastDate?.window || '12:00 – 5:00 pm', cutoff: '', paused: false, note: '' }
    : structuredClone(s.dates.find((x) => x.id === id));
  if (isNew) d.cutoff = defaultCutoff(d.date);
  const render = () => `<div class="ed">
    <div class="ed-head"><button class="icon-btn" data-x aria-label="Close">${icon('x')}</button><h2>${isNew ? 'New date' : 'Edit date'}</h2><span style="width:40px"></span></div>
    <form class="ed-body" novalidate>
      <label class="field"><span>Day</span><input class="input" type="date" name="date" value="${d.date}" min="${todayISO()}"></label>
      <label class="field"><span>Name <span class="faint">(optional)</span></span><input class="input" name="label" value="${esc(d.label)}" placeholder="e.g. Soup joumou Sunday, Thanksgiving trays"></label>
      <label class="field"><span>Pickup hours</span><input class="input" name="window" value="${esc(d.window)}" placeholder="12:00 – 5:00 pm">
        <div class="presets">${['11:00 am – 3:00 pm', '12:00 – 5:00 pm', '4:00 – 8:00 pm'].map((p) => `<button type="button" data-win="${p}">${p}</button>`).join('')}</div></label>
      <label class="field"><span>Last moment to order</span><input class="input" type="datetime-local" name="cutoff" value="${esc(d.cutoff)}">
        <div class="presets"><button type="button" data-cut="2">2 days before, 8 pm</button><button type="button" data-cut="1">Day before, 8 pm</button><button type="button" data-cut="none">No limit</button></div></label>
      <label class="field"><span>Note for customers <span class="faint">(optional)</span></span><input class="input" name="note" value="${esc(d.note)}" placeholder="e.g. Limited to 30 plates"></label>
      <div class="list"><label class="toggle-row"><span class="grow"><b>Taking orders</b><small>Turn off to pause orders for this day</small></span>${sw('open', !d.paused)}</label></div>
      ${isNew ? '' : `<button type="button" class="danger-link" data-del>${icon('trash')} Delete this date</button>`}
      <p class="err" id="ed-err" hidden></p>
    </form>
    <div class="ed-foot"><button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" data-save>${isNew ? 'Add date' : 'Save'}</button></div></div>`;
  const el = openSheet(render(), 'full');
  const readForm = () => { const f = $('form', el).elements; d.date = f.date.value; d.label = f.label.value.trim(); d.window = f.window.value.trim(); d.cutoff = f.cutoff.value; d.note = f.note.value.trim(); d.paused = !f.open.checked; };
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.win) { $('[name=window]', el).value = t.dataset.win; }
    else if (t.dataset.cut) { readForm(); $('[name=cutoff]', el).value = t.dataset.cut === 'none' ? '' : defaultCutoff(d.date, +t.dataset.cut); }
    else if (t.hasAttribute('data-x')) closeSheet();
    else if (t.hasAttribute('data-del')) {
      if (!confirm(`Delete ${fmtDay(d.date)}?`)) return;
      s.dates = s.dates.filter((x) => x.id !== d.id); s.dishes.forEach((x) => { x.dates = (x.dates || []).filter((y) => y !== d.id); });
      save(); closeSheet(); renderTab(); toast('Date deleted');
    } else if (t.hasAttribute('data-save')) {
      readForm();
      const err = !d.date ? 'Pick a day.' : s.dates.some((x) => x.date === d.date && x.id !== d.id) ? 'You already have this day.' : '';
      if (err) { const p = $('#ed-err', el); p.textContent = err; p.hidden = false; return; }
      if (isNew) s.dates.push(d); else s.dates[s.dates.findIndex((x) => x.id === d.id)] = d;
      s.dates.sort((a, b) => a.date.localeCompare(b.date));
      save(); closeSheet(); renderTab(); toast(isNew ? `${fmtDay(d.date, 'short')} added` : 'Saved');
    }
  });
}

/* ======================= NEWS ======================= */
const TONES = { highlight: 'Highlight', info: 'Info', important: 'Urgent' };
function newsTab() {
  const s = S(); const today = todayISO();
  return `<div class="a-h1"><div><h1>Announcements</h1><p>Short news shown at the top of your menu.</p></div></div>
    ${s.announcements.length ? `<div class="list">${s.announcements.map((a) => {
      const expired = a.until && a.until < today;
      return `<div class="item tap ${a.active === false || expired ? 'is-muted' : ''}" data-news="${esc(a.id)}">
        <span class="notice-${a.tone || 'highlight'}" style="width:10px;align-self:stretch;border-radius:5px;flex:none"></span>
        <div class="grow"><b>${esc(a.title || a.text)}</b><small>${expired ? 'Ended' : a.until ? `Shows until ${fmtDay(a.until, 'short')}` : 'No end date'}</small></div>
        <label class="sw" data-stop>${sw(`news-${a.id}`, a.active !== false && !expired)}<span>${a.active === false || expired ? 'Off' : 'On'}</span></label></div>`; }).join('')}</div>`
    : `<div class="list empty-card"><img src="assets/img/mark.svg" alt=""><h3>Nothing to announce?</h3><p>Use posts for specials, holiday hours, or "only 10 plates left!"</p></div>`}`;
}
function newsEditor(id) {
  const s = S(); const isNew = !id;
  const a = isNew ? { id: uid('a'), title: '', text: '', tone: 'highlight', until: '', active: true } : structuredClone(s.announcements.find((x) => x.id === id));
  const el = openSheet(`<div class="ed">
    <div class="ed-head"><button class="icon-btn" data-x aria-label="Close">${icon('x')}</button><h2>${isNew ? 'New post' : 'Edit post'}</h2><span style="width:40px"></span></div>
    <form class="ed-body" novalidate>
      <label class="field"><span>Title</span><input class="input" name="title" value="${esc(a.title)}" placeholder="e.g. Soup joumou is back"></label>
      <label class="field"><span>Message</span><textarea class="textarea" name="text" rows="3" placeholder="e.g. Sunday only, and there are just 20 quarts!">${esc(a.text)}</textarea></label>
      <div class="field"><span>Style</span><div class="tone-opts">${Object.entries(TONES).map(([k, l]) => `<label class="notice-${k}"><input type="radio" name="tone" value="${k}" ${a.tone === k ? 'checked' : ''}>${l}</label>`).join('')}</div></div>
      <label class="field"><span>Show until <span class="faint">(optional)</span></span><input class="input" type="date" name="until" value="${esc(a.until)}"><small>After this day it hides by itself.</small></label>
      <div class="list"><label class="toggle-row"><span class="grow"><b>Show on the site</b></span>${sw('active', a.active !== false)}</label></div>
      ${isNew ? '' : `<button type="button" class="danger-link" data-del>${icon('trash')} Delete post</button>`}
    </form>
    <div class="ed-foot"><button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" data-save>${isNew ? 'Post it' : 'Save'}</button></div></div>`, 'full');
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.hasAttribute('data-x')) closeSheet();
    else if (t.hasAttribute('data-del')) { if (confirm('Delete this post?')) { s.announcements = s.announcements.filter((x) => x.id !== a.id); save(); closeSheet(); renderTab(); } }
    else if (t.hasAttribute('data-save')) {
      const f = $('form', el).elements;
      Object.assign(a, { title: f.title.value.trim(), text: f.text.value.trim(), tone: f.tone.value || 'highlight', until: f.until.value, active: f.active.checked });
      if (!a.title && !a.text) return toast('Write a title or a message', 'info');
      if (isNew) s.announcements.unshift(a); else s.announcements[s.announcements.findIndex((x) => x.id === a.id)] = a;
      save(); closeSheet(); renderTab(); toast(isNew ? 'Posted (publish to make it live)' : 'Saved');
    }
  });
}

/* ======================= SETTINGS ======================= */
function settingsTab() {
  const s = S(); const o = s.ordering;
  const f = (path, label, opts = {}) => {
    const v = getPath(s, path) ?? '';
    const input = opts.area ? `<textarea class="textarea" data-bind="${path}" rows="${opts.rows || 3}" placeholder="${esc(opts.ph || '')}">${esc(v)}</textarea>`
      : `<input class="input" data-bind="${path}" value="${esc(v)}" placeholder="${esc(opts.ph || '')}" ${opts.type ? `type="${opts.type}"` : ''} ${opts.mode ? `inputmode="${opts.mode}"` : ''}>`;
    return `<label class="field"><span>${label}</span>${input}${opts.hint ? `<small>${opts.hint}</small>` : ''}</label>`;
  };
  return `<div class="a-h1"><div><h1>Settings</h1><p>Your info, contact and how orders work.</p></div></div>
  <section class="group"><h2>Contact</h2><div class="list" style="padding:16px;display:grid;gap:14px">
    ${f('contact.whatsapp', 'WhatsApp number', { type: 'tel', ph: '+1 555 555 0123', hint: 'Include the country code. Orders are sent here.' })}
    ${f('contact.phone', 'Phone for texts & calls', { type: 'tel', ph: '+1 555 555 0123' })}
    ${f('contact.instagram', 'Instagram', { ph: 'chezshashou' })}
    <div class="row2">${f('contact.facebook', 'Facebook', { ph: 'page name' })}${f('contact.tiktok', 'TikTok', { ph: 'username' })}</div>
    ${f('contact.email', 'Email', { type: 'email', ph: 'you@example.com' })}
  </div></section>

  <section class="group"><h2>Orders</h2><div class="list" style="padding:16px;display:grid;gap:14px">
    <label class="field"><span>Customers send orders by</span><select class="select" data-bind="ordering.sendVia">
      ${[['both', 'WhatsApp or text message'], ['whatsapp', 'WhatsApp only'], ['sms', 'Text message only']].map(([k, l]) => `<option value="${k}" ${o.sendVia === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    ${f('ordering.paymentNote', 'How customers pay', { ph: 'Pay at pickup: cash, Zelle or Cash App' })}
    ${f('ordering.confirmNote', 'Note under the send button', { ph: 'Your order is confirmed once Vasthie replies.' })}
    <div class="row2">${f('ordering.minOrder', 'Minimum order', { type: 'number', mode: 'decimal', ph: '0' })}
      <label class="field"><span>Currency</span><select class="select" data-bind="brand.currency">${['USD', 'CAD', 'EUR', 'GBP', 'HTG'].map((c) => `<option ${s.brand.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div>
  </div></section>

  <section class="group"><h2>Pickup & delivery<button data-act="add-ful">+ Add option</button></h2><div class="fulf">
    ${o.fulfillment.map((x, i) => `<div class="card">
      <div class="row2">${f(`ordering.fulfillment.${i}.label`, 'Name', { ph: 'Pickup' })}${f(`ordering.fulfillment.${i}.fee`, 'Fee', { type: 'number', mode: 'decimal', ph: '0' })}</div>
      ${f(`ordering.fulfillment.${i}.note`, 'Details', { ph: 'e.g. Within 5 miles' })}
      <label class="toggle-row" style="padding:4px 0;border:0"><span class="grow"><b>Ask for an address</b></span><label class="switch"><input type="checkbox" data-bind="ordering.fulfillment.${i}.needsAddress" ${x.needsAddress ? 'checked' : ''}><span></span></label></label>
      ${o.fulfillment.length > 1 ? `<button class="danger-link" data-rmful="${i}">${icon('trash')} Remove</button>` : ''}
    </div>`).join('')}
    ${f('about.area', 'Where do people pick up?', { area: true, rows: 2, ph: 'Pickup in the neighborhood. Address sent on confirmation.', hint: 'Shown on the site. Keep your exact address private if you like.' })}
  </div></section>

  <section class="group"><h2>Your brand</h2><div class="list" style="padding:16px;display:grid;gap:14px">
    ${f('brand.name', 'Business name')}
    ${f('brand.tagline', 'Tagline', { ph: 'Haitian home cooking by Vasthie' })}
    ${f('brand.headline', 'Big headline', { ph: 'Manje lakay, made with love.', hint: 'Text after the comma shows in red italics.' })}
    ${f('brand.intro', 'Intro', { area: true, rows: 3 })}
  </div></section>

  <section class="group"><h2>About you</h2><div class="list" style="padding:16px;display:grid;gap:14px">
    <div class="field" id="about-photo"><span>Photo</span>${photoPicker(s.about.photo, 'Add a photo of you or your food', true)}</div>
    ${f('about.title', 'Title', { ph: "Bonjou, I'm Vasthie" })}
    ${f('about.text', 'Your story', { area: true, rows: 7, hint: 'Leave an empty line between paragraphs.' })}
  </div></section>

  <section class="group"><h2>Publishing</h2><div class="list">
    <div class="item">${icon('github')}<div class="grow"><b>${connected() ? `${esc(repo.owner)}/${esc(repo.repo)}` : 'Not connected (demo mode)'}</b><small>${connected() ? `Branch ${esc(repo.branch)}` : 'Changes stay on this phone until you connect'}</small></div>
      <button class="btn btn-ghost btn-sm" data-act="${connected() ? 'disconnect' : 'connect'}">${connected() ? 'Sign out' : 'Connect'}</button></div>
    <button class="item tap" data-act="export">${icon('download')}<div class="grow"><b>Download a backup</b><small>Saves site.json to your phone</small></div>${icon('next', 'chev')}</button>
    <label class="item tap">${icon('upload')}<div class="grow"><b>Restore from a backup</b><small>Load a site.json file</small></div><input type="file" accept="application/json,.json" data-import hidden>${icon('next', 'chev')}</label>
    <button class="item tap" data-act="discard">${icon('refresh')}<div class="grow"><b>Discard unpublished changes</b><small>Go back to what's live on the site</small></div>${icon('next', 'chev')}</button>
  </div></section>`;
}
function wireSettings(v) {
  wirePhoto($('#about-photo', v), () => 'about', (p) => { S().about.photo = p; save(); renderTab(); });
  $('[data-import]', v)?.addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { draft.site = normalize(JSON.parse(await file.text())); save(); renderTab(); toast('Backup loaded (publish to make it live)'); }
    catch { toast("That file doesn't look like a site.json backup", 'info'); }
  });
}
document.addEventListener('input', onBind);
document.addEventListener('change', onBind);
function onBind(e) {
  const p = e.target.dataset?.bind; if (!p) return;
  let val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (e.target.type === 'number') val = val === '' ? 0 : +val;
  setPath(S(), p, val);
  save();
  if (p === 'brand.name') $('.a-top .ttl small').textContent = val;
}

/* ======================= PUBLISH ======================= */
async function publish() {
  if (!connected()) {
    const el = openSheet(`<div class="grabber"></div><div class="done"><img src="assets/img/mark.svg" alt="" style="animation:none">
      <h2>Connect to publish</h2><p>You're in demo mode, so your changes are saved on this phone only. Connect your GitHub repository to put them on the live site, or download a backup.</p>
      <button class="btn btn-primary" data-act="connect">${icon('github')} Connect</button>
      <button class="btn btn-ghost" data-act="export">${icon('download')} Download site.json</button></div>`);
    return;
  }
  if (!dirty()) { toast('Everything is already live'); return; }
  const el = openSheet(`<div class="grabber"></div><div class="done"><img src="assets/img/mark.svg" alt=""><h2>Publishing…</h2><p>Sending your changes to the site.</p><div class="progress"><i></i></div></div>`);
  try {
    const site = S();
    // Photos added in demo mode are still data: URLs; upload them first.
    const photoHolders = [...site.dishes.map((d) => [d, d.name]), [site.about, 'about']];
    for (const [obj, name] of photoHolders) {
      if (obj.photo?.startsWith('data:')) {
        const path = `images/dishes/${slug(name)}-${Date.now().toString(36)}.jpg`;
        await gh.putFile(path, obj.photo.split(',')[1], `Add photo: ${name}`);
        obj.photo = path;
      }
    }
    let current;
    try { current = await gh.getFile('data/site.json'); } catch (e) { if (e.status !== 404) throw e; }
    if (current && draft.sha && current.sha !== draft.sha && json(normalize(JSON.parse(current.text))) !== draft.base) {
      if (!confirm('The site was changed from another device since you started editing. Publish anyway and replace those changes?')) { closeSheet(); return; }
    }
    const text = json(site);
    const res = await gh.putFile('data/site.json', b64encode(text), 'Update menu from the kitchen editor', current?.sha);
    draft.base = text; draft.sha = res.content.sha; save();
    const live = `https://${repo.owner.toLowerCase()}.github.io/${repo.repo}/`;
    el.innerHTML = `<div class="grabber"></div><div class="done"><img src="assets/img/mark.svg" alt="">
      <h2>Published!</h2><p>Your site updates in about a minute. Customers may need to refresh.</p>
      <a class="btn btn-primary" href="${esc(live)}" target="_blank" rel="noopener">${icon('external')} View the live site</a>
      <button class="btn btn-ghost" data-close>Keep editing</button></div>`;
    $('[data-close]', el).onclick = () => closeSheet();
    renderTab();
  } catch (err) {
    el.innerHTML = `<div class="grabber"></div><div class="done"><h2>Couldn't publish</h2><p>${esc(err.message)}</p>
      <p class="hint">${err.status === 401 ? 'Your access key may have expired. Sign out, then connect again with a new one.' : 'Check your connection and try again. Your changes are still saved on this phone.'}</p>
      <button class="btn btn-primary" data-retry>Try again</button><button class="btn btn-ghost" data-close>Close</button></div>`;
    $('[data-retry]', el).onclick = () => publish();
    $('[data-close]', el).onclick = () => closeSheet();
  }
}

function exportJSON() {
  const blob = new Blob([json(S())], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'site.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ======================= CONNECT ======================= */
function guessRepo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  if (!m) return { owner: '', repo: '' };
  return { owner: m[1], repo: location.pathname.split('/').filter(Boolean)[0] || `${m[1]}.github.io` };
}
function connectScreen(msg = '') {
  closeSheet(true);
  const g = repo && !repo.demo ? repo : { ...guessRepo(), branch: 'main' };
  root.innerHTML = `<div class="connect"><form class="box" novalidate>
    <img class="hero-mark" src="assets/img/mark.svg" alt="">
    <h1>Kitchen</h1>
    <p class="lead">Sign in to edit your menu, dates and news. You only need to do this once on each phone.</p>
    ${msg ? `<div class="errbox" style="background:var(--piman-tint);color:var(--piman-deep);padding:12px 14px;border-radius:12px;font-weight:600">${esc(msg)}</div>` : ''}
    <label class="field"><span>Repository</span><input class="input" name="full" value="${esc(g.owner && g.repo ? `${g.owner}/${g.repo}` : '')}" placeholder="username/restaurant" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
    <label class="field"><span>Branch</span><input class="input" name="branch" value="${esc(g.branch || 'main')}" autocapitalize="off"></label>
    <label class="field"><span>Access key (GitHub token)</span><input class="input" name="token" type="password" autocomplete="off" placeholder="github_pat_…" value=""></label>
    <details><summary>How do I get an access key?</summary><ol>
      <li>On GitHub, open <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens</b>.</li>
      <li>Tap <b>Generate new token</b>. Name it “Kitchen”, and pick a long expiration.</li>
      <li>Under <b>Repository access</b>, choose <b>Only select repositories</b>, then pick this site's repository.</li>
      <li>Under <b>Permissions → Repository permissions</b>, set <b>Contents</b> to <b>Read and write</b>.</li>
      <li>Generate it, copy the key (it starts with <code>github_pat_</code>) and paste it above.</li>
    </ol></details>
    <button class="btn btn-primary btn-block" type="submit">${icon('github')} Connect</button>
    <button class="btn btn-ghost btn-block" type="button" data-demo>Look around first (demo mode)</button>
  </form></div>`;
  const form = $('form', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const [owner, name] = form.full.value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').split('/');
    const candidate = { owner, repo: name, branch: form.branch.value.trim() || 'main', token: form.token.value.trim() };
    if (!owner || !name || !candidate.token) return connectScreen('Fill in the repository and the access key.');
    const btn = $('[type=submit]', form); btn.disabled = true; btn.textContent = 'Checking…';
    repo = candidate;
    try {
      const r = await gh.req('');
      if (r.permissions && !r.permissions.push) throw new Error("This key can read the repository but can't save changes. Give it Contents: Read and write.");
      store.set(REPO_KEY, repo);
      store.remove(DRAFT_KEY);
      await start();
      toast('Connected. Welcome to your kitchen!');
    } catch (err) {
      repo = null;
      connectScreen(err.status === 401 ? "That access key didn't work. Double-check it and try again." : err.status === 404 ? "Couldn't find that repository with this key. Check the name, and that the key has access to it." : err.message);
    }
  });
  $('[data-demo]', root).onclick = async () => { repo = { demo: true }; store.set(REPO_KEY, repo); await start(); };
}

/* ======================= events ======================= */
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-stop]')) return; // switches inside tappable rows
  const t = e.target.closest('[data-tab],[data-act],[data-dish],[data-dateid],[data-news],[data-quick],[data-rmful]');
  if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; sessionStorage.setItem('shashou.tab', tab); renderTab(); scrollTo(0, 0); return; }
  if (t.dataset.dish) return dishEditor(t.dataset.dish);
  if (t.dataset.dateid) return dateEditor(t.dataset.dateid);
  if (t.dataset.news) return newsEditor(t.dataset.news);
  if (t.dataset.quick) return dateEditor(null, nextWeekday(+t.dataset.quick));
  if (t.dataset.rmful) { S().ordering.fulfillment.splice(+t.dataset.rmful, 1); save(); renderTab(); return; }
  switch (t.dataset.act) {
    case 'new-dish': return dishEditor(null);
    case 'new-date': return dateEditor(null);
    case 'new-news': return newsEditor(null);
    case 'categories': return categoriesEditor();
    case 'publish': return publish();
    case 'export': return exportJSON();
    case 'connect': return connectScreen();
    case 'add-ful': S().ordering.fulfillment.push({ id: uid('f'), label: 'New option', note: '', fee: 0, needsAddress: false }); save(); renderTab(); return;
    case 'clear-past': {
      const s = S(); const past = new Set(s.dates.filter((d) => dateStatus(d) === 'past').map((d) => d.id));
      s.dates = s.dates.filter((d) => !past.has(d.id)); s.dishes.forEach((d) => { d.dates = (d.dates || []).filter((x) => !past.has(x)); });
      save(); renderTab(); toast('Past dates removed'); return;
    }
    case 'discard':
      if (!dirty()) return toast('Nothing to discard');
      if (confirm('Throw away all changes that are not published yet?')) { draft.site = normalize(JSON.parse(draft.base)); save(); renderTab(); toast('Back to the live version'); }
      return;
    case 'disconnect':
      if (dirty() && !confirm('You have unpublished changes. Sign out anyway? They will be lost.')) return;
      store.remove(REPO_KEY); store.remove(DRAFT_KEY); repo = null; connectScreen(); return;
  }
});
/* Quick toggles on list rows */
document.addEventListener('change', (e) => {
  const n = e.target.name || ''; const s = draft && S(); if (!s) return;
  let m;
  if ((m = n.match(/^avail-(.+)$/))) { const d = s.dishes.find((x) => x.id === m[1]); d.soldOut = !e.target.checked; save(); renderTab(); toast(d.soldOut ? `${d.name} marked sold out` : `${d.name} is available`); }
  else if ((m = n.match(/^open-(.+)$/)) && e.target.closest('#view')) { const d = s.dates.find((x) => x.id === m[1]); d.paused = !e.target.checked; save(); renderTab(); toast(d.paused ? 'Orders paused for that day' : 'Taking orders again'); }
  else if ((m = n.match(/^news-(.+)$/))) { const a = s.announcements.find((x) => x.id === m[1]); a.active = e.target.checked; if (a.active && a.until && a.until < todayISO()) a.until = ''; save(); renderTab(); }
});
window.addEventListener('beforeunload', (e) => { if (dirty() && !connected()) { e.preventDefault(); } });

/* ======================= boot ======================= */
async function start() {
  root.innerHTML = `<div class="connect"><img class="hero-mark" src="assets/img/mark.svg" alt="Loading" style="width:72px;animation:spin 3s linear infinite"></div>`;
  let pub;
  try { pub = await loadPublished(); }
  catch (err) {
    if (err.status === 401 || err.status === 404) { store.remove(REPO_KEY); repo = null; return connectScreen('Your access key no longer works. Please connect again.'); }
    root.innerHTML = `<div class="connect"><div class="box" style="text-align:center"><h1>Can't reach the site</h1><p class="lead">${esc(err.message)}</p><button class="btn btn-primary" onclick="location.reload()">Try again</button></div></div>`;
    return;
  }
  pub.text = json(normalize(JSON.parse(pub.text))); // canonical form, so "unpublished changes" is accurate
  const saved = store.get(DRAFT_KEY);
  if (saved?.site && json(normalize(saved.site)) !== pub.text) {
    draft = saved; // keep unpublished work
    if (saved.sha && pub.sha && saved.sha !== pub.sha) toast('The live site changed elsewhere. Your unpublished edits are kept.', 'info');
    draft.base = pub.text; draft.sha = pub.sha;
  } else {
    draft = { site: normalize(JSON.parse(pub.text)), base: pub.text, sha: pub.sha };
  }
  draft.site = normalize(draft.site);
  save();
  shell();
}

if (!repo) connectScreen(); else start();
