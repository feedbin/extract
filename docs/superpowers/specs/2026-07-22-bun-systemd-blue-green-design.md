# Bun and Blue/Green systemd Deployment — Design

Date: 2026-07-22

## Goal

Verify and preserve Bun runtime compatibility for the standalone Extract
server, and provide a reusable systemd template for blue/green production
deployments.

## Bun compatibility

Bun 1.3.14 runs the existing `node:test` standalone suite without application
changes: 16 tests pass and no tests fail. The compatibility guarantee is for
running the existing CommonJS application with dependencies installed in
`node_modules`; changing the package manager or replacing `package-lock.json`
is outside this work.

`package.json` gains this script so Bun compatibility remains repeatable:

```json
"test:bun": "bun test test/"
```

The existing Node test script remains the primary suite.

## systemd template

Add `config/systemd/extract-standalone@.service`. The systemd instance name is
the deployment color, so the two supported units are:

```text
extract-standalone@blue.service
extract-standalone@green.service
```

Both instances use:

- user and group `extract`;
- working directory `/usr/local/srv/apps/extract/current`;
- executable `/usr/local/bin/bun`;
- entry point `app/standalone_server.js`;
- `NODE_ENV=production`;
- the journal for standard output and errors.

Each color loads `/etc/extract/%i.env`, where `%i` expands to `blue` or
`green`. The required deployment environment value is:

```text
EXTRACT_USERS=/etc/extract/users.yml
```

Production uses Unix-domain sockets rather than TCP ports. systemd gives each
color its own runtime directory and socket path:

```text
/run/extract-standalone-blue/standalone.sock
/run/extract-standalone-green/standalone.sock
```

`RuntimeDirectory=extract-standalone-%i` creates the directory as
`extract:extract`, and `Environment=SOCKET_PATH=...` passes the socket path to
the server. `RuntimeDirectoryMode=0750` and `UMask=0007` keep the socket
accessible only to the service account and members of the `extract` group.
The external reverse proxy user must therefore belong to that group.

The repository includes `config/systemd/extract-standalone.env.example`;
operators copy it to `/etc/extract/blue.env` and `/etc/extract/green.env`.
Those environment files are deployment configuration and are not installed or
modified automatically.

## Process lifecycle and hardening

In development, `app/standalone_server.js` continues to use `PORT`, defaulting
to `8889`. In production, `SOCKET_PATH` is required and the server fails fast
when it is absent.

The service starts after `network-online.target` and restarts after failures
with a short delay. systemd sends `SIGTERM`, allowing
`app/standalone_server.js` to stop accepting connections and close idle
connections. A graceful close unlinks the socket. If the process crashes,
systemd removes and recreates the per-instance runtime directory before the
restart, removing any stale socket. Shutdown has a 30-second timeout.

The unit applies settings compatible with a read-only application checkout:

- `NoNewPrivileges=true`;
- `PrivateTmp=true`;
- `ProtectSystem=strict`;
- `ProtectHome=true`.

The server does not require application filesystem writes. Network access
remains available because Mercury Parser fetches remote pages.

## Blue/green deployment flow

Application releases live in versioned directories outside the unit contract.
Deployment atomically points `/usr/local/srv/apps/extract/current` at the new
release, then starts the inactive color. systemd resolves `WorkingDirectory=`
when that color starts; the already-running color retains its original working
directory and loaded code.

The operational sequence is:

1. install the new release and its npm dependencies;
2. atomically update the `current` symlink;
3. start the inactive color;
4. check `GET /health_check` through the inactive color's socket;
5. switch traffic in the external proxy or load balancer;
6. stop the previously active color.

Proxy configuration and traffic switching are intentionally outside this
repository.

## Documentation and testing

README deployment documentation covers installing the unit, creating the
`extract` account and per-color environment files, enabling instances, reading
journal logs, and performing the blue/green sequence.

Add a Node-native unit-file test that reads
`config/systemd/extract-standalone@.service` and asserts the critical contract:

- template environment path `/etc/extract/%i.env`;
- shared working directory;
- `extract` user and group;
- Bun executable and standalone entry point;
- per-instance runtime directory, socket path, and restrictive permissions;
- production environment, restart policy, graceful stop, and hardening.

Verification runs:

```bash
npm test
npm run test:bun
```

On a Linux deployment host, operators additionally run:

```bash
systemd-analyze verify /etc/systemd/system/extract-standalone@.service
```
