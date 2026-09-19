# Changelog

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