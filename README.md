<div align="center">

# MEDIARR

**A self-hosted media discovery, request, library-management, playback, and server-control dashboard for Radarr, Sonarr, Plex, Docker, SABnzbd, WebDAV/local media, and more.**

[![Version](https://img.shields.io/badge/version-1.6.8-35c5f0)](https://github.com/XxSmack003xX/MEDIARR/releases)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-43853d)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-supported-2496ed)](https://www.docker.com/)
[![License](https://img.shields.io/badge/license-not%20yet%20selected-lightgrey)](#license)

**Repository:** https://github.com/XxSmack003xX/MEDIARR

</div>

---

## What is MEDIARR?

MEDIARR is a lightweight, self-hosted web application that puts several common media-server workflows behind one responsive interface.

At its core, MEDIARR lets users discover movies and TV shows and send them to **Radarr** and **Sonarr**. It also adds features that are normally spread across several applications: manual release selection, library browsing, Plex activity and account tools, server health history, WebDAV/local-file playback, SABnzbd activity, Docker container controls, configuration backups, notifications, RSS automation, user quotas, an external API, and GitHub-based application updates.

The server is intentionally small: it is written with Node.js built-ins and does not require an npm dependency install. The desktop and mobile interfaces are served by the same Node.js process, and service credentials stay on the MEDIARR server instead of being embedded in browser JavaScript.

This README is written against the **v1.6.8 source in this repository**. Feature descriptions below are based on the routes and configuration that actually exist in `server.js`, not on a future roadmap.

> [!IMPORTANT]
> MEDIARR can optionally control Docker containers and run administrator-defined maintenance commands. Those features are powerful and must be treated like server-administration access. Read the [Security](#security) section before exposing MEDIARR outside your trusted network.

---

## Table of contents

- [Highlights](#highlights)
- [Supported services](#supported-services)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Quick start with Docker Compose](#quick-start-with-docker-compose)
- [Install from a GitHub release](#install-from-a-github-release)
- [Run directly with Node.js](#run-directly-with-nodejs)
- [First-run setup](#first-run-setup)
- [Configuration and persistent data](#configuration-and-persistent-data)
- [Networking with Docker](#networking-with-docker)
- [Accounts, roles, quotas, and API keys](#accounts-roles-quotas-and-api-keys)
- [User home pages](#user-home-pages)
- [Movie and TV discovery](#movie-and-tv-discovery)
- [Radarr and Sonarr integration](#radarr-and-sonarr-integration)
- [Unified media detail](#unified-media-detail)
- [Real-time events and Live Dashboard](#real-time-events-and-live-dashboard)
- [Manual release search](#manual-release-search)
- [Library browser and monitoring controls](#library-browser-and-monitoring-controls)
- [Plex integration](#plex-integration)
- [SABnzbd activity](#sabnzbd-activity)
- [WebDAV and local media playback](#webdav-and-local-media-playback)
- [Automatic playback selection and Transcode Dashboard](#automatic-playback-selection-and-transcode-dashboard)
- [Calendar, health, and activity](#calendar-health-and-activity)
- [Favorites and automation](#favorites-and-automation)
- [RSS auto-add](#rss-auto-add)
- [Notifications](#notifications)
- [Configuration backups and restore](#configuration-backups-and-restore)
- [Docker container controls](#docker-container-controls)
- [System maintenance commands](#system-maintenance-commands)
- [System Update](#system-update)
- [Mobile interface](#mobile-interface)
- [External API](#external-api)
- [Environment variables](#environment-variables)
- [Reverse proxy and HTTPS](#reverse-proxy-and-https)
- [Security](#security)
- [Updating MEDIARR](#updating-mediarr)
- [Backup and migration](#backup-and-migration)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)
- [Publishing releases](#publishing-releases)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgements](#acknowledgements)

---

## Highlights

### Personalized home

- Give every MEDIARR account its own signed-in home page.
- Surface personal Plex Continue Watching, Watchlist, and Recently Watched data when linked.
- Track each user's recent MEDIARR requests and whether they are merely requested, in-library, or available.
- Show favorite-show upcoming episodes and personalized recommendations.
- Fall back gracefully when Plex or TMDB is not configured.

### Discovery and requests

- Search movies and TV shows.
- Search by **title**, **person**, **year**, or **studio** when TMDB is configured.
- Browse recently released titles.
- View cast, crew, overview, artwork, related titles, and similar recommendations.
- See whether a title is already present in Radarr/Sonarr before adding it.
- Detect newly added Sonarr series quickly: MEDIARR updates its cache immediately for in-app adds and refreshes stale Sonarr library data after about 15 seconds.
- Revalidate TV-card button state automatically so existing Sonarr shows switch from **Add to Sonarr** to **✓ In library** without requiring a browser reload.
- Add movies to Radarr and series to Sonarr without exposing service API keys to the browser.

### Radarr and Sonarr management

- Select quality profiles and root folders.
- Choose Radarr minimum availability.
- Choose Sonarr monitor schemes.
- Edit already-added titles.
- Trigger automatic searches.
- Monitor individual Sonarr seasons and episodes.
- Browse and grab exact Radarr/Sonarr releases manually.
- View rejection reasons, custom-format information, quality, size, indexer, seeders, and age when available.

### Plex tools

- Monitor Plex server health.
- View active streams.
- Link individual MEDIARR users to Plex accounts.
- Browse Plex watchlists and history.
- Switch Plex Home users.
- View watched-state information.
- Optionally enforce a Plex stream blocklist by IP.

### Playback and downloads

- Browse a WebDAV media source or a host-mounted local folder.
- Direct-play browser-compatible media.
- Proxy media through MEDIARR when required.
- Use FFmpeg/ffprobe for incompatible codecs.
- Seek through transcoded video using VOD HLS.
- Select audio tracks and subtitles when detected.
- Choose Original, 1080p, 720p, or 480p output presets.
- Use hardware H.264 acceleration when MEDIARR detects a supported encoder.
- Automatically choose direct play, HLS remux, audio-only transcode, or video transcode from source compatibility.

### Administration

- Multi-user authentication.
- Admin and regular-user roles.
- Per-user daily add/download quotas.
- Per-user API keys.
- Add-history auditing.
- Service health and outage history.
- Configuration snapshots and restore.
- Notifications to multiple providers.
- RSS-based automatic additions.
- Docker Start / Stop / Restart / Update controls using an explicit allow-list.
- Saved maintenance commands.
- GitHub Release update checking and Docker self-update with rollback.
- Admin-controlled automatic playback selection and a live Transcode Dashboard.

### Deployment

- Node.js 18+ with no runtime npm dependencies.
- Docker and Docker Compose support.
- Persistent `/data` directory.
- FFmpeg included in the official Docker build.
- Desktop and mobile interfaces.
- Reverse-proxy friendly.
- GitHub Actions release workflow and GHCR image publishing.

---

## Supported services

| Service | What MEDIARR uses it for | Required? |
| --- | --- | --- |
| **Radarr** | Movie library, add/edit, searches, manual releases, calendar, health | Recommended |
| **Sonarr** | TV library, add/edit, episode monitoring, searches, manual releases, calendar, health | Recommended |
| **TMDB** | Rich discovery, person/year/studio search, metadata and recommendations | Optional but strongly recommended |
| **Plex** | Health, sessions, watchlists, history, watched state, account linking | Optional |
| **SABnzbd** | Queue/history visibility | Optional |
| **WebDAV** | Remote media browsing, playback and downloads | Optional |
| **Docker Engine** | Container status/control and one-click self-update | Optional |
| **GitHub Releases / GHCR** | Version checking, release notes and official Docker updates | Optional |
| **RSS/Atom feeds** | Automated movie/series discovery and additions | Optional |
| **Discord / Slack / Telegram / ntfy / Gotify / Pushover / Pushbullet / generic webhook** | Notifications | Optional |

MEDIARR is not affiliated with Radarr, Sonarr, Plex, TMDB, SABnzbd, Stremio, Docker, or GitHub.

---

## Architecture

MEDIARR uses a server-side proxy model so browser clients never need direct access to your Radarr/Sonarr/Plex API credentials.

```text
                         ┌─────────────────────┐
                         │  Desktop / Mobile   │
                         │       Browser       │
                         └──────────┬──────────┘
                                    │ HTTP / HTTPS
                                    ▼
                         ┌─────────────────────┐
                         │       MEDIARR       │
                         │  Node.js web/API    │
                         │  auth + proxy + UI  │
                         └───────┬─────┬───────┘
                                 │     │
                 ┌───────────────┘     └──────────────────┐
                 ▼                                        ▼
       ┌───────────────────┐                    ┌──────────────────┐
       │ Radarr / Sonarr   │                    │ Plex / SABnzbd   │
       └───────────────────┘                    └──────────────────┘
                 │                                        │
                 └───────────────┬────────────────────────┘
                                 │
              ┌──────────────────┼────────────────────┐
              ▼                  ▼                    ▼
        ┌───────────┐      ┌─────────────┐      ┌──────────────┐
        │   TMDB    │      │ WebDAV / FS │      │ Docker Engine│
        └───────────┘      └─────────────┘      └──────────────┘
```

Runtime state is stored as JSON in the MEDIARR data directory. In Docker this is `/data`; source installs default to the application directory unless `DATA_DIR` is set.

---

## Requirements

### Docker installation

- Docker Engine or Docker Desktop.
- Docker Compose v2 is recommended.
- Port `7575` available, unless changed.
- Optional Docker socket access for container controls and self-update.

### Direct Node.js installation

- Node.js **18 or newer**.
- FFmpeg and ffprobe are optional but required for transcoding and media probing.
- No `npm install` is required for the application itself.

### Recommended service versions

MEDIARR is designed around modern Radarr/Sonarr HTTP APIs and includes compatibility handling for multiple response layouts, including newer Sonarr release-search data structures.

---

## Quick start with Docker Compose

Clone the repository:

```bash
git clone https://github.com/XxSmack003xX/MEDIARR.git
cd MEDIARR
```

Create the persistent data directory and start MEDIARR:

```bash
mkdir -p data
docker compose up -d --build
```

Open:

```text
http://YOUR-SERVER-IP:7575
```

The first browser session will guide you through administrator-account creation and service configuration.

### View logs

```bash
docker compose logs -f mediarr
```

### Stop MEDIARR

```bash
docker compose down
```

### Rebuild after source changes

```bash
docker compose up -d --build
```

---

## Install from a GitHub release

Once a release has been published, the recommended community installation is the versioned GHCR image from this repository.

A release ZIP contains a `docker-compose.release.yml` that references the exact release image:

```bash
unzip mediarr-1.3.1.zip
cd mediarr-1.3.1
mkdir -p data
docker compose -f docker-compose.release.yml up -d
```

Using versioned images is important because MEDIARR's updater can retain the previous image as a deterministic rollback target.

The release workflow publishes images in this form:

```text
ghcr.io/xxsmack003xx/mediarr:1.3.1
ghcr.io/xxsmack003xx/mediarr:latest
```

For production installs, prefer the versioned tag over `latest` when you want completely deterministic deployments.

---

## Run directly with Node.js

```bash
git clone https://github.com/XxSmack003xX/MEDIARR.git
cd MEDIARR
node server.js
```

Open:

```text
http://localhost:7575
```

To use a separate persistent directory:

```bash
DATA_DIR=/opt/mediarr-data node server.js
```

To change the port:

```bash
PORT=8080 node server.js
```

To bind only to localhost behind a reverse proxy:

```bash
HOST=127.0.0.1 PORT=7575 node server.js
```

---

## First-run setup

On the first visit, MEDIARR asks you to create the first **administrator** account.

After that account is created, MEDIARR v1.4.0 opens a guided **first-run setup wizard** instead of dropping you directly into the full Settings screen. The wizard walks through:

1. Radarr URL/API key, connection test, quality profile, and root folder.
2. Sonarr URL/API key, connection test, quality profile, and root folder.
3. An optional TMDB API key test.
4. Copy-ready Radarr and Sonarr webhook URLs for MEDIARR's real-time event system.

Every service step is optional. You can skip the wizard and configure the same services later in **Settings**. Existing installations that already have services configured are not forced back through the wizard.

### Radarr

Typical URL:

```text
http://192.168.1.50:7878
```

You need:

- Radarr URL.
- API key from Radarr's security/general settings.
- Quality profile.
- Root folder.

Use **Test & load options** to validate the connection and populate available quality profiles and root folders.

### Sonarr

Typical URL:

```text
http://192.168.1.50:8989
```

You need:

- Sonarr URL.
- API key.
- Quality profile.
- Root folder.

### TMDB

TMDB is optional, but several of MEDIARR's richest discovery features depend on it, including:

- Person searches.
- Year discovery.
- Studio discovery.
- Rich metadata.
- Recommendations/similar titles.

### Plex

You can configure a server-level Plex URL/token for administration features, while individual MEDIARR users can separately link their own Plex accounts for personal watchlists/history.

### SABnzbd

Configure the SABnzbd URL and API key to expose queue/history information inside MEDIARR.

### WebDAV or local media

MEDIARR can browse either:

- A remote WebDAV source; or
- A local directory mounted into the MEDIARR process/container.

See [WebDAV and local media playback](#webdav-and-local-media-playback).

---

## Configuration and persistent data

MEDIARR intentionally keeps runtime data separate from application code.

### Docker

The image uses:

```text
DATA_DIR=/data
```

The default Compose file maps:

```text
./data:/data
```

Keep that directory when upgrading or rebuilding the image.

### Source install

Without `DATA_DIR`, MEDIARR stores its JSON state next to `server.js`.

### Runtime files

Depending on enabled features, the data directory can contain files such as:

| File | Purpose |
| --- | --- |
| `config.json` | Service URLs, API credentials and application settings |
| `users.json` | Users, scrypt password hashes, roles, quotas, themes, API keys and linked Plex-user data |
| `adds.json` | Add/download/play and administrative activity audit records |
| `favorites.json` | Per-user favorites |
| `health.json` | Radarr/Sonarr/Plex service-health history |
| `rss.json` | RSS seen-state and RSS run log |
| `blocked.json` | Plex stream-block events |
| `autoadd.json` | Resumable auto-add job state |
| `library-cache.json` | Cached Radarr/Sonarr library index |
| `errors.json` | Application/integration errors shown to admins |
| `tmdb-map.json` | Cached TMDB-to-IMDb/TVDB ID mappings |
| `backups/` | MEDIARR application-level configuration snapshots |

These files are ignored by Git so secrets and runtime state are not accidentally published.

MEDIARR's **built-in application backup** currently snapshots `config.json`, `users.json`, `favorites.json`, `adds.json`, `rss.json`, `blocked.json`, and `autoadd.json`. For full disaster recovery, copy the entire data directory so health history, caches, error history, and every other runtime file are retained too.

> [!WARNING]
> `config.json` contains service credentials in plain text on the MEDIARR host. Protect the data directory with appropriate filesystem permissions and backups.

---

## Networking with Docker

### Services running directly on the Docker host

The included Compose file maps `host.docker.internal` on Linux as well as Docker Desktop.

Examples:

```text
Radarr: http://host.docker.internal:7878
Sonarr: http://host.docker.internal:8989
Plex:   http://host.docker.internal:32400
SAB:    http://host.docker.internal:8080
```

### Services running in Docker

If Radarr/Sonarr/Plex are containers on the same Docker network, attach MEDIARR to that network and use service/container DNS names, for example:

```text
http://radarr:7878
http://sonarr:8989
http://plex:32400
```

### Local folder media

If MEDIARR should browse a host media directory, add a read-only bind mount:

```yaml
volumes:
  - /mnt/media:/media:ro
```

Then configure MEDIARR with the **container path**, such as:

```text
/media/movies
```

Do not configure `/mnt/media/movies` unless that is also the path inside the container.

---

## Accounts, roles, quotas, and API keys

MEDIARR has its own account system.

### Registration and access approval

After the first administrator account has been created, the login screen supports two public access-request methods:

- **Request access** with a MEDIARR username and password.
- **Sign in with Plex**. The first successful Plex authorization creates a MEDIARR access request tied to that Plex account; after approval, Plex can be used as the sign-in method.

Every public registration starts in a **pending** state. Pending accounts cannot sign in, create authenticated sessions, or use MEDIARR personal API keys until an administrator approves them.

Administrators receive an in-app notification when new access requests arrive. The Admin menu shows the current pending-request count, and User Management provides **Approve** and **Reject** actions on both desktop and mobile.

Existing accounts from releases before v1.6.6 are treated as already approved, so upgrading does not lock out existing users. Accounts created manually by an administrator are active immediately.

Plex registration is matched by the stable Plex account identity rather than by username/display name. MEDIARR does not automatically merge a Plex login into an existing local account simply because the names match.

Public registration endpoints are rate-limited to reduce automated account-request flooding.

Every new public access request must also complete MEDIARR's built-in **CAPTCHA**. The challenge is generated locally by MEDIARR, expires after five minutes, is single-use, and is tied to the requesting IP. Username/password registrations and new Plex registrations are both protected. Existing approved users are not required to solve a CAPTCHA during normal login.

### Administrator accounts

Admins can access:

- Settings.
- User management.
- Add history.
- Service health and diagnostics.
- Plex administration.
- Manual release browsing/grabbing.
- Backup/restore.
- Notifications.
- Docker controls.
- System commands.
- RSS automation.
- System Update.
- Automatic playback selection settings.
- Transcode Dashboard for MEDIARR and Plex playback sessions.

### Regular users

Regular users can discover and add media while being constrained by a configurable daily quota.

The default daily add limit is **10**. Admins can change the limit for each user.

Downloads through MEDIARR can count against the same daily quota. Playback does not consume the quota.

### Password storage

Passwords are hashed with Node.js `scrypt`; MEDIARR does not store plaintext user passwords.

### Sessions

Authentication uses an HttpOnly session cookie. The default lifetime is one hour.

Change it with:

```bash
SESSION_HOURS=8 node server.js
```

or in Docker Compose:

```yaml
environment:
  SESSION_HOURS: 8
```

Sessions are memory-resident, so restarting MEDIARR signs users out.

### Per-user API keys

Users can create/revoke their own API key for MEDIARR's external `/api/v1` interface. See [External API](#external-api).

---

## User home pages

MEDIARR v1.6.0 replaces the generic signed-in landing feed with a personalized **User Home** on both desktop and mobile. The page is assembled by the authenticated `/api/home` endpoint, so personal sections are scoped to the current MEDIARR account rather than being shared globally.

Depending on which services the user has linked and which integrations the administrator has configured, the home page can include:

- **Continue Watching** from the user's linked Plex profile.
- **My Requests** from that MEDIARR username's Radarr/Sonarr add history, with Requested, In library, and Available states.
- **Up Next** for upcoming episodes from that user's favorite TV shows.
- The user's **Plex Watchlist**.
- The user's MEDIARR **Favorites**.
- **Recently Available** media from Radarr/Sonarr library state.
- **Recommended for You**, seeded from recent Plex viewing and MEDIARR favorites when TMDB is configured.
- **Recently Watched** from the linked Plex profile.
- **Discover Now** as a generic recently-released/airing fallback when TMDB is configured.

The page also shows small per-user summary cards for Plex linkage, request usage, favorites, and recent request availability.

### Privacy and Plex profiles

Plex home data is tied to the Plex account/profile linked to the current MEDIARR user. MEDIARR does not intentionally use another user's Plex history as a fallback. When a server-owner Plex token must be used to read scoped history, MEDIARR only does so after resolving the exact Plex account id for that linked user.

Users who have not linked Plex still get MEDIARR request/favorite/library sections. Users without TMDB simply do not receive the recommendation/discovery rails.

---

## Movie and TV discovery

MEDIARR supports several discovery modes.

### Title search

Search for movies and television normally and filter the result type.

### Person search

Search an actor or director and browse their filmography. Result cards identify the person's relationship to the title when available.

### Year search

Enter a four-digit year to browse titles released in that year.

### Studio search

Search a production company/studio and browse matching movies.

### Recently released

When TMDB is configured and the main search field is empty, MEDIARR can show a recently released discovery feed.

### Similar titles

Movie/show detail pages can display recommended or similar titles, letting you move from one title to related content without returning to the main search.

### Already-added indicators

MEDIARR maintains an index of Radarr/Sonarr content and marks search/discovery cards that are already in your library. A **Hide added** option can remove them from the result set.

---

## Radarr and Sonarr integration

### Adding a movie to Radarr

Movie additions can include:

- Quality profile.
- Root folder.
- Monitored state.
- Minimum availability.
- Immediate search.

### Adding a series to Sonarr

Series additions can include:

- Quality profile.
- Root folder.
- Monitor scheme.
- Immediate search.

Supported monitor workflows include common modes such as all, future, missing, existing, recent, pilot, first season, last season, and none.

### Editing an existing item

Admins can reopen titles already present in Radarr/Sonarr and change supported settings such as quality profile, root folder, monitored state, and search behavior.

### Search now

MEDIARR can trigger Radarr/Sonarr commands to search for an existing movie, series, season, or episode.

---

## Unified media detail

MEDIARR v1.5.0 adds one shared status panel to movie and TV detail views on both desktop and mobile. It is designed to answer the questions that previously required jumping between discovery, Radarr/Sonarr, Plex, file information, and release tools.

The panel is populated by MEDIARR's authenticated `/api/media/detail` endpoint and can combine information from:

- Radarr or Sonarr.
- The configured Plex server.
- TMDB, when configured.
- Radarr/Sonarr media-file metadata already exposed by their APIs.

### Movies

For movies already in Radarr, the unified detail can show:

- In-library and monitored state.
- Downloaded or missing state.
- Root folder/path.
- File size.
- Quality and resolution.
- HDR/dynamic range.
- Video codec, bit depth, frame rate, and audio codec/channel information.
- Audio languages and subtitles.
- Release group and edition when Radarr provides them.
- Plex availability and watched/in-progress state.
- TMDB status, genres, runtime, rating, and tagline.

### TV shows

For shows already in Sonarr, the unified detail can show:

- In-library and monitored state.
- Downloaded/total episode counts.
- Missing monitored episodes.
- Unaired episode count and next known episode.
- Per-season completion percentages.
- Aggregate episode-file size.
- Quality formats seen across episode files.
- Video/audio codecs and dynamic-range formats.
- Languages and subtitles.
- Plex availability.
- TMDB status, genres, network information, rating, runtime, and tagline.

### Unified actions

Signed-in users can manage TV favorites from the unified section, while administrators retain the existing library-management actions:

- **Add to Favorites / Remove from Favorites** for TV shows, using the current MEDIARR user's personal favorites list.
- **Open in Plex** when the matching Plex server item can be resolved.
- **Browse releases** using MEDIARR's existing manual-release tools.
- **Search now** in Radarr/Sonarr.
- **Refresh details** without closing the title.

The existing title controls remain immediately below the unified panel. This means movie/series add options, Radarr/Sonarr edits, season/episode monitoring, trailers, cast/crew, recommendations, and other established workflows are preserved.

---

## Real-time events and Live Dashboard

MEDIARR v1.4.0 adds a push-based event path for Radarr and Sonarr plus an administrator-only **Live Dashboard**.

### Radarr and Sonarr webhooks

MEDIARR exposes two webhook endpoints:

```text
/api/webhooks/radarr?token=<generated-secret>
/api/webhooks/sonarr?token=<generated-secret>
```

The first-run wizard and the Live Dashboard show complete copy-ready URLs based on the address you used to reach MEDIARR.

In Radarr or Sonarr:

1. Open **Settings → Connect**.
2. Add a **Webhook** connection.
3. Paste the matching MEDIARR webhook URL.
4. Enable the events you want MEDIARR to receive.
5. Use the application's Test action to verify delivery.

Webhook requests use a generated secret token stored in MEDIARR's `config.json`. Requests without the matching token are rejected. Treat the full webhook URL as a secret because the token is included in its query string.

When a webhook arrives, MEDIARR:

- Invalidates the affected Radarr/Sonarr live ID cache.
- Updates the cached library entry immediately when the event includes movie/series data.
- Starts a short service-specific reconciliation scan so counts/file state catch up.
- Pushes the event to connected administrators in real time.

### Server-Sent Events (SSE)

The Live Dashboard uses **Server-Sent Events** at an authenticated admin endpoint. The browser keeps one lightweight HTTP stream open and MEDIARR pushes events over that connection.

This avoids repeatedly polling the browser for:

- Library changes.
- Webhook activity.
- Health updates.
- MEDIARR add/activity events.
- Active MEDIARR transcodes.
- Realtime connection state.

The dashboard also receives a lightweight snapshot roughly every five seconds from MEDIARR's in-memory state. This does not re-query Radarr/Sonarr every five seconds.

### Live Dashboard

Administrators get a **Live Dashboard** entry in the desktop left menu and mobile menu. It shows:

- Radarr, Sonarr, and Plex health.
- Cached Radarr movie and Sonarr TV-show counts.
- Cache age.
- Active MEDIARR transcode/remux sessions.
- Number of connected SSE dashboard clients.
- Copy-ready Radarr/Sonarr webhook URLs.
- A live chronological event feed.

The dashboard also includes a shortcut for re-opening the setup wizard.

### Reverse proxies

SSE works through normal HTTP reverse proxies, but the proxy must not buffer the event stream. MEDIARR sends `X-Accel-Buffering: no` for nginx-style proxies. A normal Caddy `reverse_proxy` configuration supports streaming responses without a special WebSocket upgrade.

---

## Manual release search

MEDIARR's manual release browser lets an administrator inspect the exact releases returned by Radarr or Sonarr instead of letting the service choose automatically.

### Movies

From the Radarr library browser, click the **⚡** release button, or open the movie's detail page and choose **Browse releases**.

### TV

Open a Sonarr series and choose releases for an individual season or episode. The mobile interface provides a season/episode picker before the search.

### Release information

When supplied by Radarr/Sonarr, MEDIARR can display:

- Release title.
- Quality.
- Indexer.
- Protocol.
- Size.
- Age.
- Seeder/leecher information.
- Custom-format score/tags.
- Language information.
- Rejection reasons.

### Grabbing a release

Press **Grab** to ask Radarr/Sonarr to grab that exact cached release.

MEDIARR does **not** accept an arbitrary torrent/NZB URL from the browser for this operation. The browser sends the release identity and MEDIARR forwards the Radarr/Sonarr cached release identifiers.

Rejected releases remain visible rather than being silently hidden, and require confirmation before a manual grab is attempted.

Manual release search/grab is administrator-only.

---

## Library browser and monitoring controls

MEDIARR includes dedicated Radarr **Movies** and Sonarr **Shows** library views.

Features include:

- Title filtering.
- Download/missing status.
- Episode counts.
- Automatic search buttons.
- Manual release buttons.
- Detail views.
- Cached library mode for faster browsing.

### Sonarr season/episode controls

For an existing series, MEDIARR can display live Sonarr episode status and let an admin:

- Monitor an entire season.
- Search a season.
- Monitor/search an individual episode.
- Distinguish downloaded, monitored, and unmonitored episodes.

A series can also be added initially with nothing monitored so seasons/episodes can be selected manually afterward.

---

## Plex integration

MEDIARR supports two kinds of Plex integration.

### Server-level Plex configuration

The admin Plex connection powers features such as:

- Plex server health checks.
- Active session monitoring.
- Watched-state lookup.
- Server selection/sign-in helpers.
- Stream-block enforcement.

### Per-user Plex account linking

Each MEDIARR user can link a Plex account separately. This enables personal features without sharing another user's Plex identity.

Supported user features include:

- Plex PIN/OAuth-style sign-in flow.
- Plex Home user selection/switching.
- Personalized Continue Watching on the MEDIARR home page.
- Watchlist browsing.
- Watchlist add/remove.
- Watch history / Recently Watched.
- Artwork proxying.

### Active Plex streams

Admins can view currently active Plex sessions, including media title, episode information, playback state, and progress.

MEDIARR intentionally reduces user-identifying information before returning session data to the browser, and does not expose viewer IP addresses in that UI.

### Plex stream blocklist

An optional admin feature can enforce configured IP rules against active Plex sessions and terminate matching sessions with a custom message.

Use this carefully. It is intended for administrators who understand their Plex network and session behavior.

---

## SABnzbd activity

When SABnzbd is configured, signed-in users can view a trimmed read-only representation of the SABnzbd queue/history.

MEDIARR does not return the SABnzbd API key to the browser.

---

## WebDAV and local media playback

The Downloads/media browser supports either a remote WebDAV server or a local directory.

### WebDAV source

Configure:

- URL.
- Username.
- Password.
- Folder.
- Download mode.

MEDIARR can test the connection and report discovered media.

### Local source

Set the source to local and provide a path visible to the MEDIARR process/container.

### Playback modes

Browser-compatible media can be direct-played without transcoding. When needed, MEDIARR can use FFmpeg to convert unsupported audio/video into browser-friendly output.

Common reasons to transcode include:

- HEVC/H.265 video in a browser without support.
- 10-bit H.264 profiles not supported by the client.
- AC3/E-AC3/DTS/TrueHD audio.
- Audio-track changes.
- Stereo downmix.
- Lower output resolution/bitrate.

### HLS transcoding and seeking

Transcoded playback can use VOD HLS. MEDIARR exposes a seekable timeline and can restart encoding around a seek point rather than requiring the entire file to be encoded first.

### Quality presets

Available presets include:

- Original.
- 1080p High.
- 720p Medium.
- 480p Low.

Presets downscale when necessary and do not intentionally upscale lower-resolution content.

### Hardware acceleration

The application can probe for supported H.264 hardware encoders and use them when configured/available. `hwAccel=auto` attempts automatic selection; acceleration can also be disabled.

### Audio/subtitle tracks

MEDIARR can inspect media tracks using ffprobe and expose detected audio/subtitle options to the player.

### Download modes

WebDAV download behavior can be configured for different deployment constraints, including direct browser access or proxying through MEDIARR.

Use proxy mode when a browser cannot safely reach the WebDAV server directly, such as an HTTP WebDAV backend behind an HTTPS MEDIARR site.

---

## Automatic playback selection and Transcode Dashboard

MEDIARR v1.3.1 adds two administrator-focused playback tools: **Automatic playback selection** and the **Transcode Dashboard**. Both are available on the desktop and mobile interfaces.

### Automatic playback selection

Automatic playback selection is enabled by default and can be changed under **Admin → Playback & transcoding**.

Before starting a WebDAV/local video, MEDIARR uses `ffprobe` to inspect the source container, video codec, audio codec, and pixel format. It then chooses the least expensive playback path that is broadly browser-compatible:

| Source | Automatic decision | What MEDIARR does |
| --- | --- | --- |
| Browser-friendly container/codecs | **Direct play** | Sends the original media with range support; FFmpeg is not used. |
| H.264 + AAC/MP3 in a container that browsers do not reliably play directly, such as MKV | **Remux** | Uses seekable HLS and copies the compatible streams without re-encoding them. |
| H.264 video with incompatible audio such as AC3/E-AC3/DTS/TrueHD | **Audio transcode** | Copies H.264 video and converts only the audio to AAC. |
| HEVC/H.265, unsupported/10-bit video, or another HLS-incompatible video stream | **Video transcode** | Converts video to browser-friendly H.264 and converts audio only when necessary. |

The goal is to avoid unnecessary quality loss and CPU/GPU work. A remux changes the streaming container but does **not** re-encode compatible video/audio.

If `ffmpeg` or `ffprobe` is unavailable, MEDIARR falls back to the older direct-play-first behavior. The official Docker image includes both tools.

### Manual playback overrides

Automatic selection does not remove the existing player controls. These still take priority:

- **Force transcode**.
- Quality selection: Original, 1080p, 720p, or 480p.
- Stereo downmix.
- Selecting an alternate audio track.

The older **Force transcoded playback by default** WebDAV/local setting also overrides automatic selection when enabled.

### Transcode Dashboard

Administrators can open **Transcodes** from the desktop left navigation drawer, **Transcode Dashboard** from the mobile menu, or use the button under **Admin → Playback & transcoding**. The dashboard refreshes every five seconds while open.

The dashboard shows MEDIARR's active FFmpeg-backed sessions, including:

- File title and MEDIARR user.
- Local vs WebDAV source.
- Seekable HLS vs live fallback streaming.
- Remux, audio-transcode, or video-transcode mode.
- Source video/audio codecs.
- Selected quality.
- Encoder in use (`copy`, `libx264`, NVENC, Quick Sync, or VideoToolbox when available).
- Hardware-acceleration state.
- Session age.
- HLS generation progress when available.

When Plex is configured, the same dashboard also includes active Plex playback decisions and technical details reported by Plex, such as direct play/direct stream/transcode mode, source/stream bitrate, target codecs/resolution, hardware-transcode state, transcode speed, and progress.

> [!NOTE]
> A MEDIARR session that is truly direct-playing does not start FFmpeg, so it does not appear in the MEDIARR FFmpeg session list. Plex direct-play sessions still appear in the Plex portion of the dashboard because Plex reports all active sessions.

The dashboard API is administrator-only (`GET /api/admin/transcodes`). MEDIARR does not return WebDAV credentials, source URLs containing credentials, or Plex viewer IP addresses through this dashboard.

---

## Calendar, health, and activity

### Upcoming calendar

MEDIARR merges Radarr and Sonarr calendar information into one agenda.

You can filter movies/TV and switch between different time windows. Items include relevant release/air-date information and download status where available.

### Service health

MEDIARR can monitor configured services and maintain health history on disk. The history survives restarts, allowing the admin view to show previous service outages instead of only current status.

### Stream/activity view

MEDIARR can report active playback/download activity handled by MEDIARR. Admins can also see Plex session information when Plex is configured.

---

## Favorites and automation

Users can save favorites and use them with discovery/upcoming workflows.

MEDIARR also includes a resumable automatic-add job. Job state is stored on disk so an interrupted job can resume after a restart.

Admins can configure the interval between additions and an optional minimum runtime filter.

---

## RSS auto-add

MEDIARR can poll one or more RSS/Atom release feeds.

The automation can:

- Parse release names into movie/series candidates.
- Add movies to Radarr.
- Add TV series to Sonarr.
- Restrict movie additions by minimum year.
- Enable/disable movie or TV additions independently.
- Cap additions per run.
- Remember previously processed feed items.
- Keep a run/activity log.
- Send notification events.

RSS items are de-duplicated using persistent state, and old seen entries are periodically pruned.

Feed automation is administrator-controlled.

---

## Notifications

MEDIARR has a server-side notification dispatcher and can send selected events to multiple targets.

Supported target types in v1.3.0 include:

- Discord.
- Slack.
- Telegram.
- ntfy.
- Gotify.
- Pushover.
- Pushbullet.
- Generic webhook.

Configurable event classes include additions, RSS events, blocked Plex streams, background jobs, errors, service-down events, and optionally logins.

Notification URLs/tokens are stored server-side and masked before configuration is returned to the browser.

Use **Test notification** after adding a destination.

---

## Configuration backups and restore

MEDIARR can snapshot non-regenerable configuration/state into the `backups/` directory.

Backups can include:

- Settings.
- Users.
- Favorites.
- Add/activity history.
- RSS state.
- Plex block log/state.
- Auto-add job state.

Regenerable caches are deliberately excluded.

### Automatic backups

By default MEDIARR can:

- Create a debounced backup after configuration/user changes.
- Create scheduled backups.
- Keep a configurable number of backup files.

### Manual backups

Admins can create and download backups from the admin UI.

### Restore safety

Before restoring a backup, MEDIARR creates a **pre-restore safety snapshot** of the current state. Restoring also clears relevant caches and active sessions so stale state is not reused.

### System Update backup

A one-click Docker update also creates a configuration backup before replacing the running MEDIARR container.

---

## Docker container controls

MEDIARR can provide administrator-only Start / Restart / Stop / Update controls for selected Docker containers. Update pulls the container's currently configured image tag, compares the resulting image ID, and recreates the container only when a newer image was actually pulled.

The default allow-list is:

```text
plex
radarr
sonarr
```

You can add other exact container names or Docker Compose service names, for example:

```text
prowlarr
sabnzbd
qbittorrent
tautulli
overseerr
```

Compose-service matching lets an entry such as `radarr` match a generated container name such as `media-stack-radarr-1` when the Docker Compose service label identifies it as `radarr`.

### Enabling Docker controls

The Compose file mounts the socket by default:

```yaml
- ${DOCKER_SOCKET_HOST:-/var/run/docker.sock}:/var/run/docker.sock
```

Then:

1. Sign in as an admin.
2. Open **Admin → Docker controls**.
3. Review the allow-list.
4. Enable Docker controls.
5. Save.

### Restrictions enforced by MEDIARR

The API:

- Requires an administrator session.
- Accepts only Start, Stop, Restart, and Update actions.
- Requires an exact allowed container/service match.
- Refuses to control MEDIARR's own container; MEDIARR itself continues to use the dedicated System Update flow.
- Update refreshes the currently configured image tag; it does not silently change pinned version tags to `latest`.
- Update is disabled for immutable digest/image-ID references.
- When an image changes, MEDIARR recreates the container with its existing environment, ports, mounts/volumes, networks, restart policy, labels, device/resource settings, and running/stopped state.
- If recreation fails, MEDIARR attempts to restore the previous container using its previous image ID.
- Does not accept arbitrary Docker API paths from the browser.

> [!CAUTION]
> Mounting `/var/run/docker.sock` gives the MEDIARR container extremely powerful access to the Docker host. Docker socket access should be treated as equivalent to host-administrator/root capability. If you do not need Docker controls or one-click updates, remove the socket mount.

### Rootless Docker

For a nonstandard/rootless socket:

```bash
DOCKER_SOCKET_HOST=/run/user/1000/docker.sock docker compose up -d --build
```

The host socket is still presented inside MEDIARR as `/var/run/docker.sock`.

---

## System maintenance commands

Admins can define a small list of saved maintenance commands and run those saved entries from the System/Admin interface.

MEDIARR does **not** accept an arbitrary command string in the run request. A run request references a previously saved command ID.

This is still a high-risk administrative capability because the configured command itself can do anything the MEDIARR operating-system user is permitted to do.

Keep this feature disabled unless you specifically need it.

---

## System Update

MEDIARR v1.3.0 adds an administrator-only System Update page. Administrators are also notified in-app when MEDIARR detects a newer published release: desktop and mobile show a one-time-per-version popup with a **Review update** button that opens System Update, while the Update menu keeps a **NEW** badge as long as an update is available.

### Release checking

MEDIARR can query this repository's GitHub Releases feed and show:

- Installed version.
- Latest available release.
- Release date.
- Release notes.
- Whether a newer semantic version is available.

Source/non-Docker installs get a link to the published release artifact.

### One-click Docker update

An eligible Docker install with Docker socket access can perform a controlled update.

The update sequence is designed to be recoverable:

```text
Check release
     │
     ▼
Create configuration backup
     │
     ▼
Pull exact versioned GHCR image
     │
     ▼
Launch short-lived updater helper
     │
     ▼
Replace MEDIARR container
     │
     ▼
Wait for Docker health check
    / \
   /   \
 OK   Failed
 │      │
 ▼      ▼
Done   Remove failed replacement
            │
            ▼
      Restore previous image
```

The helper preserves important container settings such as mounts, exposed ports, labels, networks, and restart policy.

The replacement must become healthy. If it does not, the helper attempts to recreate the previous MEDIARR container from the previous image.

### Why releases use exact image versions

The release workflow publishes both:

```text
:1.3.1
:latest
```

MEDIARR self-update uses the exact release version so rollback never depends on what the moving `latest` tag currently points to.

---

## Mobile interface

MEDIARR includes a separate touch-friendly interface at:

```text
/m
```

Phones/tablets can be redirected automatically from `/`. Append `?d=1` to force the desktop interface.

The mobile interface includes the major workflows from desktop, including:

- Login/setup.
- Discovery/search.
- Movie/TV details.
- Add to Radarr/Sonarr.
- Libraries.
- Manual release browsing.
- Calendar.
- Health.
- Downloads/playback.
- Admin/user management.
- Docker controls.
- System Update.
- Settings.

Bootstrap assets are cached locally by MEDIARR after first retrieval so subsequent use does not depend on a CDN request.

---

## External API

Each MEDIARR user can generate an API key from their account interface. The external API lives under:

```text
/api/v1
```

The API executes with the permissions and quota of the user who owns the key.

Current high-level endpoints include:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/ping` | Validate the key and return user/quota information |
| `GET` | `/api/v1/search?q=...` | Search configured discovery data |
| `GET` | `/api/v1/library` | Read Radarr/Sonarr library summaries |
| `POST` | `/api/v1/add` | Add a movie/series using the calling user's permissions/quota |
| `GET` | `/api/v1/activity` | Read permitted active MEDIARR activity |
| `GET` | `/api/v1/sessions` | Read permitted session/activity information when available |

Treat API keys like passwords. Revoke and regenerate a key if it is exposed.

---

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `7575` | HTTP listen port |
| `DATA_DIR` | app directory / `/data` in Docker | Persistent state directory |
| `SESSION_HOURS` | `1` | Login session lifetime in hours |
| `SECURE_COOKIES` | automatic | Force secure-cookie behavior when set appropriately |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker Engine Unix socket inside the container/process |
| `MEDIARR_VERSION` | package version | Runtime version override, mainly for release images |
| `MEDIARR_UPDATE_REPO` | build/config dependent | GitHub `owner/repository` used by System Update |
| `MEDIARR_UPDATE_API_BASE` | GitHub API default | Advanced/test override for update metadata requests |

The updater helper also receives internal `MEDIARR_UPDATE_*` environment variables during a self-update. They are not normal user configuration options.

---

## Reverse proxy and HTTPS

MEDIARR is designed to work behind a normal same-origin reverse proxy. A `Caddyfile.example` is included.

A minimal Caddy example:

```caddyfile
mediarr.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:7575
}
```

Run MEDIARR bound to localhost:

```bash
HOST=127.0.0.1 PORT=7575 node server.js
```

MEDIARR serves both the UI and `/api` endpoints, so proxy the **entire site** to MEDIARR. Do not configure the reverse proxy to serve MEDIARR's HTML itself while forwarding only selected API paths.

When HTTPS is detected through the proxy, MEDIARR can mark the session cookie Secure. If TLS terminates in a way MEDIARR cannot infer, explicitly configure secure cookies.

### Docker + reverse proxy

If your proxy is another container, put the proxy and MEDIARR on a shared Docker network and proxy to:

```text
http://mediarr:7575
```

---

## Security

MEDIARR is an administrative application. Review the following before exposing it outside your LAN.

### Credentials

Service credentials are stored on the server, not in frontend source. Sanitized settings responses intentionally omit raw Radarr/Sonarr/Plex/SAB/WebDAV secrets.

However, the server still needs those credentials locally. Protect the data directory.

### Authentication

- Passwords are scrypt-hashed.
- Sessions use HttpOnly cookies.
- Administrative APIs are checked server-side, not only hidden in the UI.
- Manual-release endpoints are admin-only.
- Docker-control endpoints are admin-only.

### Docker socket

Docker socket access is the highest-risk optional feature. A process controlling the Docker daemon can normally obtain effective root control over the host.

Remove this mount if you do not need Docker controls or self-update:

```yaml
# Remove/comment this line:
- /var/run/docker.sock:/var/run/docker.sock
```

### System commands

Keep saved shell commands disabled unless required. Review every saved command as if it were a system administration script.

### Internet exposure

If exposing MEDIARR remotely:

- Put it behind HTTPS.
- Use strong passwords.
- Keep MEDIARR updated.
- Restrict reverse-proxy/network access where practical.
- Do not expose Radarr/Sonarr/Plex administration ports unnecessarily.
- Consider removing Docker socket access on internet-facing deployments.

### Reporting security issues

See [`SECURITY.md`](SECURITY.md).

---

## Updating MEDIARR

### From v1.3.0 onward using System Update

For an official Docker installation with Docker socket access:

1. Sign in as an admin.
2. Open **System Update**.
3. Check for updates.
4. Review release notes.
5. Choose **Update now**.

MEDIARR creates a pre-update backup and uses the rollback-aware updater described earlier.

### Manual Docker source update

```bash
git pull
docker compose up -d --build
```

Do **not** delete `./data`.

### Manual release-image update

Change the image tag in your Compose file to the desired version and run:

```bash
docker compose pull
docker compose up -d
```

### Direct Node.js update

Back up your data directory, update the source files, and restart Node.

Because runtime state is externalized through `DATA_DIR`, upgrading the application code should not require replacing configuration files.

---

## Backup and migration

### Recommended Docker backup

Back up the complete host `data/` directory:

```bash
tar -czf mediarr-data-backup.tar.gz data/
```

For an application-level backup, also use MEDIARR's built-in backup page.

### Move to another server

1. Stop MEDIARR.
2. Copy the persistent `data/` directory to the new server.
3. Copy/update your Compose file.
4. Make sure local-media paths and Docker networking match the new host.
5. Start MEDIARR.
6. Test Radarr, Sonarr, Plex, SABnzbd, and WebDAV connections.

### Migrate a source install to Docker

Copy the existing JSON runtime files into the new `./data/` directory before starting the container.

---

## Troubleshooting

### MEDIARR cannot connect to Radarr/Sonarr from Docker

`localhost` inside the MEDIARR container refers to MEDIARR itself, not the Docker host.

If Radarr/Sonarr run on the host, use:

```text
http://host.docker.internal:7878
http://host.docker.internal:8989
```

If they are containers, place them on a shared network and use service names.

### Permission denied writing `/data`

Ensure the host directory exists and is writable by the container account:

```bash
mkdir -p data
```

On Linux, inspect ownership/permissions if the container logs show `EACCES`.

### Docker controls show a socket/permission error

Verify the socket is mounted:

```bash
docker inspect mediarr
```

and confirm the host Docker socket exists. The entrypoint attempts to account for the socket's group ID before dropping privileges to the Node user.

For rootless Docker, set `DOCKER_SOCKET_HOST` to the correct host socket.

### Docker controls cannot find a Compose container

Add the **Compose service name** to the allow-list, not only the generated container name.

For example, allow:

```text
radarr
```

rather than relying on:

```text
media-stack-radarr-1
```

### Self-update is unavailable

Automatic update requires all of the following:

- Docker deployment.
- Docker socket access.
- A configured GitHub update repository.
- A published release with a versioned GHCR image.
- The current MEDIARR container must be inspectable/recreatable by the Docker daemon.

Non-Docker installs intentionally get release checking/download links instead of trying to overwrite a running source tree.

### Release search returns no results

Confirm:

- Radarr/Sonarr indexers are functioning.
- The title is recognized by the corresponding service.
- You selected a valid movie, season, or episode.
- The Radarr/Sonarr API key is valid.

The result set comes from Radarr/Sonarr's own release search, so MEDIARR cannot return releases that the upstream service/indexers did not find.

### Video will not play

Check:

- FFmpeg is installed (`ffmpeg` and `ffprobe`) for a direct Node install.
- The file path is visible inside the Docker container.
- WebDAV credentials are valid.
- The browser supports direct-play codecs, or transcoding is enabled.
- Hardware acceleration is not forcing an unavailable encoder; try disabling it.

### Login fails behind a reverse proxy

Proxy the entire site—including `/api`—to MEDIARR. A configuration that serves HTML separately but does not forward API requests can cause JSON/parser errors on login.

### Users are signed out after restart

Expected behavior. Sessions are intentionally held in memory; persisted user accounts remain, but active login sessions do not survive a MEDIARR restart.

### Configuration file is damaged

MEDIARR attempts to rescue `config.json` from the newest valid application backup when it detects a corrupt configuration file.

You can also restore a backup manually from the admin backup interface.

---

## Project layout

```text
MEDIARR/
├── .github/
│   └── workflows/
│       └── release.yml          # Tag -> GHCR images + GitHub Release ZIP
├── docs/
│   └── PUBLISHING.md            # Maintainer release instructions
├── public/
│   ├── index.html               # Desktop application
│   └── mobile.html              # Mobile application
├── .dockerignore
├── .gitignore
├── Caddyfile.example            # Reverse-proxy example
├── CHANGELOG.md
├── Dockerfile
├── README.md
├── SECURITY.md
├── docker-compose.yml
├── docker-entrypoint.sh         # Docker socket group handling + privilege drop
├── package.json
├── docker-recreate.js           # Shared container recreate + rename-and-restore rollback
├── server.js                    # Main HTTP server/API/integrations/background jobs
└── update-helper.js             # One-shot Docker update/rollback helper
```

The project currently favors a compact architecture over a large dependency graph: the backend primarily lives in `server.js`, while desktop/mobile each have their own single-page frontend.

---

## Publishing releases

Maintainer instructions are in [`docs/PUBLISHING.md`](docs/PUBLISHING.md).

The short version:

1. Update `package.json` with the new semantic version.
2. Update `CHANGELOG.md`.
3. Commit and push to `main`.
4. Create a matching tag such as `v1.3.1`.
5. Push the tag.

The GitHub Actions workflow will:

1. Verify the tag matches `package.json`.
2. Build a versioned GHCR image.
3. Tag the same image as `latest`.
4. Publish both images.
5. Build a clean release ZIP without runtime state/secrets.
6. Create a GitHub Release and attach the ZIP.

The official image embeds its source repository so installed instances know which Releases feed to check.

After publishing the first GHCR package, make the package public if you want community installations to pull it anonymously.

---

## Contributing

Contributions are welcome.

When proposing a change:

1. Fork the repository.
2. Create a focused branch.
3. Keep runtime secrets and `data/` files out of commits.
4. Test both desktop and mobile when changing shared UI behavior.
5. Run a Node syntax check before submitting:

   ```bash
   node --check server.js
   node --check update-helper.js
   node --check docker-recreate.js
   ```

6. For Docker changes, validate the Compose file and build the image when Docker is available.
7. Explain security implications for changes involving authentication, Docker, shell execution, downloads, or updater behavior.
8. Open a pull request with a clear description and testing notes.

Because desktop and mobile currently maintain separate frontend implementations, a feature added to one interface may need an equivalent change in the other.

---

## License

No open-source license has been selected for this repository yet.

Publishing source code on GitHub does **not** automatically grant broad reuse/redistribution rights. If the project is intended to accept outside redistribution or derivative works, add an explicit license such as MIT, Apache-2.0, GPL-3.0, or another license appropriate for the project.

---

## Acknowledgements

MEDIARR builds on the APIs and ecosystems of projects/services including Radarr, Sonarr, Plex, TMDB, SABnzbd, Docker, GitHub, Bootstrap, hls.js, FFmpeg, and the wider self-hosted media community.

Project home: **https://github.com/XxSmack003xX/MEDIARR**


## Desktop navigation drawer

MEDIARR **v1.3.2** replaces the crowded desktop header action strip with a collapsible navigation drawer on the left side of the application. The header now stays focused on the MEDIARR brand and a single **Menu** control, while the existing actions are organized into logical sections inside the drawer.

The drawer groups tools into **Library**, **Discover**, **Account**, **Monitoring**, **Administration**, **Support**, and **Session** sections. Existing permissions are unchanged: admin-only actions such as **Transcodes**, **Settings**, **Admin**, **System Update**, Docker controls, and other administrative tools are still hidden from normal users.

The drawer closes automatically when an action is selected, when the dimmed backdrop is clicked, or when **Escape** is pressed. Focus is moved into the drawer when it opens and returned to the previous control when it closes. The existing mobile Bootstrap menu remains unchanged.

