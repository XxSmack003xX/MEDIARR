# Contributing to MEDIARR

Thanks for helping improve MEDIARR.

## Before you start

MEDIARR is intentionally lightweight and has a compact architecture:

- `server.js` contains most backend routes, integrations, background work, persistence, and authentication.
- `public/index.html` is the desktop application.
- `public/mobile.html` is the mobile application.
- Runtime state belongs in `DATA_DIR` and must never be committed.

Because desktop and mobile are separate frontends, user-facing features often require equivalent changes in both files.

## Development setup

Node.js 18+ is required.

```bash
git clone https://github.com/XxSmack003xX/MEDIARR.git
cd MEDIARR
node server.js
```

No npm dependency installation is required for the current application runtime.

For Docker development:

```bash
mkdir -p data
docker compose up -d --build
```

## Pull requests

Please keep pull requests focused. Include:

- What changed.
- Why the change is useful.
- How it was tested.
- Any migration/configuration changes.
- Security implications when applicable.
- Screenshots for meaningful UI changes when useful.

## Required checks

Run:

```bash
node --check server.js
node --check update-helper.js
```

When changing Docker behavior, also build the image if Docker is available.

When changing frontend behavior, verify both desktop and mobile where the feature applies.

## Security-sensitive changes

Call out changes involving:

- Authentication/sessions.
- Password/API-key handling.
- Admin authorization.
- Docker socket access.
- Container lifecycle/update behavior.
- Saved shell commands.
- File downloads/playback paths.
- WebDAV credentials.
- Reverse proxy/cookie behavior.

Do not weaken server-side permission checks just because a control is hidden in the UI.

## Persistent data

Never commit real runtime files, including:

```text
config.json
users.json
adds.json
favorites.json
health.json
rss.json
blocked.json
autoadd.json
library-cache.json
error-log.json
plex-cache.json
data/
backups/
.env
```

If a feature introduces a new persistent file containing user information or credentials, add it to `.gitignore` and consider whether it belongs in MEDIARR's backup/restore set.

## Releases

Maintainers should follow [`docs/PUBLISHING.md`](docs/PUBLISHING.md).