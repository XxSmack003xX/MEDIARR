# Changelog

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
