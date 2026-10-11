# Chez Shashou

The site and the kitchen editor are in French (`brand.locale` in `data/site.json` controls date and price formats).

Haitian home cooking by Vasthie (Shashou): a mobile-first ordering site for weekend cook-ups.

- **Customers** browse the menu, pick a cook-up date, and send their order as a pre-written **WhatsApp or text message**. There are no accounts and no online payments.
- **Vasthie** edits dishes, photos, dates, announcements and contact info from her phone at `/admin.html`, then taps **Publish**.
- **Cost:** $0. It's plain static files on GitHub Pages, with no server or database.

The brand book (logo, colors, type, voice and every screen) is in [`brand/index.html`](brand/index.html).

## Going live

1. **Turn on GitHub Pages:** go to the repository's *Settings → Pages*, choose *Deploy from a branch*, then pick `main` and `/ (root)`.
   The site will be at `https://<username>.github.io/<repo>/`.
2. **Create Vasthie's access key:** go to GitHub *Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*.
   - Repository access: *Only select repositories*, then pick this repository.
   - Permissions: *Contents* set to **Read and write**. No other permission is needed.
   - Choose a long expiration and copy the key (`github_pat_…`).
3. On her phone, open `https://<username>.github.io/<repo>/admin.html`, paste the key, and tap **Connect**.
   Optionally use *Add to Home Screen* so "Kitchen" sits next to her other apps.
4. In **Settings**, enter her real WhatsApp number, Instagram, payment methods and pickup details.
5. Replace the sample photos and prices, add real dates, **Publish**, and send a test order to her own phone.

## How it works

```
Kitchen editor (admin.html) ──GitHub API──▶ data/site.json + images/  ──GitHub Pages──▶ index.html
                                                                                           │
                                                Vasthie's WhatsApp / SMS ◀── pre-written order message
```

- `data/site.json` holds everything: brand text, about, contact, ordering options, announcements, dates and dishes.
- The editor keeps changes as a **draft on the phone** (in `localStorage`) until Publish. Then it commits `site.json` (and any new photos) to the repo, and Pages redeploys in about a minute. Every publish is a commit, so any earlier menu can be restored from the Git history.
- Photos are resized on the phone (max 1400 px JPEG) before upload.
- The **eye** button in the editor opens `index.html?preview`, which shows the unpublished draft.
- Without a key, the editor runs in **demo mode**: changes stay on that phone, and you can download `site.json` as a backup.
- Each date stops taking orders automatically after its deadline (`cutoff`), and past dates disappear from the site.
- The access key is stored only on the phones that signed in. It can only change this one repository, and it can be revoked on GitHub at any time.
- **Kitchen password:** once signed in with the key, *Réglages → Mot de passe de la cuisine* stores the key in `data/kitchen-key.json`, encrypted with that password (PBKDF2-SHA256, 600,000 rounds, AES-GCM, in the browser). Other phones then sign in with the password alone. The encrypted file is public, so use a long password (3–4 words). If the GitHub key expires, sign in with a new key and set the password again.

## Files

| Path | What |
|---|---|
| `index.html`, `assets/js/app.js`, `assets/css/app.css` | Customer site |
| `admin.html`, `assets/js/admin.js`, `assets/css/admin.css` | Kitchen editor |
| `assets/js/shared.js`, `assets/css/brand.css` | Shared helpers, icons and design tokens |
| `assets/img/` | Logo mark (`mark.svg`), app icons |
| `data/site.json` | All the content |
| `images/dishes/` | Dish photos (`images/CREDITS.md` lists the sample photos' sources) |
| `manifest.webmanifest`, `sw.js` | Installable app and offline fallback |
| `brand/` | Brand book and screenshots |

## Run it locally

No build step. Serve the folder with any static server:

```sh
python3 -m http.server 8000
# open http://localhost:8000 and http://localhost:8000/admin.html (choose demo mode)
```
