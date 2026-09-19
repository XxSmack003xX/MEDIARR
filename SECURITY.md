# Security

MEDIARR is a self-hosted administration application. Treat access to an administrator account as privileged access to your media stack.

## Docker socket

The optional Docker Controls and one-click Docker updater use `/var/run/docker.sock`. Access to the Docker daemon is effectively host-level administrative access on a typical Docker host. Do not expose MEDIARR directly to the public Internet without strong authentication and TLS/reverse-proxy protections.

If you do not need Docker Controls or automatic Docker updates, remove the Docker socket mount from your Compose configuration. GitHub release checking still works without it.

## Secrets

Do not commit `config.json`, `users.json`, backups, `.env`, or the `data/` directory. MEDIARR's `.gitignore` excludes these by default. Configuration backups may contain API keys and password hashes and should be protected like credentials.

## Reporting a vulnerability

For a public repository, enable GitHub's private vulnerability reporting under **Settings → Security → Code security and analysis**, or provide a private contact method in this file before announcing the project broadly.