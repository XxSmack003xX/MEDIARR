# Changelog

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