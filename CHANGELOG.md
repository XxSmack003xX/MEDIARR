# Changelog

## 1.6.0

- Added personalized **User Home Pages** for every signed-in MEDIARR account on desktop and mobile.
- Replaced the generic landing feed with a user-focused dashboard that prioritizes **Continue Watching**, **My Requests**, and **Up Next**.
- Added per-user Plex **Continue Watching**, **Recently Watched**, and **Watchlist** sections when that MEDIARR user has linked a Plex account/profile.
- Added **My Requests** status tracking from MEDIARR's own per-user add history, with Requested, In library, and Available states derived from Radarr/Sonarr library state.
- Added **Up Next** for upcoming episodes from each user's MEDIARR favorite TV shows.
- Added personalized **Favorites**, **Recently Available**, **Recommended for You**, and **Discover Now** rails.
- Recommendations use recent Plex viewing and MEDIARR favorites as seeds when TMDB is configured, with a short per-user recommendation cache.
- Added authenticated `/api/home` aggregation; home data is scoped to the current MEDIARR username and linked Plex profile.
- Plex history fallback to the server owner token is allowed only when MEDIARR has resolved the exact Plex account id, avoiding cross-user history leakage.
- Added Arr `added` timestamps to the compact library cache so recently available media can be ordered by library-add time.
- Added shared `public/v160.js` home UI and included it in source/Docker release archives.

## 1.5.0

- Added a shared **Unified Media Detail** panel to desktop and mobile title details.
- Added a new authenticated `/api/media/detail` aggregator that combines Radarr/Sonarr, Plex, TMDB, and local media-file state into one response.
- Movie details now surface Radarr library state, monitored/downloaded state, file size/path, quality, resolution, HDR/dynamic range, video/audio codecs, languages, subtitles, release group, and edition when available.
- TV details now surface Sonarr library state, downloaded/total episodes, monitored/missing/unaired counts, next episode, per-season completion, aggregate episode-file size, quality, codecs, dynamic range, languages, and subtitles.
- Added Plex availability detection against the configured Plex server, including watched/in-progress state and a direct **Open in Plex** action when the server item can be resolved.
- Added unified admin actions for **Browse releases**, **Search now**, and **Refresh details** while preserving all existing add/edit/monitor/episode controls below the unified panel.
- Added TMDB enrichment for media status, genres, runtime, rating, networks, and tagline when TMDB is configured.
- Added the new shared `public/v150.js` client to Docker/source release archives.

## 1.4.0

- Added token-protected **Radarr and Sonarr webhook endpoints** so MEDIARR can react to Connect events immediately instead of waiting for browser/library polling.
- Webhook events invalidate the affected live ID index, patch known media into the library cache when possible, and trigger a short service-specific reconciliation scan.
- Added an administrator-only **Live Dashboard** powered by Server-Sent Events (SSE).
- The Live Dashboard shows Radarr/Sonarr/Plex health, cached movie/show counts, active MEDIARR transcodes, SSE client count, webhook URLs, and a live event feed.
- Added SSE events for health changes/checks, library scans, MEDIARR activity, additions, webhook events, setup completion, and dashboard connections.
- Added a shared desktop/mobile **first-run setup wizard** for Radarr, Sonarr, TMDB, quality profiles, root folders, and real-time webhook configuration.
- The wizard can test Radarr/Sonarr/TMDB before saving and displays copy-ready webhook URLs for Radarr and Sonarr.
- Added a generated webhook secret stored in MEDIARR configuration; webhook requests without the matching token are rejected.
- Updated the release archive to include the shared v1.4 UI client.

## 1.3.4

- Fixed Sonarr TV cards remaining stuck on **Add to Sonarr** after the show was already present in Sonarr.
- Fixed the browser caching negative TMDB/Sonarr matches indefinitely.
- Negative TV-library checks now expire after 10 seconds and are revalidated automatically; positive matches remain cached.
- Reduced the desktop/mobile live library-ID refresh window to 15 seconds to match the faster Sonarr server cache.
- Added TMDB verification to title-search TV cards when Cinemeta supplies a TMDB identifier.
- Updated both desktop and mobile add flows to mark the just-added TV show as in-library immediately.

## 1.3.3

- Made Sonarr additions appear in MEDIARR much faster by patching successful adds directly into the cached Shows library.
- Added a short Sonarr-only library freshness window so externally added shows are detected on the next MEDIARR request after roughly 15 seconds.
- Reduced the Sonarr live "already added?" ID cache window from 60 seconds to 15 seconds while leaving Radarr unchanged.
- Added a short delayed Sonarr reconciliation scan after successful adds so episode/file statistics catch up without blocking the add response.
- Removed redundant forced full-library refreshes from desktop/mobile add flows; MEDIARR now reuses the freshly updated cache instead of immediately pulling the same Sonarr library twice.

## 1.3.2

- Replaced the crowded desktop action strip with a collapsible left-side navigation drawer.
- Grouped navigation into Library, Discover, Account, Monitoring, Administration, Support, and Session sections.
- Kept existing admin-only visibility rules for Settings, Admin, System Update, Docker controls, and the Transcode Dashboard.
- Added keyboard and accessibility behavior: Escape-to-close, outside-click close, focus handoff, ARIA state, and body scroll locking while the drawer is open.
- Preserved all existing action element IDs and handlers so the navigation redesign does not change feature behavior.
- Left the existing Bootstrap mobile menu intact while making the desktop layout substantially cleaner.

## 1.3.1

- Added an admin-controlled **Automatic playback selection** option, enabled by default.
- Added codec/container probing before WebDAV/local playback so MEDIARR can choose direct play, lossless HLS remux, audio-only transcode, or full video transcode automatically.
- Added an admin-only **Transcode Dashboard** on desktop and mobile with five-second live refresh.
- Added live MEDIARR HLS/fallback FFmpeg session details including mode, source codecs, quality, encoder, hardware acceleration, age, and HLS progress.
- Added Plex playback/transcode details to the Transcode Dashboard, including bitrate, transcode target, hardware usage, speed, and progress when Plex reports them.
- Kept manual quality, audio-track, stereo-downmix, and Force transcode controls as explicit overrides of automatic selection.
- Tightened HLS stream-copy decisions so MPEG-TS remux only copies compatible 8-bit H.264 video; incompatible video is automatically re-encoded to H.264.

## 1.3.0

- Added an admin-only **System Update** page on desktop and mobile.
- Added GitHub Releases update checking with semantic-version comparison and release notes.
- Added one-click Docker self-update for eligible Docker installs.
- Added an automatic configuration backup before self-update.
- Added a short-lived updater helper that replaces the MEDIARR container and rolls back to the previous image if the replacement fails its health check.
- Added GitHub Actions release automation that publishes versioned and `latest` GHCR images plus a clean release ZIP.
- Added GitHub-ready `.gitignore`, security notes, and publishing documentation.

## 1.2.0

- Added admin-only Docker Start / Stop / Restart controls with an explicit allow-list.

## 1.1.0

- Added manual Radarr/Sonarr release browsing and grabbing.
- Added Docker/Compose deployment and persistent `/data` state.
