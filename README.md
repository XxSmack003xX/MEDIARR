<div align="center">

# MEDIARR

## MEDIARR 2.10

MEDIARR 2.10 adds direct music links and fixes "empty" folders in Downloads.

- **Direct links for music** — copy a link to any song, album or playlist and play it outside MEDIARR (VLC, a browser, Kodi, foobar2000, a smart speaker) without signing in. Links use a **link key** that only plays music and has its own expiry, from 1 hour to 1 year (or never, if the admin allows), which you can change or revoke at any time. Albums and playlists are M3U playlists; links can also convert to MP3 for players without FLAC. See [Direct music links](#direct-music-links).
- **Downloads no longer hide videos silently** — a movie folder could look empty when its video was a link (symlink) to a folder MEDIARR can't see, as with debrid or rclone mounts, or when the WebDAV server redirected folder names with brackets. Such videos are now listed as unavailable with the reason, WebDAV redirects are followed, and other files (subtitles, .nfo) are counted.

## MEDIARR 2.9

MEDIARR 2.9 gives the Music player Plex-style matching.

- **Fix match** — on any album (or artist), search MusicBrainz and Deezer yourself and pick the right one from a list with covers, year, type, track count and a match score. Your choice is kept and never replaced automatically.
- **Refresh metadata** and **Unmatch**, like Plex, in each album's and artist's **⋯** menu.
- **Album matches** — a new admin page lists every album as Matched (with its score), Fixed by hand, No match, Unmatched or Not looked up yet, with **Fix match** on each row. Low-confidence matches are flagged for a second look.
- **Better automatic matching** — "ACDC" now matches "AC/DC", and folder leftovers such as "CD", "Disc 2", "[FLAC]" or a leading year no longer get in the way.
- **"MusicBrainz is busy" fixed** — when MusicBrainz asks MEDIARR to slow down, it now waits as long as asked and tries again instead of giving up on those albums until the next day, and the settings page no longer shows it as an error.

## MEDIARR 2.8

MEDIARR 2.8 looks up the details your music files are missing.

- **Cover art** from the **Cover Art Archive** (up to 1200 px), or from **Deezer** when the Cover Art Archive has none, for albums without their own picture.
- **Release years, genres and release types** (EP, single, live, compilation) from **MusicBrainz**, the open music encyclopedia that Lidarr also uses, with Deezer as a fallback.
- **Artist photos** from Deezer on the Artists page and artist pages.
- Album and artist pages say where each detail came from, with links to MusicBrainz and Deezer. Admins can look an album up again or stop using online info for it.
- Lookups run in the background after each scan. Only artist and album names are sent, and your music files are never changed. Turn it off, choose sources or prefer online covers in the player's **Music settings**. See [Online album info](#online-album-info).

## MEDIARR 2.7

MEDIARR 2.7 adds a **Music player** for the music on your server, separate from the video player.

- **Your own folders** — admins list any number of music folders in Settings. MEDIARR scans each one and every folder inside it, however deep, and picks up new music on a schedule, after Lidarr imports, and when it starts.
- **Albums kept together** — each folder of songs becomes one album, Disc 1 / CD2 sub-folders join their album, and folders that mix many albums fall back to the album tags. Each person can switch this off, or make every folder its own album.
- **Plays almost anything** — MP3, FLAC (including 24-bit hi-res), OGG Vorbis, Opus, M4A/AAC, ALAC, WAV, AIFF, WMA, APE, WavPack, DSD and more. Formats a browser can't play are converted on the fly with ffmpeg, which the Docker image includes.
- **An iTunes-style library** — Listen Now, Recently Added, Artists, Albums, Songs, Genres, cover art, Up Next, shuffle by album, repeat, playlists, play counts, smart playlists, search, keyboard shortcuts, and lock-screen controls on phones.
- **Open it** from **Music player** in the desktop menu or **🎧 Music player** in the phone menu, or go to `/music`. See [Music player](#music-player).

## MEDIARR 2.6

MEDIARR 2.6 lets each person link their **Spotify** account.

- **My Spotify** — a new menu item shows your top artists, the artists you follow and your saved albums, each marked when it's already in the music library.
- **Request from Spotify** — one click requests an artist or album through Lidarr. Request limits, **Can add: Music** and request history apply as usual.
- **Admin setup** — add your own Spotify app (Client ID, Client secret, redirect URI) in Settings; see [Spotify linking](#spotify-linking).
- **Phones** — the search-mode bar no longer makes the installed app wider than the screen, so windows fit on phones again.

## MEDIARR 2.5

MEDIARR 2.5 lets admins choose what each person can add.

- **Can add: Movies, TV, Music** — three checkboxes per user in User management (desktop and mobile) and on the Add-a-user form. Untick one and that person can still search and browse it, but can't add it.
- **Clear on screen** — buttons they can't use read **Adding off**, and title and artist pages say adding isn't enabled for their account instead of showing an Add or Request button.
- **Enforced everywhere** — the server checks the setting on every add: search cards, title pages, the hub, music requests, Auto add all and personal API keys. Changes apply straight away, without signing out.
- Existing accounts keep every permission after the update, and admins can always add everything.

## MEDIARR 2.4

MEDIARR 2.4 adds **Lidarr** so music sits beside movies and TV.

- **Music search** — a new **🎵 Music** search mode finds artists and albums through Lidarr and marks what's already in your library. It appears once Lidarr is connected.
- **Request music** — add a whole artist, or ask for one album. Requesting a single album by a new artist adds the artist with only that album monitored, so nothing else downloads. Daily request limits count music too.
- **Artist pages** — albums with release year and tracks on disk. Users request albums from here; admins turn album monitoring on or off and search for an album or the whole artist.
- **Music everywhere else** — a Music library for admins, album releases on the calendar (with a Music filter), a Lidarr tab in Download Activity, Lidarr in Health, music in request history and on home pages, and download notifications such as "Radiohead — Kid A".
- **Setup** — Lidarr has its own step in the setup wizard and its own Settings block (quality profile, metadata profile, root folder, and which albums to monitor). Lidarr's webhook URL is listed with Radarr's and Sonarr's.
- **Setup wizard fix** — going Back and then Next no longer clears an API key you typed earlier.

Music search and requests are on the desktop page and the installed app; the separate mobile page gets them in a later release.

## MEDIARR 2.3

MEDIARR 2.3 is a usability release for desktop, mobile and the installed app.

- **Logo → home** — click the MEDIARR logo (or the new **Home** menu item) to clear the search and return to your home page. Ctrl/Cmd-click opens home in a new tab.
- **Escape and Back work** — Escape closes the window on top. The browser or phone Back button closes windows one at a time instead of leaving MEDIARR, and steps back through your searches.
- **Shareable links** — the address bar follows your search (`?q=matrix`, `?mode=person&q=keanu`) and the title you're viewing (`?title=movie:tt0133093`), so a link opens the same search or title after sign-in.
- **One navigation** — the floating "MEDIARR 2.0" button is gone. The hub's Overview, Requests, Notifications, Library health, Storage & quality and Automation (admins) are in the menu, and a bell in the header shows unread notifications.
- **Clear search errors** — if the search service can't be reached, MEDIARR says so and offers **Try again** instead of showing "No results".
- **Keyboard and touch** — every menu item works with Tab and Enter, focus moves into windows and returns afterwards, the hidden menu is skipped by Tab, and buttons on touch screens are at least 44px tall.
- **Tidier menu** — the theme switch has a label, "Now streaming" shows its count only when Plex is set up, icons match, and the header no longer advertises "Cinemeta · Radarr · Sonarr".

## MEDIARR 2.2

MEDIARR 2.2 moves history and per-user state into a built-in database.

- **Stay signed in through restarts and updates** — login sessions are stored in the database (only a hash of each token), so an update no longer signs everyone out.
- **Much longer history** — the activity log keeps up to 50,000 entries (it was capped at 3,000), and the admin Activity page searches all of it.
- **Safer writes** — watch progress, the Notification Center and logs are updated one record at a time instead of rewriting whole files, so a crash can't damage other users' data.
- **Automatic migration** — on first launch MEDIARR saves a backup of the old files, moves them into `mediarr.db`, checks that every record arrived, and then deletes them. Nothing to do by hand.
- **Same backups** — backups keep the same format, so 2.2 restores older backups and older versions can still read a 2.2 backup.
- **Requires Node.js 22.13+** for source installs (the database is built into Node, so there is still no `npm install`). Docker images already include it.

Settings and accounts (`config.json`, `users.json` and friends) intentionally stay as editable JSON files.

## MEDIARR 2.1

MEDIARR 2.1 is a speed and security release.

- **Faster hub and search** — the 2.0 hub and Universal Search reuse a shared library list (refreshed on adds, edits and Radarr/Sonarr webhooks) instead of downloading the whole library on every keystroke.
- **Smaller, cached pages** — HTML, JavaScript, CSS and API JSON are Brotli/gzip-compressed, and app files are revalidated with ETags, so a reload is a quick `304` instead of a full download.
- **Shared polling** — several people watching Download Activity share one set of SABnzbd/Radarr/Sonarr requests.
- **Quicker playback start** — one cached ffprobe per file serves both the playback plan and the audio/subtitle list.
- **No event-loop stalls** — logins hash passwords off the main thread, and the activity log is written in the background in batches.
- **Security fixes** — admin-only actions are now enforced on the server for every route, and regular users can no longer reach stored service credentials. See the [changelog](CHANGELOG.md#210).

## MEDIARR 2.0

MEDIARR 2.0 adds a shared responsive **Media Intelligence Hub** on desktop, mobile, and the installed PWA. The hub correlates Radarr, Sonarr, SABnzbd, Plex, watch progress, request/add history, health monitoring, and the on-disk state reported by the Arr applications into one operational view.

### 2.0 highlights

- **Media Intelligence** — monitored movies without files, series with missing aired episodes, unmonitored titles, service health, active downloads, Plex streams, and library totals in one snapshot.
- **Unified lifecycle / pipeline** — request and add history sits beside active download state and recent Radarr/Sonarr import events.
- **Persistent Notification Center** — MEDIARR events are retained locally for each user's read/unread inbox even when external notification providers are disabled.
- **Universal Search** — search the existing Radarr/Sonarr library and TMDB together; TMDB-only results can be added without leaving the 2.0 hub.
- **Request history** — users see their own request/add history; administrators see the server-wide request trail.
- **Storage & Quality Intelligence** — aggregates Arr-reported movie/TV storage and highlights the largest library items and available quality labels.
- **Automation & Self-Healing** — report-only mode audits missing media; optional repair mode queues safe Radarr movie searches and Sonarr searches for aired, monitored, missing episodes. Scheduled repair has a minimum 15-minute interval.
- **Responsive shared UI** — all new 2.0 features live in one `v200.js` interface used by desktop, mobile, and PWA instead of duplicating the feature implementation.
- **PWA-first launch** — installed MEDIARR launches the full desktop application shell on phones and opens directly into the hub overview. App shortcuts open Intelligence, Search, Pipeline, and Notifications.
- **Backups** — persistent 2.0 inbox/automation state is included in MEDIARR configuration backups.

The hub is opened from the menu's **Insights** section and the header bell on both desktop and mobile (since 2.3 there is no floating launcher button).


**A self-hosted media discovery, request, library-management, playback, and server-control dashboard for Radarr, Sonarr, Lidarr, Plex, Docker, SABnzbd, WebDAV/local media, and more.**

[![Version](https://img.shields.io/badge/version-2.10.0-35c5f0)](https://github.com/XxSmack003xX/MEDIARR/releases)
[![Node.js](https://img.shields.io/badge/Node.js-22.13%2B-43853d)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-supported-2496ed)](https://www.docker.com/)
[![License](https://img.shields.io/badge/license-not%20yet%20selected-lightgrey)](#license)

**Repository:** https://github.com/XxSmack003xX/MEDIARR

</div>

---

## What is MEDIARR?

MEDIARR is a lightweight, self-hosted web application that puts several common media-server workflows behind one responsive interface.

At its core, MEDIARR lets users discover movies and TV shows and send them to **Radarr** and **Sonarr**. It also adds features that are normally spread across several applications: manual release selection, library browsing, Plex activity and account tools, server health history, WebDAV/local-file playback, SABnzbd activity, Docker container controls, configuration backups, notifications, RSS automation, user quotas, an external API, and GitHub-based application updates.

The server is intentionally small: it is written with Node.js built-ins and does not require an npm dependency install. The desktop and mobile interfaces are served by the same Node.js process, and service credentials stay on the MEDIARR server instead of being embedded in browser JavaScript.

This README is written against the **v2.10.0 source in this repository**. Feature descriptions below are based on the routes and configuration that actually exist in `server.js`, not on a future roadmap.

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
- [Playback intelligence and path mapping](#playback-intelligence-and-path-mapping)
- [Movie and TV discovery](#movie-and-tv-discovery)
- [Radarr and Sonarr integration](#radarr-and-sonarr-integration)
- [Lidarr and music](#lidarr-and-music)
- [Music player](#music-player)
- [Unified media detail](#unified-media-detail)
- [Real-time events and Live Dashboard](#real-time-events-and-live-dashboard)
- [Manual release search](#manual-release-search)
- [Library browser and monitoring controls](#library-browser-and-monitoring-controls)
- [Plex integration](#plex-integration)
- [Spotify linking](#spotify-linking)
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
- Cast the active MEDIARR player to browser-supported TVs and streaming devices on the local network.

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

- Node.js 22.13+ with no runtime npm dependencies (uses Node's built-in SQLite).
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
| **Lidarr** | Music search and requests, artist pages, album monitoring and searches, music library, calendar, download queue, health | Optional |
| **Spotify** | Each person's top artists, followed artists and saved albums, to request through Lidarr | Optional |
| **TMDB** | Rich discovery, person/year/studio search, metadata and recommendations | Optional but strongly recommended |
| **Plex** | Health, sessions, watchlists, history, watched state, account linking | Optional |
| **SABnzbd** | Download Activity Center, queue/history visibility | Optional |
| **WebDAV** | Remote media browsing, playback and downloads | Optional |
| **Docker Engine** | Container status/control and one-click self-update | Optional |
| **GitHub Releases / GHCR** | Version checking, release notes and official Docker updates | Optional |
| **RSS/Atom feeds** | Automated movie/series discovery and additions | Optional |
| **Discord / Slack / Telegram / ntfy / Gotify / Pushover / Pushbullet / generic webhook** | Notifications | Optional |

MEDIARR is not affiliated with Radarr, Sonarr, Lidarr, Spotify, Plex, TMDB, SABnzbd, Stremio, Docker, or GitHub.

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

Runtime state is stored in the MEDIARR data directory: settings and accounts as JSON files, history and per-user state in one SQLite file, `mediarr.db`. In Docker this is `/data`; source installs default to the application directory unless `DATA_DIR` is set.

---

## Progressive Web App (PWA)

MEDIARR can be installed as a standalone Progressive Web App on supported desktop and mobile browsers.

- Includes a web app manifest, standalone display mode, MEDIARR app icons, theme colors, and a service worker.
- iPhone/iPad users can open MEDIARR in Safari and use **Share → Add to Home Screen**.
- Android/Chrome and supported desktop Chromium browsers can use the browser's **Install app** action.
- The service worker deliberately does **not** cache authenticated API responses, media streams, HLS sessions, or versioned application JavaScript. MEDIARR continues to read live server state and new releases are not hidden behind stale PWA caches.
- A small shell/icon cache provides install metadata and a graceful app-shell fallback if navigation temporarily loses network access.
- PWA installation requires a secure browser context. HTTPS is recommended for normal remote/LAN use; browsers also treat localhost specially for development.

---

## Requirements

### Docker installation

- Docker Engine or Docker Desktop.
- Docker Compose v2 is recommended.
- Port `7575` available, unless changed.
- Optional Docker socket access for container controls and self-update.

### Direct Node.js installation

- Node.js **22.13 or newer** (MEDIARR uses Node's built-in SQLite module).
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
unzip mediarr-2.1.0.zip
cd mediarr-2.1.0
mkdir -p data
docker compose -f docker-compose.release.yml up -d
```

Using versioned images is important because MEDIARR's updater can retain the previous image as a deterministic rollback target.

The release workflow publishes images in this form:

```text
ghcr.io/xxsmack003xx/mediarr:2.1.0
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
3. Optional Lidarr URL/API key, connection test, quality profile, metadata profile, and root folder.
4. An optional TMDB API key test.
5. Copy-ready Radarr, Sonarr and Lidarr webhook URLs for MEDIARR's real-time event system.

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

### Lidarr

Typical URL:

```text
http://192.168.1.50:8686
```

You need:

- Lidarr URL.
- API key (**Settings → General → Security** in Lidarr).
- Quality profile, metadata profile and root folder. **Test & load options** pre-selects the root folder's own defaults.
- Which albums to monitor when an artist is added: all, future, missing, existing, latest, first, or none.

Lidarr is optional. The **🎵 Music** search mode appears only after it is connected.

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
| `mediarr.db` (+ `-wal`, `-shm`) | SQLite database: activity/audit log, watch progress, Notification Center, error log, service-health history, Plex block log, 2.0 automation settings and login sessions |
| `favorites.json` | Per-user favorites |
| `rss.json` | RSS seen-state and RSS run log |
| `autoadd.json` | Resumable auto-add job state |
| `library-cache.json` | Cached Radarr/Sonarr library index |
| `tmdb-map.json` | Cached TMDB-to-IMDb/TVDB ID mappings |
| `backups/` | MEDIARR application-level configuration snapshots |

Before 2.2, the database contents lived in `adds.json`, `watch-progress.json`, `v2-state.json`, `errors.json`, `health.json` and `blocked.json`. The first 2.2 launch moves them into `mediarr.db`, verifies every record, saves a backup named `mediarr-config-<date>-pre-sqlite-migration.json` (which is never pruned automatically), and then deletes the old files. If anything goes wrong the old files are left in place and the migration retries on the next start. A file that isn't valid JSON is left untouched and reported in the admin error log.

These files are ignored by Git so secrets and runtime state are not accidentally published.

MEDIARR's **built-in application backup** snapshots `config.json`, `users.json`, `favorites.json`, `rss.json`, `autoadd.json`, plus the activity log, watch progress, Notification Center and Plex block log from the database. Database contents are stored in the backup under their pre-2.2 names (`adds.json`, `watch-progress.json`, `v2-state.json`, `blocked.json`), so backups from older versions restore into 2.2 and the other way round. For full disaster recovery, stop MEDIARR and copy the entire data directory so health history, error history, caches and every other runtime file are retained too.

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

### What each user can add

Each regular user has three **Can add** checkboxes in User management: **Movies** (Radarr), **TV** (Sonarr) and **Music** (Lidarr). All three are ticked for new and existing accounts. The Add-a-user form has the same checkboxes, and pending access requests can be adjusted before you approve them.

With a box unticked, the person can still search, browse and play that kind of media, but:

- its Add buttons read **Adding off**, and title and artist pages explain that adding isn't enabled for their account;
- **Auto add all** leaves those titles out;
- MEDIARR refuses the add on the server (HTTP 403) wherever it comes from, including the hub, the Radarr/Sonarr/Lidarr proxy and personal API keys.

Changes take effect immediately; the person doesn't need to sign in again. Admins can always add everything, so the checkboxes aren't shown for them. `/api/me` and the external API's `/api/v1/ping` report the current permissions as `canAdd: { movies, tv, music }`.

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

Since 2.2, sessions are stored in `mediarr.db` (only a SHA-256 hash of each token), so restarts and updates no longer sign users out. Restoring a backup still signs everyone out.

### Per-user API keys

Users can create/revoke their own API key for MEDIARR's external `/api/v1` interface. See [External API](#external-api).

---

## User home pages

MEDIARR v1.6.0 replaces the generic signed-in landing feed with a personalized **User Home** on both desktop and mobile. The page is assembled by the authenticated `/api/home` endpoint, so personal sections are scoped to the current MEDIARR account rather than being shared globally.

Depending on which services the user has linked and which integrations the administrator has configured, the home page can include:

- **Continue Watching** merged from the user's linked Plex profile **and MEDIARR local/WebDAV playback progress**.
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

## Playback intelligence and path mapping

MEDIARR v1.7.0 introduces a shared **Media Resolver** between Radarr/Sonarr file metadata and the Local/WebDAV player. The resolver is now the single place that decides how an Arr file becomes a playable MEDIARR path.

### Media Resolver

For each downloaded movie or episode, MEDIARR evaluates path candidates in priority order:

1. Administrator-defined path mappings.
2. Arr-root-relative paths.
3. Item/folder-relative paths.
4. Parent-root Docker layouts.
5. Safe compatibility fallbacks.

Local-folder candidates are checked against the filesystem before being exposed as playable. WebDAV candidates are resolved without issuing a network request for every episode; administrators can verify an exact path on demand with diagnostics or the mapping tester.

### Path Mapping Manager

Administrators can open **Settings → Media → Path Mapping Manager** on desktop or mobile.

Each rule contains:

- Service: Radarr, Sonarr, or both.
- **Arr root** — the path Radarr/Sonarr reports, such as `/movies`, `/tv`, or `D:\\Movies`.
- **Media source prefix** — the path beneath MEDIARR's configured Local/WebDAV source, such as `movies`, `tv`, or blank when MEDIARR is already rooted at the same library.

Rules are evaluated before automatic path guessing. The built-in tester accepts a real full Arr file path and shows every candidate, whether the target exists, and which path MEDIARR selected.

Example:

```text
Radarr file:        /movies/Resident Evil (2026)/Resident Evil (2026) TELESYNC.mkv
MEDIARR local root: /media
Mapping:            /movies -> movies
Resolved file:      /media/movies/Resident Evil (2026)/Resident Evil (2026) TELESYNC.mkv
```

### Playback Diagnostics

Administrators get a **Playback diagnostics** action in Unified Media Detail. Diagnostics show:

- Arr's original full file path.
- The selected Local/WebDAV relative path.
- Which mapping/resolver rule won.
- Every candidate MEDIARR considered.
- File-existence verification.
- The resolved target path.
- ffprobe container/video/audio information.
- The automatic playback decision: Direct play, Remux, Audio transcode, or Video transcode.

This is intended to make a missing Play button or unexpected transcode explainable without reading server logs.

### MEDIARR Continue Watching

Local and WebDAV playback now saves per-user position in `mediarr.db`. The player periodically records position/duration, resumes unfinished media, and marks titles complete near the end.

The User Home **Continue Watching** rail merges MEDIARR playback with linked Plex Continue Watching. Clicking a MEDIARR item resumes it directly in the built-in player.

Watch progress is included in MEDIARR configuration backups.

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

## Lidarr and music

When Lidarr is connected, the desktop page and installed app get a **🎵 Music** search mode. Results are grouped into **Artists** and **Albums**, and each shows whether it is already in Lidarr.

### Adding music

- **Add artist** sends the artist to Lidarr with your saved quality profile, metadata profile, root folder and monitor choice, and starts a search for missing albums.
- **Request album** for an artist already in Lidarr monitors that album and searches for it.
- **Request album** for an artist not yet in Lidarr adds the artist with only that album monitored, so the rest of the discography doesn't download.

Music requests count toward each person's daily limit and appear in request history, home pages, the admin activity log and notifications. Lidarr's API key never reaches the browser.

### Artist pages

Selecting an artist opens a page with its albums (newest first), release years and tracks on disk. Regular users can add the artist or request albums. Admins can also switch monitoring per album, search for one album, or search for every monitored album.

Artist pages can be shared: the address bar shows `?title=artist:<MusicBrainz id>`.

### Library, calendar and downloads

- **Artists** in the admin menu opens the Lidarr library with tracks on disk per artist and a per-artist search button.
- Upcoming album releases appear on the calendar with a **Music** filter.
- Download Activity has a **Lidarr** tab, and Health monitors Lidarr.
- Lidarr's webhook (below) refreshes the music library right after imports and sends download notifications.

To listen to your music, use the [Music player](#music-player). Lidarr's webhook also tells the player to look for new music after each import.

---

## Music player

The Music player is a separate page at `/music` for listening to the music stored on your server. It has its own audio player, queue and settings, so it never interrupts a video and a video never interrupts it. It works without Lidarr; any folder of music will do.

### Set it up

1. **Docker:** mount your music into the container. Read-only is fine, because MEDIARR never changes your music files:

   ```yaml
   volumes:
     - ./data:/data
     - /path/to/your/music:/music:ro
   ```

2. Open **Settings → Music player folders** (desktop or phone) and enter the folder as MEDIARR sees it, one per line, for example `/music`. Add as many folders as you like: another drive, a share, a Lidarr root folder.
3. Save. The first scan starts straight away. In the Music player, **Music settings** (admins only) also has a folder browser, **Scan for changes**, **Rescan everything**, the scan schedule and the conversion quality.

Every signed-in person can play the library. Only admins see folder paths, browse the server's folders or start scans.

### Scanning

- Every folder inside each music folder is scanned, at any depth. Hidden folders and NAS system folders (`@eaDir`, `#recycle`, `.AppleDouble`, …) are skipped, and symbolic-link loops can't trap the scan.
- Tags are read straight from the files: ID3v1/v2.2–2.4 and APE for MP3, Vorbis comments for FLAC/OGG/Opus, iTunes atoms for M4A/ALAC, and RIFF/AIFF chunks for WAV and AIFF. Other formats are read with ffprobe.
- Songs with no tags still appear, named from the file and folder names (`07 - Song Title.mp3` → track 7, "Song Title").
- Rescans are incremental: only new or changed files are read again. A scan of 6,000 songs takes a few seconds.
- If a music folder disappears (a share that isn't mounted), its songs stay in the library until the folder is back, so playlists and play counts aren't lost.
- New music is picked up on a schedule (every 12 hours by default), about 90 seconds after Lidarr imports something, and when MEDIARR starts.
- Files that can't be read are listed under **Music settings** so you can find them.

### Albums

Each person chooses how songs become albums in **Music settings → Albums & playback**:

| Setting | What it does |
| --- | --- |
| **Keep albums together** (on by default) | A folder of songs is one album, the way it's organised on disk. Disc 1 / CD2 / "Disc 2" sub-folders join their album, and an album split over a folder and its sub-folders becomes one album. A folder that holds songs from many albums (a "Downloads" folder) is sorted by album tags instead. |
| **Every folder is one album** | Stricter: always group by folder, even when a folder's songs have different album tags. |
| Both off | Classic tag grouping by album and album artist, like iTunes. |

Compilations are shown as **Various Artists**, featured artists ("feat.", "&", …) don't split an album, and 24-bit or above-48 kHz lossless albums are marked **Hi-Res**.

### Playback

- Files the browser can play (usually MP3, AAC/M4A, FLAC, Opus, OGG Vorbis and WAV) are sent as they are, with instant seeking. Anything else (for example ALAC or OGG in some browsers, WMA, APE, WavPack, DSD) is converted on the fly to MP3 (or AAC) at 128–320 kbps, and seeking works there too. This needs ffmpeg, which the Docker image includes.
- **Up Next** queue (drag to reorder on desktop), Play Next, Add to Up Next, and Save as playlist.
- Shuffle (optionally whole albums at a time), repeat all, repeat one, and **Keep playing the album** after a song chosen from Songs or search.
- Playlists per person, play counts, and smart playlists: Recently Played, Top 100 Most Played, Recently Added Songs.
- The queue and position are remembered on each device. Phones get lock-screen and headphone controls.
- Keyboard: Space play/pause, ← → seek, Shift+← → previous/next, ↑ ↓ volume, S shuffle, R repeat, M mute, Q Up Next, / search.

On desktop, **Music player** opens in its own tab so music keeps playing while you use the rest of MEDIARR.

### Online album info

The Music player fills in what your music files don't have from two free services. Neither needs an account or API key.

| Source | What it provides |
| --- | --- |
| **MusicBrainz** + **Cover Art Archive** | The album match, release year, release type (album, EP, single, live, compilation), genres, and front cover art up to 1200 px. |
| **Deezer** | Cover art and details for albums MusicBrainz doesn't have or has no cover for, and artist photos. |

- **Only fills gaps.** Your own cover art (folder images and embedded pictures), years and genres always win, unless an admin turns on **Prefer online cover art**.
- **Careful matching.** Albums are matched on album title and artist. Edition suffixes such as "(Deluxe Edition)" or "[2011 Remaster]" and folder leftovers such as "CD", "Disc 2", "[FLAC]" or a leading year are ignored, punctuation in names doesn't matter ("ACDC" matches "AC/DC"), compilations match as Various Artists, and an album with the same title by a different artist isn't used. If nothing turns up for the artist's spelling, MEDIARR searches by album title and checks the artist itself.
- **In the background, politely.** After each scan, new albums and artists are looked up at about one MusicBrainz request a second, as MusicBrainz asks, so a large library fills in over the first hour or so. When MusicBrainz says it's busy, MEDIARR waits as long as it asks, slows down for a while and tries again; that's normal and isn't shown as an error. Albums with no match are tried again after a month. If the services can't be reached at all, MEDIARR tries again the next day and keeps anything it already found.
- **Private and safe.** Only artist and album names are sent. Pictures are downloaded once into `cache/music-meta/` in the data folder and served by MEDIARR, so browsers never contact these services. Music files are never modified.
- **Credits.** Album and artist pages show where the cover, details and photo came from, with links to the MusicBrainz or Deezer page.

Admins control it in the player's **Music settings → Online album info**: turn it on or off (on by default; off also hides what was found), choose the sources, prefer online cover art, see how many albums matched, **Review matches**, **Look up unmatched albums now** and **Forget online info**.

### Fixing matches (like Plex)

Admins fix wrong or missing matches the way Plex does:

- **Fix match…** (album or artist **⋯** menu, or the **Album matches** page) opens a search with the album title and artist filled in. Results from MusicBrainz and Deezer show their cover, artist, year, release type, track count and a match score; the current match is marked. Pick one to use it. For an album with its own picture, tick **Use the matched album's cover** to replace it.
- A match you pick is kept: later scans, **Look up unmatched albums now** and re-looking up everything never replace it. **Refresh metadata** re-reads the album you picked.
- **Unmatch** stops using online info for that album or artist; **Match automatically again** undoes it.
- **Album matches** (in the sidebar for admins) lists every album as **Matched** (with its score; scores under 90% are flagged), **Fixed by hand**, **No match**, **Unmatched** or **Not looked up yet**, with filters and a **Fix match…** button on each row. Albums needing attention come first.
- For artists, Fix match searches Deezer and changes the artist photo.

Candidate covers in the search load through MEDIARR, which only fetches pictures from the Cover Art Archive, archive.org and Deezer's image servers.

MEDIARR needs outbound internet access to `musicbrainz.org`, `coverartarchive.org` (which redirects to `archive.org`) and `api.deezer.com` and Deezer's image servers.

### Direct music links

Each person can make **link keys** in the player's **Music settings → Direct links**. A key only plays music (it can't sign in or use anything else in MEDIARR) and has its own expiry, which its owner can change at any time, even after it has expired, or revoke.

- **Copy direct link…** in a song's **⋯** menu gives a link to that song. **Copy album link (M3U)…** and **Copy playlist link (M3U)…** give a playlist file with a direct link for every song, for VLC, foobar2000, Kodi and most music apps.
- Choose **Original files** (FLAC, ALAC, … as they are) or **MP3** for players that can't play the original format.
- Links work without signing in, support seeking and are allowed from other websites (CORS). Each key shows how often it was used and when. An expired link answers "This link has expired"; extending the key brings its links back.
- Admins choose whether direct links are allowed at all (turning them off stops every link at once; turning them back on restores them), the **longest a key can work** (1 day to 1 year, or no limit for permanent keys) and the **default** for new keys. Lowering the limit also shortens keys that already run longer. Admins see everyone's keys (but not the keys themselves) and can revoke any of them. Deleting a user removes their keys; expired keys are forgotten 30 days after they expire.

Link URLs look like `https://your-server/music/d/ml_…/t/<song>/<Artist - Title>.flac` and `…/album/<id>.m3u8`. Treat them like passwords until they expire.

### What's stored

The scanned library, online album info and resized cover art are caches (`mediarr.db` and `cache/music-art/` in the data folder) that a rescan rebuilds. Link keys are kept in `mediarr.db`; they aren't part of configuration backups, so restoring a backup on a new server means making new keys. Playlists and play counts are kept in `mediarr.db` and included in configuration backups as `music.json`.

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

For shows already in Sonarr, the unified detail now includes a full season/episode browser in addition to aggregate library status. Season tabs expose each episode's title, overview, air date, monitored/downloaded state, watch progress, and a direct **Play/Resume** action when the Sonarr episode file resolves through the Media Resolver.

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

When a downloaded Radarr/Sonarr file maps into the configured **Local folder** or **WebDAV** media source, the unified panel now exposes the existing MEDIARR player directly:

- Movies get a **▶ Play** button that opens the same local/WebDAV player used by the Downloads browser.
- TV shows get a **▶ Play** button plus a season/episode browser with per-episode **Play/Resume** actions for downloaded files.
- Playback keeps the existing automatic direct-play/remux/transcode selection, audio/subtitle controls, HLS seeking, and local/WebDAV handling.
- Local-folder matches are verified against the mounted filesystem before the button is shown.
- Path mapping supports MEDIARR being mounted either **at** the Radarr/Sonarr library root or **one level above it**. For example, Radarr can see `/movies/Resident Evil (2026)/file.mkv` while MEDIARR sees either `/media/movies/Resident Evil (2026)/file.mkv` or a source rooted directly at `/media/movies`.
- WebDAV playback uses the same candidate path mapping so a source can represent either the Arr library root or its parent.

Signed-in users can also manage TV favorites from the unified section, while administrators retain the existing library-management actions:

- **Add to Favorites / Remove from Favorites** for TV shows, using the current MEDIARR user's personal favorites list.
- **Open in Plex** when the matching Plex server item can be resolved.
- **Browse releases** using MEDIARR's existing manual-release tools.
- **Search now** in Radarr/Sonarr.
- **Refresh details** without closing the title.

The existing title controls remain immediately below the unified panel. This means movie/series add options, Radarr/Sonarr edits, season/episode monitoring, trailers, cast/crew, recommendations, and other established workflows are preserved.

---

## Real-time events and Live Dashboard

MEDIARR v1.4.0 adds a push-based event path for Radarr and Sonarr plus an administrator-only **Live Dashboard**.

### Radarr, Sonarr and Lidarr webhooks

MEDIARR exposes three webhook endpoints:

```text
/api/webhooks/radarr?token=<generated-secret>
/api/webhooks/sonarr?token=<generated-secret>
/api/webhooks/lidarr?token=<generated-secret>
```

The first-run wizard and the Live Dashboard show complete copy-ready URLs based on the address you used to reach MEDIARR.

In Radarr, Sonarr or Lidarr:

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

## Spotify linking

Each MEDIARR user can link their own Spotify account. **My Spotify** in the menu then shows:

- **Top artists** (Spotify's medium-term list),
- **Following** — artists they follow,
- **Saved albums**,

each marked **In library** or **Wanted** when Lidarr already has it, with **Request artist** / **Request album** for the rest. Requests go through Lidarr exactly like music search: an album by a new artist adds the artist with only that album wanted, and daily limits, **Can add: Music** and request history all apply. Artists already in the library link to their MEDIARR artist page.

MEDIARR only reads from Spotify (scopes `user-top-read`, `user-follow-read`, `user-library-read`). Spotify tokens are stored on the server in `users.json` and never sent to browsers. People can unlink at any time from My Spotify, or by removing MEDIARR's access in their Spotify account settings.

### Setting it up (admin)

Spotify requires every install to use its own Spotify app:

1. Sign in at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and create an app. Tick **Web API**.
2. Add MEDIARR's **redirect URI** (shown in **Settings → Spotify**) to the app exactly as shown.
3. Paste the app's **Client ID** and **Client secret** into Settings, select **Test**, then save.
4. In the app's **User Management**, add the Spotify email address of each person who will link.

Spotify's current rules for apps in development mode, which is what a personal app is:

- the app owner needs **Spotify Premium**;
- up to **5 people** can use the app;
- the redirect URI must be **https://**, or **http://127.0.0.1:PORT/…** (`localhost` and network IPs such as `http://192.168.1.10` are refused).

**If MEDIARR is on https** (for example behind a reverse proxy), use `https://your-domain/api/spotify/callback`. People go to Spotify, approve, and land back in MEDIARR.

**If MEDIARR is on plain http**, keep the suggested `http://127.0.0.1:PORT/api/spotify/callback`. After someone approves, Spotify sends their browser to 127.0.0.1, which only opens on the MEDIARR server itself. On other devices, they copy that page's address and paste it into **My Spotify → Spotify sent you to a page that didn't load?** to finish. Each sign-in link works once and expires after 15 minutes.

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

MEDIARR v1.8.0 adds a shared **Download Activity Center** on desktop and mobile. It combines SABnzbd queue speed, per-download progress, remaining size, ETA, free disk space, recent completions and failures with the live Radarr and Sonarr activity queues. Arr rows include download-client state, protocol, tracked/import state, progress, ETA and status messages.

The center also surfaces recent Radarr/Sonarr download and import events received through MEDIARR's existing webhooks, plus the signed-in user's recent direct browser downloads through MEDIARR. It provides source tabs, instant filtering, problem highlighting, active-count navigation badges, five-second refresh while open, and a lightweight 30-second badge refresh in the background.

The Download Activity Center is intentionally **read-only**. It monitors the pipeline without exposing destructive pause/delete controls to ordinary MEDIARR users.

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

MEDIARR can test the connection and report discovered media. When the WebDAV folder mirrors the Radarr/Sonarr library root, Unified Media Detail can map downloaded files into this source and launch them with **▶ Play**.

### Local source

Set the source to local and provide a path visible to the MEDIARR process/container. Unified Media Detail verifies mapped movie/episode files beneath this configured source before exposing **▶ Play**.

### Cast to TV

The desktop and mobile players include a **📺 Cast to TV** control with two transport paths:

- **Google Cast / Chromecast / Google TV:** MEDIARR loads Google's official Cast Web Sender SDK, initializes the Default Media Receiver, opens the real Cast device picker, and sends the selected movie/episode with `loadMedia()`. Google Cast Web Sender requires MEDIARR to be opened over **HTTPS**.
- **DLNA / UPnP smart TVs:** MEDIARR can discover MediaRenderer devices with SSDP and start playback with AVTransport `SetAVTransportURI` + `Play`. This fallback is browser-independent, so it can be used from Firefox when the TV supports DLNA/UPnP.

A TV does not receive the browser's MEDIARR login cookie. MEDIARR therefore creates a high-entropy, short-lived media URL for only the selected item. The TV can use Range requests for direct playback, while incompatible media is exposed through MEDIARR's HLS remux/transcode path. Cast/HLS responses include CORS support for Google Cast and DLNA streaming headers for compatible smart TVs.

If MEDIARR is opened as `http://localhost:7575`, a TV cannot fetch that address because `localhost` means the TV itself. Open MEDIARR through a LAN/reverse-proxy address that the TV can reach, or set:

```text
MEDIARR_CAST_URL=http://192.168.1.50:7575
```

For Google Cast, use an HTTPS MEDIARR URL; the media URL itself may still be HTTP if the receiver can reach it.

> [!NOTE]
> SSDP multicast may not cross Docker bridge networking on every host. If Google Cast is not being used and DLNA discovery finds no TVs, run MEDIARR with networking that can reach LAN multicast (for example host networking on a compatible Linux Docker host), or configure the deployment/network accordingly.

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
- Reconcile previously seen feed titles against the actual Radarr/Sonarr file state on every feed cycle.
- For a movie already in Radarr, verify that Radarr reports a movie file on disk; if the file is still missing, queue a Radarr movie search.
- For a series already in Sonarr, inspect every regular episode that has aired through the most recent aired episode, verify `hasFile`, monitor missing aired episodes when necessary, and queue targeted Sonarr `EpisodeSearch` commands only for missing files.
- Apply a six-hour search cooldown per library item so a frequently-polled RSS feed does not repeatedly hammer indexers while a download is already in progress.
- Keep a run/activity log with disk-check and recovery-search results.
- Send notifications for additions and completed downloads.

RSS items are de-duplicated using persistent state, while download reconciliation continues for items that were seen previously. Old seen/reconciliation entries are periodically pruned.

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

Configurable event classes include additions, completed downloads/imports, downloads of previously added items, RSS events, blocked Plex streams, background jobs, errors, service-down events, and optionally logins. Radarr/Sonarr Connect download webhooks include the movie or series/episode label; RSS reconciliation also detects when a previously missing file appears on disk.

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

### How MEDIARR knows it's in Docker

System Update shows the runtime as **Docker** or **Node.js**. Since 2.6.1 this is worked out from inside the container, so it no longer depends on the Docker socket, the container's hostname or how quickly the Docker API answers:

- the official image sets `MEDIARR_RUNTIME=docker`;
- otherwise `/.dockerenv`, Podman's `/run/.containerenv`, or Docker/Kubernetes entries in the process's cgroups and mounts count as a container.

Set `MEDIARR_RUNTIME=node` to force Node.js, or `MEDIARR_RUNTIME=docker` for a custom image.

One-click updates also need to know **which** container is MEDIARR. It finds this from the container ID in its own mount information, which works with custom hostnames and custom Docker data folders. It falls back to `MEDIARR_CONTAINER_NAME` and then the hostname. Each candidate is checked, so a mistyped name can't make MEDIARR replace a different container, and once found the answer is kept until MEDIARR restarts. With host networking and no other clue, MEDIARR picks the single running MEDIARR container of its own version; if there are several, it doesn't guess.

When one-click update isn't possible, System Update says why under **Runtime**. Typical reasons are a missing Docker socket, no permission to use it, the Docker API not answering, or the container not being identified. It also shows the manual command: `docker compose pull && docker compose up -d`.

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
:2.1.0
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
| `TRUST_PROXY` | automatic | `1` always trusts `X-Forwarded-For`, `0` never does. By default it is trusted only from loopback/private-network peers (a reverse proxy on the host or a Docker network) |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker Engine Unix socket inside the container/process |
| `MEDIARR_RUNTIME` | `docker` in the official image | `docker` or `node`: overrides how System Update and System info describe the runtime |
| `MEDIARR_CONTAINER_NAME` | `mediarr` in the included Compose files | Name of MEDIARR's own container, used by one-click updates when the container ID can't be read; keep it equal to `container_name` |
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
- Administrative APIs are checked server-side, not only hidden in the UI. This includes Radarr/Sonarr commands, item edits, season/episode monitoring, the missing-episode search, and service connection tests.
- Regular users can read only the Radarr/Sonarr endpoints the interface needs (library, lookup, calendar, profiles, root folders); host config, download clients, indexers, backups and logs are admin-only.
- The raw Plex passthrough uses the server owner's token and is admin-only; the Plex artwork proxy only returns images.
- Manual-release endpoints are admin-only.
- Docker-control endpoints are admin-only.
- Login, registration and CAPTCHA rate limits use the real client address; `X-Forwarded-For` is only honoured from a trusted proxy (see `TRUST_PROXY`).

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

Since 2.2, login sessions survive restarts and updates. Users are still signed out when a session expires (`SESSION_HOURS`), when they sign out, or when an administrator restores a backup.

### MEDIARR exits with "needs Node.js 22.13 or newer"

MEDIARR 2.2 stores history in Node's built-in SQLite module. Docker images already include a suitable Node.js; for a source install, upgrade Node.js to 22.13 or newer.

### Data directory on a network share

SQLite works best on a local disk. If `/data` is on NFS/SMB, MEDIARR falls back from WAL mode automatically, but some network filesystems do not lock files reliably. Keep the data directory on local storage where possible.

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
│   ├── music.html               # Music player
│   ├── nav.js                   # Shared Escape/Back/keyboard handling and address-bar state
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
├── music.js                     # Music library: folder scanning, album grouping, audio streaming, cover art
├── music-tags.js                # Audio tag reader (ID3, Vorbis comments, MP4, RIFF/AIFF; ffprobe fallback)
├── music-meta.js                # Online album info: MusicBrainz, Cover Art Archive, Deezer
├── store.js                     # SQLite storage (mediarr.db) + migration from pre-2.2 JSON files
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
4. Create a matching tag such as `v2.1.0`.
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
   node --check store.js
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

