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
      let msg = `Erreur GitHub ${res.status}`;
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
function save() { store.set(DRAFT_KEY, draft) || toast('La mémoire du téléphone est pleine. Publiez vite pour ne rien perdre.', 'info'); updateChrome(); }

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
  await gh.putFile(path, dataUrl.split(',')[1], `Ajout photo : ${name}`);
  return path;
}
function photoPicker(current, label = 'Ajouter une photo', small = false) {
  return `<div class="photo-pick ${current ? 'has' : ''} ${small ? 'photo-sm' : ''}" data-photo>
    ${current ? `<img src="${esc(resolve(current))}" alt="">` : `<span class="cta">${icon('camera')}${label}<small class="faint" style="font-weight:500">Prenez-en une ou choisissez dans vos photos</small></span>`}
    <input type="file" accept="image/*" aria-label="${label}">
    ${current ? `<div class="over"><span class="pill-btn">${icon('camera')} Changer</span><button type="button" class="pill-btn" data-remove-photo>${icon('trash')} Retirer</button></div>` : ''}
  </div>`;
}
function wirePhoto(el, getName, onDone) {
  const box = $('[data-photo]', el); if (!box) return;
  $('input', box).addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    box.classList.add('busy');
    try { onDone(await storePhoto(file, getName())); }
    catch (err) { toast(`Échec de l'envoi de la photo : ${err.message}`, 'info'); box.classList.remove('busy'); }
  });
  $('[data-remove-photo]', box)?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onDone(''); });
}

/* ======================= shell ======================= */
function shell() {
  const tabs = [['menu', 'utensils', 'Menu'], ['dates', 'calendar', 'Dates'], ['news', 'megaphone', 'Annonces'], ['settings', 'sliders', 'Réglages']];
  root.innerHTML = `
  <header class="a-top"><div class="a-wrap">
    <img class="mark" src="assets/img/mark.svg" alt="">
    <div class="ttl"><b>Cuisine</b><small>${esc(S().brand.name)}${connected() ? '' : ' · mode démo'}</small></div>
    <a class="icon-btn" href="index.html?preview" target="_blank" rel="noopener" aria-label="Aperçu du site">${icon('eye')}</a>
    <button class="btn btn-primary btn-sm pub" data-act="publish">${icon('send')} Publier<span class="dot" hidden></span></button>
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
  return `<div class="unsaved" id="unsaved" ${dirty() ? '' : 'hidden'}>${icon('info')}<span class="grow">Vous avez des modifications que les clients ne voient pas encore.</span><button class="btn btn-dark btn-sm" data-act="publish">Publier</button></div>`;
}
function renderTab() {
  document.querySelectorAll('.tabbar button').forEach((b) => (b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  const v = $('#view');
  v.innerHTML = unsavedBanner() + ({ menu: menuTab, dates: datesTab, news: newsTab, settings: settingsTab }[tab])();
  $('#fab').innerHTML = { menu: `<button class="fab" data-act="new-dish">${icon('plus')} Ajouter un plat</button>`, dates: `<button class="fab" data-act="new-date">${icon('plus')} Ajouter une date</button>`, news: `<button class="fab" data-act="new-news">${icon('plus')} Nouvelle annonce</button>` }[tab] || '';
  if (tab === 'settings') wireSettings(v);
  updateChrome();
}

/* ======================= MENU ======================= */
function dateChipLabel(id) { const d = S().dates.find((x) => x.id === id); return d ? fmtDay(d.date, 'short') : null; }
function menuTab() {
  const s = S();
  const out = s.dishes.filter((d) => d.soldOut).length;
  const cats = [...s.categories, ...(s.dishes.some((d) => !s.categories.includes(d.category)) ? [null] : [])];
  return `<div class="a-h1"><div><h1>Menu</h1><p>${s.dishes.length} plats${out ? ` · ${out} épuisé${out > 1 ? 's' : ''}` : ''}</p></div>
    <button class="btn btn-ghost btn-sm" data-act="categories">${icon('edit')} Catégories</button></div>
    ${!s.dishes.length ? `<div class="list empty-card"><img src="assets/img/mark.svg" alt=""><h3>Ajoutez votre premier plat</h3><p>Prenez une photo, fixez un prix, et il apparaît sur votre menu.</p></div>` : ''}
    ${cats.map((c) => {
      const list = s.dishes.filter((d) => (c === null ? !s.categories.includes(d.category) : d.category === c));
      if (!list.length && c === null) return '';
      return `<section class="group"><h2>${esc(c ?? 'Sans catégorie')}<span>${list.length}</span></h2><div class="list">
        ${list.length ? list.map((d) => {
          const days = (d.dates || []).map(dateChipLabel).filter(Boolean);
          return `<div class="item tap ${d.hidden ? 'is-muted' : ''}" data-dish="${esc(d.id)}">
            <div class="thumb">${photoHTML(d, { resolve })}</div>
            <div class="grow"><b>${esc(d.name || 'Sans nom')}</b><small>${money(d.price, s)}${d.unit ? ` / ${esc(d.unit)}` : ''}</small>
              <div class="badges">${d.soldOut ? '<span class="tag badge-out">Épuisé</span>' : ''}${d.hidden ? '<span class="tag badge-hidden">Masqué</span>' : ''}${d.featured ? `<span class="tag tag-popular">${icon('star')}Coup de cœur</span>` : ''}${days.length ? `<span class="tag">${icon('calendar')}${days.join(', ')}</span>` : ''}</div></div>
            <label class="sw" data-stop>${sw(`avail-${d.id}`, !d.soldOut)}<span>${d.soldOut ? 'Épuisé' : 'Disponible'}</span></label>
          </div>`; }).join('') : `<div class="item"><small>Pas encore de plat dans cette catégorie.</small></div>`}
      </div></section>`; }).join('')}`;
}

function dishEditor(id) {
  const s = S();
  const isNew = !id;
  const d = isNew ? { id: uid('dish-'), name: '', subtitle: '', category: s.categories[0] || '', price: '', unit: 'assiette', description: '', photo: '', tags: [], featured: false, soldOut: false, hidden: false, dates: [] }
    : structuredClone(s.dishes.find((x) => x.id === id));
  const up = upcomingDates(s);
  const render = () => `<div class="ed">
    <div class="ed-head"><button class="icon-btn" data-x aria-label="Fermer">${icon('x')}</button><h2>${isNew ? 'Nouveau plat' : 'Modifier le plat'}</h2><span style="width:40px"></span></div>
    <form class="ed-body" novalidate>
      ${photoPicker(d.photo)}
      <label class="field"><span>Nom</span><input class="input" name="name" value="${esc(d.name)}" placeholder="ex. Griot" required></label>
      <label class="field"><span>Courte description <span class="faint">(facultatif)</span></span><input class="input" name="subtitle" value="${esc(d.subtitle)}" placeholder="ex. Porc frit croustillant"></label>
      <div class="row2">
        <label class="field"><span>Prix</span><input class="input" name="price" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(d.price)}" placeholder="18"></label>
        <label class="field"><span>Par</span><input class="input" name="unit" value="${esc(d.unit)}" list="units" placeholder="assiette"></label>
      </div>
      <datalist id="units"><option>assiette</option><option>bol</option><option>litre</option><option>plateau (6 pers.)</option><option>pièce</option><option>douzaine</option><option>pot de 500 ml</option><option>part</option></datalist>
      <label class="field"><span>Catégorie</span><select class="select" name="category">
        ${s.categories.map((c) => `<option ${c === d.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="__new">+ Nouvelle catégorie…</option></select></label>
      <label class="field"><span>Description complète</span><textarea class="textarea" name="description" rows="4" placeholder="Ce qu'il y a dedans, comment c'est préparé, avec quoi c'est servi…">${esc(d.description)}</textarea></label>
      <div class="field"><span>Étiquettes</span><div class="chips">${Object.entries(TAGS).map(([k, t]) => `<button type="button" class="chip" data-tag="${k}" aria-pressed="${d.tags.includes(k)}">${icon(t.icon)}${t.label}</button>`).join('')}</div></div>
      <div class="field"><span>Quand est-il disponible ?</span>
        <div class="chips"><button type="button" class="chip" data-alldates aria-pressed="${!d.dates.length}">Toutes les dates</button>
        ${up.map((x) => `<button type="button" class="chip" data-date="${x.id}" aria-pressed="${d.dates.includes(x.id)}">${fmtDay(x.date, 'short')}</button>`).join('')}</div>
        <small>Choisissez des dates précises pour les spécialités, comme la soupe joumou le dimanche.</small></div>
      <div class="list">
        <label class="toggle-row"><span class="grow"><b>Épuisé</b><small>Toujours affiché, mais impossible à commander</small></span>${sw('soldOut', d.soldOut, 'danger')}</label>
        <label class="toggle-row"><span class="grow"><b>Coup de cœur</b><small>Affiché en grand en haut du menu</small></span>${sw('featured', d.featured)}</label>
        <label class="toggle-row"><span class="grow"><b>Masquer du menu</b><small>Le garder pour plus tard</small></span>${sw('hidden', d.hidden)}</label>
      </div>
      <label class="field"><span>Maximum par commande <span class="faint">(facultatif)</span></span><input class="input" name="maxPerOrder" type="number" inputmode="numeric" min="1" value="${esc(d.maxPerOrder || '')}" placeholder="Sans limite"></label>
      ${isNew ? '' : `<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div style="display:flex;gap:8px"><button type="button" class="btn btn-soft btn-sm" data-move="-1">${icon('up')} Monter</button><button type="button" class="btn btn-soft btn-sm" data-move="1">${icon('down')} Descendre</button></div>
        <button type="button" class="danger-link" data-del>${icon('trash')} Supprimer le plat</button></div>`}
      <p class="err" id="ed-err" hidden></p>
    </form>
    <div class="ed-foot"><button class="btn btn-ghost" data-x>Annuler</button><button class="btn btn-primary" data-save>${isNew ? 'Ajouter au menu' : 'Enregistrer'}</button></div></div>`;
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
      const name = prompt('Nom de la nouvelle catégorie')?.trim();
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
      if (j === undefined) return toast(+t.dataset.move < 0 ? 'Déjà en premier' : 'Déjà en dernier', 'info');
      [s.dishes[i], s.dishes[j]] = [s.dishes[j], s.dishes[i]]; save(); renderTab(); toast('Déplacé');
    } else if (t.hasAttribute('data-del')) {
      if (confirm(`Supprimer « ${d.name} » du menu ?`)) { s.dishes = s.dishes.filter((x) => x.id !== d.id); save(); closeSheet(); renderTab(); toast('Plat supprimé'); }
    } else if (t.hasAttribute('data-save')) {
      readForm();
      const err = !d.name ? 'Donnez un nom au plat.' : (d.price === '' || isNaN(d.price)) ? 'Ajoutez un prix.' : '';
      if (err) { const p = $('#ed-err', el); p.textContent = err; p.hidden = false; p.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
      if (!d.maxPerOrder) delete d.maxPerOrder;
      if (isNew) s.dishes.push(d); else s.dishes[s.dishes.findIndex((x) => x.id === d.id)] = d;
      if (d.category && !s.categories.includes(d.category)) s.categories.push(d.category);
      save(); closeSheet(); renderTab(); toast(isNew ? `${d.name} ajouté` : 'Enregistré');
    }
  });
}

function categoriesEditor() {
  const s = S();
  const render = () => `<div class="ed">
    <div class="ed-head"><button class="icon-btn" data-x aria-label="Fermer">${icon('x')}</button><h2>Catégories</h2><span style="width:40px"></span></div>
    <div class="ed-body"><p class="muted">Les sections de votre menu, dans l'ordre où les clients les voient.</p>
    <div class="list">${s.categories.map((c, i) => `<div class="item"><div class="grow"><input class="input" data-cat="${i}" value="${esc(c)}" aria-label="Nom de la catégorie"></div>
      <button class="icon-btn plain" data-up="${i}" aria-label="Monter" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
      <button class="icon-btn plain" data-rm="${i}" aria-label="Supprimer">${icon('trash')}</button></div>`).join('')}</div>
    <button class="btn btn-soft" data-add>${icon('plus')} Ajouter une catégorie</button></div>
    <div class="ed-foot"><button class="btn btn-primary" data-x>Terminé</button></div></div>`;
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
      if (n) return toast(`Déplacez ou supprimez d'abord ${n > 1 ? `les ${n} plats` : 'le plat'} de « ${c} »`, 'info');
      s.categories.splice(i, 1);
    }
    if (t.hasAttribute('data-add')) s.categories.push('Nouvelle catégorie');
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
      <div class="cal"><small>${dt.toLocaleDateString(S().brand.locale, { month: 'short' }).replace('.', '')}</small><b>${dt.getDate()}</b></div>
      <div class="grow"><b>${fmtDay(d.date)}${d.label ? ` · ${esc(d.label)}` : ''}</b>
        <small>${[d.window && `Prêt ${esc(d.window)}`, d.cutoff && `fin des commandes ${fmtCutoff(d.cutoff)}`].filter(Boolean).join(' · ') || 'Pas d\'horaires'}</small>
        <div class="badges">${st === 'open' ? '<span class="tag tag-vegan">Commandes ouvertes</span>' : st === 'paused' ? '<span class="tag tag-popular">En pause</span>' : st === 'closed' ? '<span class="tag">Commandes fermées</span>' : ''}${special ? `<span class="tag">${special} spécialité${special > 1 ? 's' : ''}</span>` : ''}</div></div>
      ${st !== 'past' ? `<label class="sw" data-stop>${sw(`open-${d.id}`, !d.paused)}<span>${d.paused ? 'En pause' : 'Ouvert'}</span></label>` : ''}
    </div>`;
  };
  return `<div class="a-h1"><div><h1>Dates de cuisine</h1><p>Les clients ne peuvent commander que pour ces jours.</p></div></div>
    <div class="add-row"><button class="btn btn-soft btn-sm" data-quick="6">${icon('plus')} Samedi prochain</button><button class="btn btn-soft btn-sm" data-quick="0">${icon('plus')} Dimanche prochain</button></div>
    <section class="group"><h2>À venir</h2>${up.length ? `<div class="list">${up.map(row).join('')}</div>`
      : `<div class="list empty-card"><img src="assets/img/mark.svg" alt=""><h3>Pas encore de date</h3><p>Ajoutez votre prochaine date pour que les clients puissent commander.</p></div>`}</section>
    ${past.length ? `<section class="group"><h2>Passées<button data-act="clear-past">Tout retirer</button></h2><div class="list">${past.slice(0, 6).map(row).join('')}</div></section>` : ''}`;
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
  const d = isNew ? { id: uid('d'), date: presetDate || nextWeekday(6), label: '', window: lastDate?.window || '12 h – 17 h', cutoff: '', paused: false, note: '' }
    : structuredClone(s.dates.find((x) => x.id === id));
  if (isNew) d.cutoff = defaultCutoff(d.date);
  const render = () => `<div class="ed">
    <div class="ed-head"><button class="icon-btn" data-x aria-label="Fermer">${icon('x')}</button><h2>${isNew ? 'Nouvelle date' : 'Modifier la date'}</h2><span style="width:40px"></span></div>
    <form class="ed-body" novalidate>
      <label class="field"><span>Jour</span><input class="input" type="date" name="date" value="${d.date}" min="${todayISO()}"></label>
      <label class="field"><span>Nom <span class="faint">(facultatif)</span></span><input class="input" name="label" value="${esc(d.label)}" placeholder="ex. Dimanche soupe joumou, plateaux de fête"></label>
      <label class="field"><span>Heures de retrait</span><input class="input" name="window" value="${esc(d.window)}" placeholder="12 h – 17 h">
        <div class="presets">${['11 h – 15 h', '12 h – 17 h', '16 h – 20 h'].map((p) => `<button type="button" data-win="${p}">${p}</button>`).join('')}</div></label>
      <label class="field"><span>Dernier moment pour commander</span><input class="input" type="datetime-local" name="cutoff" value="${esc(d.cutoff)}">
        <div class="presets"><button type="button" data-cut="2">2 jours avant, 20 h</button><button type="button" data-cut="1">La veille, 20 h</button><button type="button" data-cut="none">Sans limite</button></div></label>
      <label class="field"><span>Note pour les clients <span class="faint">(facultatif)</span></span><input class="input" name="note" value="${esc(d.note)}" placeholder="ex. Limité à 30 assiettes"></label>
      <div class="list"><label class="toggle-row"><span class="grow"><b>Commandes ouvertes</b><small>Désactivez pour mettre ce jour en pause</small></span>${sw('open', !d.paused)}</label></div>
      ${isNew ? '' : `<button type="button" class="danger-link" data-del>${icon('trash')} Supprimer cette date</button>`}
      <p class="err" id="ed-err" hidden></p>
    </form>
    <div class="ed-foot"><button class="btn btn-ghost" data-x>Annuler</button><button class="btn btn-primary" data-save>${isNew ? 'Ajouter la date' : 'Enregistrer'}</button></div></div>`;
  const el = openSheet(render(), 'full');
  const readForm = () => { const f = $('form', el).elements; d.date = f.date.value; d.label = f.label.value.trim(); d.window = f.window.value.trim(); d.cutoff = f.cutoff.value; d.note = f.note.value.trim(); d.paused = !f.open.checked; };
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.win) { $('[name=window]', el).value = t.dataset.win; }
    else if (t.dataset.cut) { readForm(); $('[name=cutoff]', el).value = t.dataset.cut === 'none' ? '' : defaultCutoff(d.date, +t.dataset.cut); }
    else if (t.hasAttribute('data-x')) closeSheet();
    else if (t.hasAttribute('data-del')) {
      if (!confirm(`Supprimer ${fmtDay(d.date)} ?`)) return;
      s.dates = s.dates.filter((x) => x.id !== d.id); s.dishes.forEach((x) => { x.dates = (x.dates || []).filter((y) => y !== d.id); });
      save(); closeSheet(); renderTab(); toast('Date supprimée');
    } else if (t.hasAttribute('data-save')) {
      readForm();
      const err = !d.date ? 'Choisissez un jour.' : s.dates.some((x) => x.date === d.date && x.id !== d.id) ? 'Ce jour existe déjà.' : '';
      if (err) { const p = $('#ed-err', el); p.textContent = err; p.hidden = false; return; }
      if (isNew) s.dates.push(d); else s.dates[s.dates.findIndex((x) => x.id === d.id)] = d;
      s.dates.sort((a, b) => a.date.localeCompare(b.date));
      save(); closeSheet(); renderTab(); toast(isNew ? `${fmtDay(d.date, 'short')} ajouté` : 'Enregistré');
    }
  });
}

/* ======================= NEWS ======================= */
const TONES = { highlight: 'À la une', info: 'Info', important: 'Urgent' };
function newsTab() {
  const s = S(); const today = todayISO();
  return `<div class="a-h1"><div><h1>Annonces</h1><p>De courtes nouvelles affichées en haut de votre menu.</p></div></div>
    ${s.announcements.length ? `<div class="list">${s.announcements.map((a) => {
      const expired = a.until && a.until < today;
      return `<div class="item tap ${a.active === false || expired ? 'is-muted' : ''}" data-news="${esc(a.id)}">
        <span class="notice-${a.tone || 'highlight'}" style="width:10px;align-self:stretch;border-radius:5px;flex:none"></span>
        <div class="grow"><b>${esc(a.title || a.text)}</b><small>${expired ? 'Terminée' : a.until ? `Affichée jusqu'au ${fmtDay(a.until, 'short')}` : 'Sans date de fin'}</small></div>
        <label class="sw" data-stop>${sw(`news-${a.id}`, a.active !== false && !expired)}<span>${a.active === false || expired ? 'Off' : 'On'}</span></label></div>`; }).join('')}</div>`
    : `<div class="list empty-card"><img src="assets/img/mark.svg" alt=""><h3>Rien à annoncer ?</h3><p>Utilisez les annonces pour les spécialités, les horaires de fêtes, ou « plus que 10 assiettes ! »</p></div>`}`;
}
function newsEditor(id) {
  const s = S(); const isNew = !id;
  const a = isNew ? { id: uid('a'), title: '', text: '', tone: 'highlight', until: '', active: true } : structuredClone(s.announcements.find((x) => x.id === id));
  const el = openSheet(`<div class="ed">
    <div class="ed-head"><button class="icon-btn" data-x aria-label="Fermer">${icon('x')}</button><h2>${isNew ? 'Nouvelle annonce' : 'Modifier l\'annonce'}</h2><span style="width:40px"></span></div>
    <form class="ed-body" novalidate>
      <label class="field"><span>Titre</span><input class="input" name="title" value="${esc(a.title)}" placeholder="ex. La soupe joumou est de retour"></label>
      <label class="field"><span>Message</span><textarea class="textarea" name="text" rows="3" placeholder="ex. Dimanche seulement, et il n'y a que 20 litres !">${esc(a.text)}</textarea></label>
      <div class="field"><span>Style</span><div class="tone-opts">${Object.entries(TONES).map(([k, l]) => `<label class="notice-${k}"><input type="radio" name="tone" value="${k}" ${a.tone === k ? 'checked' : ''}>${l}</label>`).join('')}</div></div>
      <label class="field"><span>Afficher jusqu'au <span class="faint">(facultatif)</span></span><input class="input" type="date" name="until" value="${esc(a.until)}"><small>Après ce jour, elle disparaît toute seule.</small></label>
      <div class="list"><label class="toggle-row"><span class="grow"><b>Afficher sur le site</b></span>${sw('active', a.active !== false)}</label></div>
      ${isNew ? '' : `<button type="button" class="danger-link" data-del>${icon('trash')} Supprimer l'annonce</button>`}
    </form>
    <div class="ed-foot"><button class="btn btn-ghost" data-x>Annuler</button><button class="btn btn-primary" data-save>${isNew ? 'Publier l\'annonce' : 'Enregistrer'}</button></div></div>`, 'full');
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.hasAttribute('data-x')) closeSheet();
    else if (t.hasAttribute('data-del')) { if (confirm('Supprimer cette annonce ?')) { s.announcements = s.announcements.filter((x) => x.id !== a.id); save(); closeSheet(); renderTab(); } }
    else if (t.hasAttribute('data-save')) {
      const f = $('form', el).elements;
      Object.assign(a, { title: f.title.value.trim(), text: f.text.value.trim(), tone: f.tone.value || 'highlight', until: f.until.value, active: f.active.checked });
      if (!a.title && !a.text) return toast('Écrivez un titre ou un message', 'info');
      if (isNew) s.announcements.unshift(a); else s.announcements[s.announcements.findIndex((x) => x.id === a.id)] = a;
      save(); closeSheet(); renderTab(); toast(isNew ? 'Annonce créée (publiez pour la mettre en ligne)' : 'Enregistré');
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
  return `<div class="a-h1"><div><h1>Réglages</h1><p>Vos infos, vos contacts et le fonctionnement des commandes.</p></div></div>
  <section class="group"><h2>Contact</h2><div class="list" style="padding:16px;display:grid;gap:14px">
    ${f('contact.whatsapp', 'Numéro WhatsApp', { type: 'tel', ph: '+33 6 12 34 56 78', hint: 'Avec l\'indicatif du pays. Les commandes arrivent ici.' })}
    ${f('contact.phone', 'Téléphone pour SMS et appels', { type: 'tel', ph: '+33 6 12 34 56 78' })}
    ${f('contact.instagram', 'Instagram', { ph: 'chezshashou' })}
    <div class="row2">${f('contact.facebook', 'Facebook', { ph: 'nom de la page' })}${f('contact.tiktok', 'TikTok', { ph: 'nom d\'utilisateur' })}</div>
    ${f('contact.email', 'E-mail', { type: 'email', ph: 'vous@exemple.com' })}
  </div></section>

  <section class="group"><h2>Orders</h2><div class="list" style="padding:16px;display:grid;gap:14px">
    <label class="field"><span>Les clients envoient leur commande par</span><select class="select" data-bind="ordering.sendVia">
      ${[['both', 'WhatsApp ou SMS'], ['whatsapp', 'WhatsApp seulement'], ['sms', 'SMS seulement']].map(([k, l]) => `<option value="${k}" ${o.sendVia === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    ${f('ordering.paymentNote', 'Comment les clients paient', { ph: 'Paiement au retrait : espèces, virement ou Wero' })}
    ${f('ordering.confirmNote', 'Note sous le bouton d\'envoi', { ph: 'Votre commande est confirmée quand Vasthie répond.' })}
    <div class="row2">${f('ordering.minOrder', 'Commande minimum', { type: 'number', mode: 'decimal', ph: '0' })}
      <label class="field"><span>Devise</span><select class="select" data-bind="brand.currency">${['EUR', 'USD', 'CAD', 'GBP', 'HTG'].map((c) => `<option ${s.brand.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div>
  </div></section>

  <section class="group"><h2>Retrait et livraison<button data-act="add-ful">+ Ajouter une option</button></h2><div class="fulf">
    ${o.fulfillment.map((x, i) => `<div class="card">
      <div class="row2">${f(`ordering.fulfillment.${i}.label`, 'Nom', { ph: 'À emporter' })}${f(`ordering.fulfillment.${i}.fee`, 'Frais', { type: 'number', mode: 'decimal', ph: '0' })}</div>
      ${f(`ordering.fulfillment.${i}.note`, 'Détails', { ph: 'ex. Dans un rayon de 5 km' })}
      <label class="toggle-row" style="padding:4px 0;border:0"><span class="grow"><b>Demander une adresse</b></span><label class="switch"><input type="checkbox" data-bind="ordering.fulfillment.${i}.needsAddress" ${x.needsAddress ? 'checked' : ''}><span></span></label></label>
      ${o.fulfillment.length > 1 ? `<button class="danger-link" data-rmful="${i}">${icon('trash')} Retirer</button>` : ''}
    </div>`).join('')}
    ${f('about.area', 'Où récupérer les commandes ?', { area: true, rows: 2, ph: 'Retrait dans le quartier. Adresse envoyée à la confirmation.', hint: 'Affiché sur le site. Vous pouvez garder votre adresse exacte privée.' })}
  </div></section>

  <section class="group"><h2>Votre marque</h2><div class="list" style="padding:16px;display:grid;gap:14px">
    ${f('brand.name', 'Nom de l\'entreprise')}
    ${f('brand.tagline', 'Slogan', { ph: 'Cuisine haïtienne maison par Vasthie' })}
    ${f('brand.headline', 'Grand titre', { ph: 'Manje lakay, fait avec amour.', hint: 'Le texte après la virgule s\'affiche en italique rouge.' })}
    ${f('brand.intro', 'Intro', { area: true, rows: 3 })}
  </div></section>

  <section class="group"><h2>À propos de vous</h2><div class="list" style="padding:16px;display:grid;gap:14px">
    <div class="field" id="about-photo"><span>Photo</span>${photoPicker(s.about.photo, 'Ajoutez une photo de vous ou de vos plats', true)}</div>
    ${f('about.title', 'Titre', { ph: 'Bonjou, moi c\'est Vasthie' })}
    ${f('about.text', 'Votre histoire', { area: true, rows: 7, hint: 'Laissez une ligne vide entre les paragraphes.' })}
  </div></section>

  <section class="group"><h2>Publication</h2><div class="list">
    <div class="item">${icon('github')}<div class="grow"><b>${connected() ? `${esc(repo.owner)}/${esc(repo.repo)}` : 'Non connecté (mode démo)'}</b><small>${connected() ? `Branche ${esc(repo.branch)}` : 'Les modifications restent sur ce téléphone jusqu\'à la connexion'}</small></div>
      <button class="btn btn-ghost btn-sm" data-act="${connected() ? 'disconnect' : 'connect'}">${connected() ? 'Se déconnecter' : 'Se connecter'}</button></div>
    <button class="item tap" data-act="export">${icon('download')}<div class="grow"><b>Télécharger une sauvegarde</b><small>Enregistre site.json sur votre téléphone</small></div>${icon('next', 'chev')}</button>
    <label class="item tap">${icon('upload')}<div class="grow"><b>Restaurer une sauvegarde</b><small>Charger un fichier site.json</small></div><input type="file" accept="application/json,.json" data-import hidden>${icon('next', 'chev')}</label>
    <button class="item tap" data-act="discard">${icon('refresh')}<div class="grow"><b>Annuler les modifications non publiées</b><small>Revenir à la version en ligne</small></div>${icon('next', 'chev')}</button>
  </div></section>`;
}
function wireSettings(v) {
  wirePhoto($('#about-photo', v), () => 'about', (p) => { S().about.photo = p; save(); renderTab(); });
  $('[data-import]', v)?.addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { draft.site = normalize(JSON.parse(await file.text())); save(); renderTab(); toast('Sauvegarde chargée (publiez pour la mettre en ligne)'); }
    catch { toast('Ce fichier ne ressemble pas à une sauvegarde site.json', 'info'); }
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
      <h2>Connectez-vous pour publier</h2><p>Vous êtes en mode démo : vos modifications sont enregistrées sur ce téléphone seulement. Connectez votre dépôt GitHub pour les mettre en ligne, ou téléchargez une sauvegarde.</p>
      <button class="btn btn-primary" data-act="connect">${icon('github')} Se connecter</button>
      <button class="btn btn-ghost" data-act="export">${icon('download')} Télécharger site.json</button></div>`);
    return;
  }
  if (!dirty()) { toast('Tout est déjà en ligne'); return; }
  const el = openSheet(`<div class="grabber"></div><div class="done"><img src="assets/img/mark.svg" alt=""><h2>Publication…</h2><p>Envoi de vos modifications sur le site.</p><div class="progress"><i></i></div></div>`);
  try {
    const site = S();
    // Photos added in demo mode are still data: URLs; upload them first.
    const photoHolders = [...site.dishes.map((d) => [d, d.name]), [site.about, 'about']];
    for (const [obj, name] of photoHolders) {
      if (obj.photo?.startsWith('data:')) {
        const path = `images/dishes/${slug(name)}-${Date.now().toString(36)}.jpg`;
        await gh.putFile(path, obj.photo.split(',')[1], `Ajout photo : ${name}`);
        obj.photo = path;
      }
    }
    let current;
    try { current = await gh.getFile('data/site.json'); } catch (e) { if (e.status !== 404) throw e; }
    if (current && draft.sha && current.sha !== draft.sha && json(normalize(JSON.parse(current.text))) !== draft.base) {
      if (!confirm('Le site a été modifié depuis un autre appareil pendant que vous travailliez. Publier quand même et remplacer ces modifications ?')) { closeSheet(); return; }
    }
    const text = json(site);
    const res = await gh.putFile('data/site.json', b64encode(text), 'Mise à jour du menu depuis l\'espace cuisine', current?.sha);
    draft.base = text; draft.sha = res.content.sha; save();
    const live = `https://${repo.owner.toLowerCase()}.github.io/${repo.repo}/`;
    el.innerHTML = `<div class="grabber"></div><div class="done"><img src="assets/img/mark.svg" alt="">
      <h2>Publié !</h2><p>Votre site se met à jour dans environ une minute. Les clients devront peut-être rafraîchir la page.</p>
      <a class="btn btn-primary" href="${esc(live)}" target="_blank" rel="noopener">${icon('external')} Voir le site en ligne</a>
      <button class="btn btn-ghost" data-close>Continuer les modifications</button></div>`;
    $('[data-close]', el).onclick = () => closeSheet();
    renderTab();
  } catch (err) {
    el.innerHTML = `<div class="grabber"></div><div class="done"><h2>Publication impossible</h2><p>${esc(err.message)}</p>
      <p class="hint">${err.status === 401 ? 'Votre clé d\'accès a peut-être expiré. Déconnectez-vous, puis reconnectez-vous avec une nouvelle clé.' : 'Vérifiez votre connexion et réessayez. Vos modifications sont toujours enregistrées sur ce téléphone.'}</p>
      <button class="btn btn-primary" data-retry>Réessayer</button><button class="btn btn-ghost" data-close>Fermer</button></div>`;
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
    <h1>Cuisine</h1>
    <p class="lead">Connectez-vous pour modifier votre menu, vos dates et vos annonces. Une seule fois par téléphone.</p>
    ${msg ? `<div class="errbox" style="background:var(--piman-tint);color:var(--piman-deep);padding:12px 14px;border-radius:12px;font-weight:600">${esc(msg)}</div>` : ''}
    <label class="field"><span>Dépôt GitHub</span><input class="input" name="full" value="${esc(g.owner && g.repo ? `${g.owner}/${g.repo}` : '')}" placeholder="utilisateur/restaurant" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
    <label class="field"><span>Branche</span><input class="input" name="branch" value="${esc(g.branch || 'main')}" autocapitalize="off"></label>
    <label class="field"><span>Clé d'accès (jeton GitHub)</span><input class="input" name="token" type="password" autocomplete="off" placeholder="github_pat_…" value=""></label>
    <details><summary>Comment obtenir une clé d'accès ?</summary><ol>
      <li>Sur GitHub, ouvrez <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens</b>.</li>
      <li>Appuyez sur <b>Generate new token</b>. Nommez-le « Cuisine » et choisissez une longue durée de validité.</li>
      <li>Dans <b>Repository access</b>, choisissez <b>Only select repositories</b>, puis le dépôt de ce site.</li>
      <li>Dans <b>Permissions → Repository permissions</b>, réglez <b>Contents</b> sur <b>Read and write</b>.</li>
      <li>Générez-la, copiez la clé (elle commence par <code>github_pat_</code>) et collez-la ci-dessus.</li>
    </ol></details>
    <button class="btn btn-primary btn-block" type="submit">${icon('github')} Se connecter</button>
    <button class="btn btn-ghost btn-block" type="button" data-demo>Découvrir d'abord (mode démo)</button>
  </form></div>`;
  const form = $('form', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const [owner, name] = form.full.value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').split('/');
    const candidate = { owner, repo: name, branch: form.branch.value.trim() || 'main', token: form.token.value.trim() };
    if (!owner || !name || !candidate.token) return connectScreen('Remplissez le dépôt et la clé d\'accès.');
    const btn = $('[type=submit]', form); btn.disabled = true; btn.textContent = 'Vérification…';
    repo = candidate;
    try {
      const r = await gh.req('');
      if (r.permissions && !r.permissions.push) throw new Error("Cette clé peut lire le dépôt mais pas enregistrer. Donnez-lui Contents : Read and write.");
      store.set(REPO_KEY, repo);
      store.remove(DRAFT_KEY);
      await start();
      toast('Connectée. Bienvenue dans votre cuisine !');
    } catch (err) {
      repo = null;
      connectScreen(err.status === 401 ? "Cette clé d'accès ne fonctionne pas. Vérifiez-la et réessayez." : err.status === 404 ? "Dépôt introuvable avec cette clé. Vérifiez le nom, et que la clé y a accès." : err.message);
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
    case 'add-ful': S().ordering.fulfillment.push({ id: uid('f'), label: 'Nouvelle option', note: '', fee: 0, needsAddress: false }); save(); renderTab(); return;
    case 'clear-past': {
      const s = S(); const past = new Set(s.dates.filter((d) => dateStatus(d) === 'past').map((d) => d.id));
      s.dates = s.dates.filter((d) => !past.has(d.id)); s.dishes.forEach((d) => { d.dates = (d.dates || []).filter((x) => !past.has(x)); });
      save(); renderTab(); toast('Dates passées retirées'); return;
    }
    case 'discard':
      if (!dirty()) return toast('Rien à annuler');
      if (confirm('Supprimer toutes les modifications non publiées ?')) { draft.site = normalize(JSON.parse(draft.base)); save(); renderTab(); toast('Retour à la version en ligne'); }
      return;
    case 'disconnect':
      if (dirty() && !confirm('Vous avez des modifications non publiées. Vous déconnecter quand même ? Elles seront perdues.')) return;
      store.remove(REPO_KEY); store.remove(DRAFT_KEY); repo = null; connectScreen(); return;
  }
});
/* Quick toggles on list rows */
document.addEventListener('change', (e) => {
  const n = e.target.name || ''; const s = draft && S(); if (!s) return;
  let m;
  if ((m = n.match(/^avail-(.+)$/))) { const d = s.dishes.find((x) => x.id === m[1]); d.soldOut = !e.target.checked; save(); renderTab(); toast(d.soldOut ? `${d.name} : épuisé` : `${d.name} : disponible`); }
  else if ((m = n.match(/^open-(.+)$/)) && e.target.closest('#view')) { const d = s.dates.find((x) => x.id === m[1]); d.paused = !e.target.checked; save(); renderTab(); toast(d.paused ? 'Commandes en pause pour ce jour' : 'Commandes rouvertes'); }
  else if ((m = n.match(/^news-(.+)$/))) { const a = s.announcements.find((x) => x.id === m[1]); a.active = e.target.checked; if (a.active && a.until && a.until < todayISO()) a.until = ''; save(); renderTab(); }
});
window.addEventListener('beforeunload', (e) => { if (dirty() && !connected()) { e.preventDefault(); } });

/* ======================= boot ======================= */
async function start() {
  root.innerHTML = `<div class="connect"><img class="hero-mark" src="assets/img/mark.svg" alt="Chargement" style="width:72px;animation:spin 3s linear infinite"></div>`;
  let pub;
  try { pub = await loadPublished(); }
  catch (err) {
    if (err.status === 401 || err.status === 404) { store.remove(REPO_KEY); repo = null; return connectScreen('Votre clé d\'accès ne fonctionne plus. Reconnectez-vous.'); }
    root.innerHTML = `<div class="connect"><div class="box" style="text-align:center"><h1>Site injoignable</h1><p class="lead">${esc(err.message)}</p><button class="btn btn-primary" onclick="location.reload()">Réessayer</button></div></div>`;
    return;
  }
  pub.text = json(normalize(JSON.parse(pub.text))); // canonical form, so "unpublished changes" is accurate
  const saved = store.get(DRAFT_KEY);
  if (saved?.site && json(normalize(saved.site)) !== pub.text) {
    draft = saved; // keep unpublished work
    if (saved.sha && pub.sha && saved.sha !== pub.sha) toast('Le site a été modifié ailleurs. Vos modifications non publiées sont conservées.', 'info');
    draft.base = pub.text; draft.sha = pub.sha;
  } else {
    draft = { site: normalize(JSON.parse(pub.text)), base: pub.text, sha: pub.sha };
  }
  draft.site = normalize(draft.site);
  save();
  shell();
}

if (!repo) connectScreen(); else start();
