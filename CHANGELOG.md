# Changelog

## 1.6.7

- Added a built-in **CAPTCHA** challenge for every new public access request on desktop and mobile.
- Username/password registration now requires a fresh 5-digit CAPTCHA before the pending account can be created.
- New Plex registrations also require CAPTCHA verification before the Plex PIN flow starts.
- Existing approved users can still sign in normally without CAPTCHA, including existing Plex-linked accounts.
- The normal Plex sign-in path can no longer be used to bypass CAPTCHA: if no MEDIARR account is linked to that Plex account, the user is directed to **Request access** and must complete a CAPTCHA.
- CAPTCHA challenges are generated locally by MEDIARR with no third-party CAPTCHA provider, external API key, or tracking dependency.
- CAPTCHA responses use an image challenge, expire after five minutes, are bound to the requesting IP, and are invalidated after a single verification attempt whether correct or incorrect.
- CAPTCHA generation is rate-limited per IP and old challenges are pruned from memory automatically.
- Registration screens include a refresh button and automatically load a new challenge after a failed registration attempt.

## 1.6.6

- Added public **Request access** registration on desktop and mobile using MEDIARR username/password credentials.
- Added **Sign in with Plex** on the login screen. The first successful Plex authorization creates a pending MEDIARR account; after administrator approval, the same Plex account can sign directly into MEDIARR on future visits.
- Every public registration is created as **pending** and cannot create a session, use a personal API key, or access authenticated MEDIARR APIs until an administrator approves it.
- Existing MEDIARR accounts remain implicitly approved when upgrading, and administrator-created users continue to be active immediately.
- Added administrator approval/rejection controls to User Management on desktop and mobile, including registration provider details and Plex usernames where available.
- Added a pending-access count badge to the Admin menu plus in-app popup notifications when new registrations arrive. Dismissed requests stay visible in User Management until approved or rejected.
- Added an authenticated `/api/admin/registrations` endpoint for pending-request counts/details and extended the existing user-management PATCH route with approval state.
- Added registration abuse protection with per-IP rate limits for password registrations and Plex authorization starts.
- Plex public sign-in uses nonce-bound PIN requests and maps accounts by a stable Plex account ID rather than display name, avoiding automatic merges into existing local usernames.
- Preserved stable Plex account identity across Plex Home profile switching and added compatibility recovery for previously linked users whose stored profile ID differs from the root Plex account ID.
- Plex-only MEDIARR accounts do not expose the password-change control unless a MEDIARR password exists.

## 1.6.5

- Fixed a Unified Media Status regression that could display **Radarr movies as Sonarr TV shows** even though the underlying library match was correctly coming from Radarr.
- `/api/media/detail` now exposes its normalized media `type` and authoritative Arr `service` at the top level in addition to the existing nested identity object.
- The shared Unified Media Status client now normalizes media type primarily from the authoritative Radarr/Sonarr service, with nested identity/type fallbacks for compatibility.
- Movie detail panels now correctly show **Radarr**, movie download/file information, and movie technical details instead of **Sonarr**, Episodes `0 / 0`, and TV library status.
- TV shows continue to use Sonarr, episode progress, TV library status, and TV Favorites.
- Favorites, manual release browsing, Search Now, and service labels now all use the same normalized media-type decision so their behavior cannot disagree with the status cards.
- The server-side response fix also protects clients that still have an older cached `v150.js` from the original missing top-level type field.

## 1.6.4

- Added in-app **new version available** notifications for MEDIARR administrators on desktop and mobile.
- When a newer published GitHub Release is detected, MEDIARR shows a popup with the installed and available versions and a **Review update** button.
- **Review update** opens the existing System Update screen so the administrator can read release notes and use the normal automatic-update/download flow.
- Added a persistent **NEW** badge to the System Update menu item while a newer version remains available.
- Added **Later** dismissal behavior so the same release does not repeatedly interrupt the same browser; a future MEDIARR version will trigger a new notification.
- Update availability is checked after administrator sign-in, periodically while the app is open, and again when the desktop tab becomes active.
- Update notifications remain administrator-only because System Update is restricted to administrators.

## 1.6.3

- Added an administrator-only **Update** button to Docker Controls on both desktop and mobile, alongside Start, Restart, and Stop.
- Docker Update pulls the container's currently configured image tag and compares the pulled image ID with the container's existing image before making changes.
- Containers are left untouched when the configured tag is already current.
- When a newer image is pulled, MEDIARR recreates the allowed container while preserving its name, environment, command/entrypoint, ports, restart policy, mounts and named/anonymous volumes, networks/aliases, labels, devices, security options, resource limits, healthcheck, and running/stopped state.
- Added rollback protection: if the replacement container cannot be created or started, MEDIARR attempts to restore the previous container from its exact previous image ID.
- Docker Update remains constrained by the existing explicit container/service allow-list and administrator authentication.
- MEDIARR's own container cannot be updated from Docker Controls; it continues to use the dedicated System Update workflow.
- Update is disabled for containers created from immutable image digests or raw image IDs. Pinned version tags remain pinned and are never silently changed to `latest`.

## 1.6.2

- Added an **Add to Favorites / Remove from Favorites** control for TV shows directly inside the shared Unified Media Status panel.
- The favorite control is available to signed-in users on both desktop and mobile and uses MEDIARR's existing per-user TV favorites store.
- Unified Media Status now detects the current favorite state using IMDb, TVDB, TMDB, and normalized title matching.
- Favorites changed from the Unified Media Status panel immediately invalidate the personalized User Home cache so the Favorites and Up Next sections refresh correctly.
- Passed poster artwork through the desktop and mobile unified-detail launch paths so shows favorited from the status panel retain artwork on User Home.

## 1.6.1

- Fixed movie and TV-show detection when opening media details from personalized User Home sections.
- User Home click handling now treats the authoritative Arr service as the primary media-type signal: Radarr items open as movies and Sonarr items open as TV series.
- Fixed TV-only **Favorites** and **Up Next** items being able to fall through to movie/Radarr detail handling.
- Fixed historical **My Requests** items using stale media-type values instead of their actual Radarr/Sonarr service.
- Added normalized handling for movie/film and series/show/tv/episode/season type aliases, with TVDB/Sonarr state used as additional TV signals.
- Updated User Home Movie/TV badges to use the same normalized classifier as click behavior so the badge and opened detail type stay consistent.

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
