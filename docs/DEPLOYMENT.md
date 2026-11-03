# Deployment

## Shape

The studio is a static directory with no build step and no server code. GitHub Pages serves `main` at the repository root.

```text
https://somphol.github.io/full-3d-chess-academy/
```

The only runtime request is the pinned Three.js module and its addons from `cdn.jsdelivr.net`.

## First deployment

1. Create the public repository (no template, no README from GitHub).
2. Push `main`:

   ```bash
   git remote add origin https://github.com/somphol/full-3d-chess-academy.git
   git push -u origin main
   ```

3. Enable Pages for branch `main`, folder `/` (API or Settings → Pages).
4. Wait for the first build, then verify the page and module paths:

   ```bash
   curl -sI https://somphol.github.io/full-3d-chess-academy/ | head -1
   curl -sI https://somphol.github.io/full-3d-chess-academy/style.css | head -1
   curl -sI https://somphol.github.io/full-3d-chess-academy/script.js | head -1
   curl -sI https://somphol.github.io/full-3d-chess-academy/assets/studio.png | head -1
   ```

All four should return `HTTP/2 200`.

## Later deployments

```bash
node --check script.js
node scripts/check.mjs
git add -A
git commit -m "…"
git push origin main
```

Pages rebuilds automatically. There is no artifact to upload and no cache to purge by hand; jsDelivr and the Pages CDN cache for a few minutes.

## CI

`.github/workflows/ci.yml` runs the same two commands on every push and pull request with Node 22. Keep it green. It is independent of Pages; a failing CI run does not block a branch deployment, so check the badge.

## Constraints

- **Keep the import map pinned.** `three@0.169.0` is exact. Floating versions can change rendering APIs without warning.
- **Do not rename the three source files.** The import map, HTML links and verification suite assume `index.html`, `style.css`, `script.js`.
- **Serve over HTTP.** `file://` blocks ES modules and therefore the studio; local testing uses `python3 -m http.server`. GitHub Pages is unaffected.
- **No secrets in the repo.** There is no backend and no environment variable. Never commit tokens or `.env` files.
- **Keep `.nojekyll`.** It prevents Jekyll from touching the static files.

## Rollback

Revert the offending commit on `main` and push. Pages redeploys the previous state within a minute or two. If a bad Three.js version is the cause, restore the import-map URLs and the `THIRD_PARTY_NOTICES.md` version together.

## Custom domain

Add a `CNAME` file at the root, configure DNS, and enable HTTPS in Pages. Then update the absolute URLs in `index.html` (Open Graph), `README.md`, `AGENTS.md` and `state.json`. Do not remove the GitHub Pages URL from the README; keep both.
