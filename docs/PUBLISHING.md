# Publishing MEDIARR

This document is for maintainers of the official MEDIARR repository:

**https://github.com/XxSmack003xX/MEDIARR**

MEDIARR uses semantic versions, Git tags, GitHub Releases, GitHub Actions, and GitHub Container Registry (GHCR) as one release pipeline.

## Release model

A release tag such as `v1.3.1` must match the version in `package.json` (`1.3.1`). Pushing the tag runs `.github/workflows/release.yml`.

The workflow:

1. Checks out the tagged source.
2. Verifies the tag version equals `package.json`.
3. Logs in to GHCR with the workflow `GITHUB_TOKEN`.
4. Builds the Docker image with the MEDIARR version and repository identity embedded.
5. Publishes `ghcr.io/xxsmack003xx/mediarr:<version>`.
6. Publishes the same build as `ghcr.io/xxsmack003xx/mediarr:latest`.
7. Creates a clean release ZIP containing application/release files but no runtime data or secrets.
8. Creates a GitHub Release for the tag and attaches the ZIP.

## Before the first release

The repository should be public if releases/images are intended for the wider community.

The workflow requires repository Actions permissions that allow it to write repository contents/releases and packages. The workflow already requests:

```yaml
permissions:
  contents: write
  packages: write
```

After the first GHCR image is published, make the MEDIARR package public if anonymous users should be able to pull it.

## Release checklist

Before creating a release:

1. Make sure `main` is in the state you want to publish.
2. Update `package.json`.
3. Update `CHANGELOG.md`.
4. Update README examples when behavior/install commands changed.
5. Run syntax checks:

   ```bash
   node --check server.js
   node --check update-helper.js
   ```

6. If Docker is available, build and start the image locally:

   ```bash
   docker compose build
   docker compose up -d
   docker compose ps
   ```

7. Verify first-run/login behavior with a clean data directory when the release changes authentication/configuration.
8. Verify upgrades using a copy of an existing data directory when persistence/update behavior changed.
9. Test desktop and mobile when shared features changed.
10. Review `.gitignore` and the release workflow when new persistent files/secrets are introduced.

## Publish a release

For version `1.3.1`:

```bash
git checkout main
git pull

git add package.json CHANGELOG.md README.md
git commit -m "Release MEDIARR v1.3.1"
git push origin main

git tag v1.3.1
git push origin v1.3.1
```

The tag push starts the release workflow automatically.

## Verify the GitHub Actions run

Open the repository's Actions tab and inspect **Publish MEDIARR release**.

Confirm that all of these completed:

- Version check.
- GHCR login.
- Docker image build.
- Versioned image push.
- `latest` image push.
- Release ZIP creation.
- GitHub Release creation.

## Verify release artifacts

The release should contain a ZIP named like:

```text
mediarr-1.3.1.zip
```

The ZIP contains a version-specific `docker-compose.release.yml` that references:

```text
ghcr.io/xxsmack003xx/mediarr:1.3.1
```

It must not contain runtime files such as:

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
```

## Verify GHCR

After the workflow finishes, confirm these tags exist:

```text
ghcr.io/xxsmack003xx/mediarr:1.3.1
ghcr.io/xxsmack003xx/mediarr:latest
```

For a public community project, set the package visibility to public so users do not need a GitHub token to pull updates.

## Test the in-app updater

Use a non-production MEDIARR instance running the previous release.

1. Open **System Update** as an administrator.
2. Confirm the new GitHub Release is detected.
3. Confirm the release notes/version are correct.
4. Start the update.
5. Confirm a pre-update backup appears under the MEDIARR data directory.
6. Confirm the updater pulls the exact versioned GHCR image.
7. Confirm the replacement container becomes healthy.
8. Confirm the browser reconnects and `/api/version` reports the new version.
9. Confirm settings/users/persistent data survived.

When updater code changes, also test the failure path by making the replacement fail its health check and confirming the previous image is restored.

## Versioning policy

Use semantic versions:

```text
MAJOR.MINOR.PATCH
```

Examples:

```text
v1.3.1
v1.4.0
v2.0.0
```

The application updater deliberately expects semantic release tags. Avoid using the normal release channel for unrelated tags.

## Hotfix release

For a small correction after `v1.3.1`:

1. Fix it on `main`.
2. Change the package version to `1.3.2`.
3. Add a changelog entry.
4. Commit/push.
5. Tag/push `v1.3.2`.

Do not move/reuse an already-published release tag. Create a new version.

## Rollback

MEDIARR self-update uses exact Docker image versions. If a replacement container fails its Docker health check, `update-helper.js` attempts to restore the previous image automatically.

For manual rollback, select the desired prior GHCR tag in Compose and recreate the container while keeping the same persistent `/data` directory.

## Forks

Official source defaults to checking `XxSmack003xX/MEDIARR`. A fork can override the repository at build/runtime using `MEDIARR_UPDATE_REPO` or configure its own update repository through MEDIARR.

When publishing images from a fork, the included GitHub workflow passes `${GITHUB_REPOSITORY}` into the image build, so release images produced by that fork point back to the fork automatically.