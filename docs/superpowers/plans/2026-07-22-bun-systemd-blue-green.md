# Bun and Blue/Green systemd Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Bun compatibility repeatable and add a hardened systemd template for blue/green standalone-server deployments through `/usr/local/srv/apps/extract/current`.

**Architecture:** Node remains the primary development runtime, while a `test:bun` script runs the same Node-native tests under Bun. Development keeps its TCP port, while production requires a Unix socket. A systemd template uses its instance name as the deployment color, creates a private per-color runtime directory, and starts Bun from a shared atomic `current` symlink.

**Tech Stack:** Node 26, Bun 1.3+, Express 5, node:test, systemd.

## Global Constraints

- Preserve `npm test` as the primary Node suite.
- Add `test:bun` without replacing npm or `package-lock.json`.
- Use `extract-standalone@blue.service` and `extract-standalone@green.service` as the supported instances.
- Both instances use `/usr/local/srv/apps/extract/current` and run as `extract:extract`.
- The Bun production executable is `/usr/local/bin/bun`.
- Load required per-color configuration from `/etc/extract/%i.env`.
- Development listens on `PORT` (default `8889`); production requires `SOCKET_PATH`.
- Blue and green use `/run/extract-standalone-%i/standalone.sock`, created within a systemd-managed runtime directory.
- Restrict the runtime directory and socket to `extract:extract`; the reverse proxy must have group access.
- Keep reverse-proxy configuration and traffic switching outside this repository.
- Do not modify the Ruby application or Ruby tests.
- Follow test-first red-green-refactor for the systemd artifact.

---

### Task 1: Repeatable Bun compatibility command

**Files:**
- Modify: `package.json:7-9`

**Interfaces:**
- Consumes: Bun 1.3+ and the tests under `test/`.
- Produces: `npm run test:bun`.

- [ ] **Step 1: Verify the Bun script is absent**

Run:

```bash
npm run test:bun
```

Expected: npm exits non-zero with `Missing script: "test:bun"`.

- [ ] **Step 2: Add the Bun test script**

Replace the scripts block in `package.json` with:

```json
"scripts": {
  "test": "node --test",
  "test:bun": "bun test test/"
},
```

- [ ] **Step 3: Verify the standalone suite under Bun**

Run:

```bash
npm run test:bun
```

Expected: 16 tests pass and zero fail under Bun.

- [ ] **Step 4: Commit the compatibility command**

```bash
git add package.json
git commit -m "Add Bun compatibility test command"
```

---

### Task 2: Production Unix-socket startup

**Files:**
- Create: `test/standalone_server.test.js`
- Modify: `app/standalone_server.js`

**Interfaces:**
- Consumes: `NODE_ENV`, `SOCKET_PATH`, and the existing development `PORT` behavior.
- Produces: a production server that listens on the requested Unix socket and removes it during graceful shutdown.

- [ ] **Step 1: Write failing production socket tests**

Create `test/standalone_server.test.js` with child-process tests that:

- start the entry point with `NODE_ENV=production`, a temporary `SOCKET_PATH`, and a temporary `EXTRACT_USERS` file;
- request `GET /health_check` through `http.get({socketPath, path})` and assert `200` with body `OK`;
- send `SIGTERM`, assert a zero exit status, and assert the socket is removed;
- start production without `SOCKET_PATH` and assert a non-zero exit with `SOCKET_PATH is required in production` on stderr.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
npm test -- --test-name-pattern='production standalone'
```

Expected: the socket test fails because the entry point still listens on a TCP port, and the missing-path test fails because startup does not reject the absent setting.

- [ ] **Step 3: Implement the production listen target**

In `app/standalone_server.js`, select `process.env.SOCKET_PATH` in production,
throw a clear error when it is absent, and otherwise retain
`process.env.PORT || 8889` for development. Pass the selected string or number
directly to `app.listen()` and log the selected target without assuming it is a
port.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run:

```bash
npm test -- --test-name-pattern='production standalone'
```

Expected: both production startup tests pass.

- [ ] **Step 5: Commit the startup behavior**

```bash
git add app/standalone_server.js test/standalone_server.test.js
git commit -m "Listen on a Unix socket in production"
```

---

### Task 3: Hardened blue/green systemd template

**Files:**
- Create: `config/systemd/extract-standalone@.service`
- Create: `config/systemd/extract-standalone.env.example`
- Create: `test/systemd.test.js`

**Interfaces:**
- Consumes: instance name `%i` (`blue` or `green`), `/etc/extract/%i.env`, `/usr/local/bin/bun`, and `/usr/local/srv/apps/extract/current`.
- Produces: a system service that launches `app/standalone_server.js` on the per-color Unix socket.

- [ ] **Step 1: Write failing artifact tests**

Create `test/systemd.test.js`:

```js
const {test} = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const projectRoot = path.join(__dirname, "..")
const unitPath = path.join(projectRoot, "config/systemd/extract-standalone@.service")
const environmentPath = path.join(projectRoot, "config/systemd/extract-standalone.env.example")

test("systemd template defines the standalone blue-green contract", () => {
    assert.equal(fs.existsSync(unitPath), true, "systemd template must exist")
    const lines = new Set(fs.readFileSync(unitPath, "utf8").split(/\r?\n/))
    const settings = [
        "Wants=network-online.target",
        "After=network-online.target",
        "User=extract",
        "Group=extract",
        "WorkingDirectory=/usr/local/srv/apps/extract/current",
        "Environment=NODE_ENV=production",
        "Environment=SOCKET_PATH=/run/extract-standalone-%i/standalone.sock",
        "EnvironmentFile=/etc/extract/%i.env",
        "RuntimeDirectory=extract-standalone-%i",
        "RuntimeDirectoryMode=0750",
        "UMask=0007",
        "ExecStart=/usr/local/bin/bun app/standalone_server.js",
        "Restart=on-failure",
        "RestartSec=5s",
        "KillSignal=SIGTERM",
        "TimeoutStopSec=30s",
        "NoNewPrivileges=true",
        "PrivateTmp=true",
        "ProtectSystem=strict",
        "ProtectHome=true",
        "StandardOutput=journal",
        "StandardError=journal",
        "SyslogIdentifier=extract-standalone-%i",
        "WantedBy=multi-user.target"
    ]

    for (const setting of settings) {
        assert.equal(lines.has(setting), true, `missing systemd setting: ${setting}`)
    }
})

test("systemd example defines the required standalone environment", () => {
    assert.equal(fs.existsSync(environmentPath), true, "environment example must exist")
    const lines = new Set(fs.readFileSync(environmentPath, "utf8").split(/\r?\n/))

    assert.equal(lines.has("EXTRACT_USERS=/etc/extract/users.yml"), true)
})
```

- [ ] **Step 2: Run the focused tests and verify both fail**

Run:

```bash
npm test -- --test-name-pattern='systemd'
```

Expected: two assertion failures report that the template and environment
example do not exist.

- [ ] **Step 3: Add the systemd template**

Create `config/systemd/extract-standalone@.service`:

```ini
[Unit]
Description=Extract standalone server (%i)
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=extract
Group=extract
WorkingDirectory=/usr/local/srv/apps/extract/current
Environment=NODE_ENV=production
Environment=SOCKET_PATH=/run/extract-standalone-%i/standalone.sock
EnvironmentFile=/etc/extract/%i.env
RuntimeDirectory=extract-standalone-%i
RuntimeDirectoryMode=0750
UMask=0007
ExecStart=/usr/local/bin/bun app/standalone_server.js
Restart=on-failure
RestartSec=5s
KillSignal=SIGTERM
TimeoutStopSec=30s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
StandardOutput=journal
StandardError=journal
SyslogIdentifier=extract-standalone-%i

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 4: Add the per-color environment example**

Create `config/systemd/extract-standalone.env.example`:

```text
# Copy to /etc/extract/blue.env and /etc/extract/green.env.
EXTRACT_USERS=/etc/extract/users.yml
```

- [ ] **Step 5: Run the focused Node tests**

Run:

```bash
npm test -- --test-name-pattern='systemd'
```

Expected: both systemd tests pass.

- [ ] **Step 6: Run both runtime suites**

Run:

```bash
npm test
npm run test:bun
```

Expected: 20 tests pass and zero fail under each runtime.

- [ ] **Step 7: Commit the service artifact**

```bash
git add config/systemd/extract-standalone@.service config/systemd/extract-standalone.env.example test/systemd.test.js
git commit -m "Add blue-green standalone systemd service"
```

---

### Task 4: Blue/green deployment documentation and final verification

**Files:**
- Modify: `README.md:42-74`

**Interfaces:**
- Consumes: the systemd unit and environment example from Task 2.
- Produces: installation, verification, operation, logging, and deployment instructions for operators.

- [ ] **Step 1: Add deployment documentation**

Insert this section before `Usage` in `README.md`:

````markdown
Bun and systemd
---------------

The standalone server can run under Bun. The Node and Bun compatibility suites
exercise the same tests:

```bash
npm test
npm run test:bun
```

`config/systemd/extract-standalone@.service` is a systemd template for
blue/green deployment. It runs as `extract:extract`, starts Bun from
`/usr/local/bin/bun`, and resolves the application through this symlink:

```text
/usr/local/srv/apps/extract/current
```

Create the service account and install the unit:

```bash
sudo useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin extract
sudo install -m 0644 config/systemd/extract-standalone@.service /etc/systemd/system/
sudo install -d -o root -g extract -m 0750 /etc/extract
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/extract-standalone@.service
```

The template instance is the deployment color. Each instance gets a private
runtime directory and Unix socket:

```text
/run/extract-standalone-blue/standalone.sock
/run/extract-standalone-green/standalone.sock
```

Create one environment file per color using
`config/systemd/extract-standalone.env.example` as a starting point:

```text
# /etc/extract/blue.env
EXTRACT_USERS=/etc/extract/users.yml

# /etc/extract/green.env
EXTRACT_USERS=/etc/extract/users.yml
```

Keep these files readable by the service account, then enable the instances:

```bash
sudo chown root:extract /etc/extract/blue.env /etc/extract/green.env
sudo chmod 0640 /etc/extract/blue.env /etc/extract/green.env
sudo systemctl enable extract-standalone@blue.service
sudo systemctl enable extract-standalone@green.service
```

The reverse proxy account must be a member of the `extract` group so it can
traverse the runtime directory and connect to the socket.

For a deployment, install dependencies in a versioned release directory and
atomically update `current`. Start the inactive color, verify its own socket,
switch traffic in the external proxy or load balancer, and stop the old color:

```bash
sudo ln -sfn /usr/local/srv/apps/extract/releases/RELEASE /usr/local/srv/apps/extract/current.next
sudo mv -Tf /usr/local/srv/apps/extract/current.next /usr/local/srv/apps/extract/current

sudo systemctl start extract-standalone@green.service
curl --fail --unix-socket /run/extract-standalone-green/standalone.sock http://localhost/health_check

# Switch external traffic to the green socket, then retire blue.
sudo systemctl stop extract-standalone@blue.service
```

For the next deployment, reverse the colors. Follow either instance in the
journal with:

```bash
sudo journalctl --follow --unit extract-standalone@green.service
```

The reverse proxy and its traffic-switching mechanism are intentionally not
managed by this repository.
````

- [ ] **Step 2: Run complete verification**

Run:

```bash
npm test
npm run test:bun
bundle exec rake
```

Expected:

- 20 Node tests pass;
- 20 Bun tests pass;
- 14 Ruby runs and 34 assertions pass with zero failures or errors.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only `package.json`, `README.md`,
`app/standalone_server.js`, the two systemd files,
`test/standalone_server.test.js`, and `test/systemd.test.js` changed across the
implementation commits.

- [ ] **Step 4: Commit the documentation**

```bash
git add README.md
git commit -m "Document Bun blue-green deployment"
```
