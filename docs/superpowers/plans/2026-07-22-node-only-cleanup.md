# Node-Only Extract Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Node/Bun application the sole Extract runtime and remove the retired Ruby stack, split parser, comparison naming, and obsolete documentation.

**Architecture:** Promote the existing standalone Express app and process entry point to `app/app.js` and `app/server.js` without changing their HTTP behavior. Rename the blue/green systemd artifacts around the primary app, remove every Ruby and comparison-era artifact, then make CI and README describe only Node 26 and Bun.

**Tech Stack:** Node 26, Bun 1.3+, Express 5, `@jocmp/mercury-parser`, YAML 2, `node:test`, systemd, GitHub Actions.

## Global Constraints

- Preserve the existing `GET /health_check` and `GET /parser/:user/:signature` behavior and error messages.
- Production continues requiring both `EXTRACT_USERS` and `SOCKET_PATH`; development retains `demo:demo` and `PORT || 8889`.
- Keep strict canonical URL-safe Base64 validation and users-YAML validation unchanged.
- Rename the surviving application to `app/app.js` and `app/server.js`; no `standalone` application or test filenames remain.
- Rename systemd instances to `extract@blue.service` and `extract@green.service`.
- Use `/usr/local/srv/apps/extract/current`, `/etc/extract/%i.env`, and `/run/extract-%i/server.sock` in production.
- Do not add Capistrano configuration or hooks.
- Intentionally replace the current uncommitted `current-%i`/`shared/tmp/sockets` systemd experiment with the approved single-`current` contract.
- Remove all Ruby runtime files, Ruby tests, the split Node parser, the Procfile, and the six pre-cleanup Superpowers plans/specs.
- Preserve `package-lock.json`; npm remains the package manager and `npm test` remains the primary test command.
- CI and local verification run both `npm test` and `npm run test:bun`.

---

### Task 1: Promote the Node application to primary paths

**Files:**
- Delete: `app/app.js`
- Delete: `app/server.js`
- Rename: `app/standalone.js` → `app/app.js`
- Rename: `app/standalone_server.js` → `app/server.js`
- Rename: `test/standalone.test.js` → `test/app.test.js`
- Rename: `test/standalone_server.test.js` → `test/server.test.js`
- Delete: `Procfile`

**Interfaces:**
- Consumes: the existing standalone Express app, production socket startup, and 22 application/server tests.
- Produces: `require("./app")` from `app/server.js`, `require("../app/app")` from tests, and no split-parser process.

- [ ] **Step 1: Record the behavior-preserving baseline**

Run:

```bash
node --test test/standalone.test.js test/standalone_server.test.js
bun test test/standalone.test.js test/standalone_server.test.js
```

Expected: 22 tests pass and zero fail under each runtime. This focused
baseline deliberately excludes `test/systemd.test.js` because the approved
systemd restoration occurs in Task 2.

- [ ] **Step 2: Replace the split application with the surviving Express app**

Delete the current split-parser `app/app.js` and move `app/standalone.js` to
that path. Preserve all executable code, but replace its obsolete Base64
comment with:

```js
// Buffer's base64url decoder is lenient, so validate the URL-safe alphabet,
// padding, length, and canonical trailing bits before accepting input.
```

The resulting module must still end with:

```js
module.exports = app
```

- [ ] **Step 3: Replace the split entry point with the surviving server**

Delete the current split-parser `app/server.js` and move
`app/standalone_server.js` to that path. Change only the module path and startup
message:

```js
if (process.env.NODE_ENV === "production" && !process.env.EXTRACT_USERS) {
    throw new Error("EXTRACT_USERS is required in production")
}
const app = require("./app")
const serverTarget = process.env.NODE_ENV === "production" ? process.env.SOCKET_PATH : process.env.PORT || 8889
if (!serverTarget) {
    throw new Error("SOCKET_PATH is required in production")
}
const server = app.listen(serverTarget, () => {
    console.log(`Extract started on ${serverTarget}`)
})
```

Retain the existing `shutdown()` implementation and signal handlers exactly.

- [ ] **Step 4: Rename and retarget the application test**

Move `test/standalone.test.js` to `test/app.test.js`. Change the module import:

```js
const app = require("../app/app")
```

Replace the comparison-era comment before the fetching cases with:

```js
// These cases pin Mercury Parser's built-in fetch behavior for charsets,
// redirects, upstream failures, and request headers.
```

Replace the redirect and origin-error comments with behavior-only wording:

```js
// Mercury reports the originally requested URL after following a redirect.
```

```js
// Mercury normalizes upstream status failures to the public extraction error.
```

Do not change any assertions.

- [ ] **Step 5: Rename and retarget the process test**

Move `test/standalone_server.test.js` to `test/server.test.js` and make these
exact substitutions:

```js
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "extract-server-test-"))
```

```js
function startServer({socketPath, usersYaml = "user: key\n", includeExtractUsers = true} = {}) {
```

```js
const child = spawn(process.execPath, ["app/server.js"], {
```

Use `startServer(...)` at every call site. Rename the four tests to:

```text
production server serves health checks over its Unix socket
production server requires SOCKET_PATH
production server requires EXTRACT_USERS before loading the app
production server rejects invalid users YAML at boot
```

Update helper error strings from `Standalone server ...` to `Server ...`.

- [ ] **Step 6: Delete the obsolete multi-process definition**

Delete `Procfile`. It must not be replaced because the repository now has one
application process.

- [ ] **Step 7: Verify the rename under Node and Bun**

Run:

```bash
node --test test/app.test.js test/server.test.js
bun test test/app.test.js test/server.test.js
rg -n "app/standalone|standalone_server|require\(\"\.\./app/standalone\"\)|require\(\"\./standalone\"\)" app test package.json
```

Expected: 22 focused tests pass under each runtime; `rg` returns no matches.

- [ ] **Step 8: Commit the primary application**

```bash
git add app test Procfile
git commit -m "Promote Node app to primary paths"
```

---

### Task 2: Rename and restore the blue/green systemd service

**Files:**
- Modify: `test/systemd.test.js`
- Delete: `config/systemd/extract-standalone@.service`
- Delete: `config/systemd/extract-standalone.env.example`
- Create: `config/systemd/extract@.service`
- Create: `config/systemd/extract.env.example`

**Interfaces:**
- Consumes: `app/server.js`, instance color `%i`, `/etc/extract/%i.env`, and the single `current` symlink.
- Produces: `extract@blue.service` and `extract@green.service` listening at `/run/extract-%i/server.sock`.

- [ ] **Step 1: Change the artifact contract first**

Replace `test/systemd.test.js` with:

```js
const {test} = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const projectRoot = path.join(__dirname, "..")
const unitPath = path.join(projectRoot, "config/systemd/extract@.service")
const environmentPath = path.join(projectRoot, "config/systemd/extract.env.example")

test("systemd template defines the Extract blue-green contract", () => {
    assert.equal(fs.existsSync(unitPath), true, "systemd template must exist")
    const lines = new Set(fs.readFileSync(unitPath, "utf8").split(/\r?\n/))
    const settings = [
        "Wants=network-online.target",
        "After=network-online.target",
        "User=extract",
        "Group=extract",
        "WorkingDirectory=/usr/local/srv/apps/extract/current",
        "Environment=NODE_ENV=production",
        "Environment=SOCKET_PATH=/run/extract-%i/server.sock",
        "EnvironmentFile=/etc/extract/%i.env",
        "RuntimeDirectory=extract-%i",
        "RuntimeDirectoryMode=0750",
        "UMask=0007",
        "ExecStart=/usr/local/bin/bun app/server.js",
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
        "SyslogIdentifier=extract-%i",
        "WantedBy=multi-user.target"
    ]

    for (const setting of settings) {
        assert.equal(lines.has(setting), true, `missing systemd setting: ${setting}`)
    }
})

test("systemd example defines the required environment", () => {
    assert.equal(fs.existsSync(environmentPath), true, "environment example must exist")
    const lines = new Set(fs.readFileSync(environmentPath, "utf8").split(/\r?\n/))

    assert.equal(lines.has("EXTRACT_USERS=/etc/extract/users.yml"), true)
})
```

- [ ] **Step 2: Run the systemd contract test and verify it fails**

Run:

```bash
node --test test/systemd.test.js
```

Expected: both tests fail because `config/systemd/extract@.service` and
`config/systemd/extract.env.example` do not exist.

- [ ] **Step 3: Replace the experimental service with the approved primary service**

Delete `config/systemd/extract-standalone@.service`, including the current
uncommitted Capistrano-path experiment, and create
`config/systemd/extract@.service` with:

```ini
[Unit]
Description=Extract server (%i)
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=extract
Group=extract
WorkingDirectory=/usr/local/srv/apps/extract/current
Environment=NODE_ENV=production
Environment=SOCKET_PATH=/run/extract-%i/server.sock
EnvironmentFile=/etc/extract/%i.env
RuntimeDirectory=extract-%i
RuntimeDirectoryMode=0750
UMask=0007
ExecStart=/usr/local/bin/bun app/server.js
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
SyslogIdentifier=extract-%i

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 4: Rename the environment example**

Delete `config/systemd/extract-standalone.env.example` and create
`config/systemd/extract.env.example`:

```text
# Copy to /etc/extract/blue.env and /etc/extract/green.env.
EXTRACT_USERS=/etc/extract/users.yml
```

- [ ] **Step 5: Verify both artifact tests and full runtime suites**

Run:

```bash
node --test test/systemd.test.js
npm test
npm run test:bun
```

Expected: 2 systemd tests pass directly; 24 tests pass under both Node and Bun.

- [ ] **Step 6: Commit the service rename**

```bash
git add config/systemd test/systemd.test.js
git commit -m "Rename Extract blue-green service"
```

---

### Task 3: Remove the Ruby stack and comparison-era records

**Files:**
- Create: `test/repository.test.js`
- Modify: `.gitignore`
- Delete: `.ruby-version`
- Delete: `Gemfile`
- Delete: `Gemfile.lock`
- Delete: `Rakefile`
- Delete: `config.ru`
- Delete: `app/app.rb`
- Delete: `bin/console`
- Delete: `config/honeybadger.yml`
- Delete: `config/puma.rb`
- Delete: `test/app_test.rb`
- Delete: `test/node_app_test.rb`
- Delete: `test/test_helper.rb`
- Delete: `test/test_server.rb`
- Delete: `docs/superpowers/plans/2026-07-22-bun-systemd-blue-green.md`
- Delete: `docs/superpowers/plans/2026-07-22-simplify-standalone-node-parser.md`
- Delete: `docs/superpowers/plans/2026-07-22-standalone-node-parser.md`
- Delete: `docs/superpowers/specs/2026-07-22-bun-systemd-blue-green-design.md`
- Delete: `docs/superpowers/specs/2026-07-22-simplify-standalone-node-parser-design.md`
- Delete: `docs/superpowers/specs/2026-07-22-standalone-node-parser-design.md`
- Delete untracked runtime state: `tmp/puma.pid`, `tmp/puma.state`

**Interfaces:**
- Consumes: the primary Node app and renamed service from Tasks 1–2.
- Produces: a repository whose runtime, tests, and current design records are Node/Bun-only.

- [ ] **Step 1: Add a failing repository-boundary test**

Create `test/repository.test.js`:

```js
const {test} = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const projectRoot = path.join(__dirname, "..")
const retiredPaths = [
    ".ruby-version",
    "Gemfile",
    "Gemfile.lock",
    "Procfile",
    "Rakefile",
    "config.ru",
    "app/app.rb",
    "app/standalone.js",
    "app/standalone_server.js",
    "bin/console",
    "config/honeybadger.yml",
    "config/puma.rb",
    "config/systemd/extract-standalone@.service",
    "config/systemd/extract-standalone.env.example",
    "test/app_test.rb",
    "test/node_app_test.rb",
    "test/standalone.test.js",
    "test/standalone_server.test.js",
    "test/test_helper.rb",
    "test/test_server.rb",
    "docs/superpowers/plans/2026-07-22-bun-systemd-blue-green.md",
    "docs/superpowers/plans/2026-07-22-simplify-standalone-node-parser.md",
    "docs/superpowers/plans/2026-07-22-standalone-node-parser.md",
    "docs/superpowers/specs/2026-07-22-bun-systemd-blue-green-design.md",
    "docs/superpowers/specs/2026-07-22-simplify-standalone-node-parser-design.md",
    "docs/superpowers/specs/2026-07-22-standalone-node-parser-design.md"
]

test("repository excludes retired Ruby and comparison artifacts", () => {
    for (const retiredPath of retiredPaths) {
        assert.equal(
            fs.existsSync(path.join(projectRoot, retiredPath)),
            false,
            `retired path still exists: ${retiredPath}`
        )
    }
})
```

- [ ] **Step 2: Run the boundary test and verify it fails**

Run:

```bash
node --test test/repository.test.js
```

Expected: FAIL, initially naming `.ruby-version` as an existing retired path.

- [ ] **Step 3: Delete the tracked retired runtime and tests**

Delete every Ruby/runtime/test file listed in this task's **Files** block. Do
not delete `.env`, `package-lock.json`, `node_modules`, or any Node test.

- [ ] **Step 4: Delete obsolete design records**

Delete the six pre-cleanup Superpowers plans/specs listed in this task. Retain:

```text
docs/superpowers/specs/2026-07-22-node-only-cleanup-design.md
docs/superpowers/plans/2026-07-22-node-only-cleanup.md
```

- [ ] **Step 5: Remove Ruby-only ignores and generated Puma state**

Replace `.gitignore` with:

```text
users
node_modules
package-lock.checksum
shared
tmp
.env
```

Delete the explicit generated files `tmp/puma.pid` and `tmp/puma.state`. They
are ignored runtime state and are not recoverable from Git.

- [ ] **Step 6: Run the boundary and runtime suites**

Run:

```bash
node --test test/repository.test.js
npm test
npm run test:bun
```

Expected: the boundary test passes; 25 tests pass and zero fail under both
Node and Bun.

- [ ] **Step 7: Commit the deletion boundary**

```bash
git add -A -- .gitignore .ruby-version Gemfile Gemfile.lock Rakefile config.ru app/app.rb bin/console config/honeybadger.yml config/puma.rb test docs/superpowers
git commit -m "Remove retired Ruby stack"
```

---

### Task 4: Replace CI and README with Node/Bun-only guidance

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `test/repository.test.js`

**Interfaces:**
- Consumes: the primary app, renamed systemd unit, and Node/Bun-only repository boundary.
- Produces: CI and operator/developer documentation that exercise and describe only the supported runtime.

- [ ] **Step 1: Add failing CI and README contract tests**

Append to `test/repository.test.js`:

```js
test("CI runs the Node and Bun suites without Ruby", () => {
    const workflow = fs.readFileSync(path.join(projectRoot, ".github/workflows/ci.yml"), "utf8")

    assert.match(workflow, /actions\/setup-node@v7/)
    assert.match(workflow, /npm ci/)
    assert.match(workflow, /npm test/)
    assert.match(workflow, /oven-sh\/setup-bun@v2/)
    assert.match(workflow, /npm run test:bun/)
    assert.doesNotMatch(workflow, /ruby|bundler|bundle exec|rake/i)
})

test("README documents only the primary Node and Bun service", () => {
    const readme = fs.readFileSync(path.join(projectRoot, "README.md"), "utf8")

    assert.match(readme, /node app\/server\.js/)
    assert.match(readme, /config\/systemd\/extract@\.service/)
    assert.match(readme, /extract@green\.service/)
    assert.match(readme, /\/run\/extract-green\/server\.sock/)
    assert.doesNotMatch(readme, /Ruby|Sinatra|Puma|Bundler|Foreman|PARSER_URL|standalone/i)
})
```

- [ ] **Step 2: Run the repository tests and verify the new cases fail**

Run:

```bash
node --test test/repository.test.js
```

Expected: the removal-boundary test passes; the CI test fails because the
workflow still configures Ruby, and the README test fails on its Ruby/split
documentation.

- [ ] **Step 3: Replace the GitHub Actions workflow**

Replace `.github/workflows/ci.yml` with:

```yaml
name: CI

on: [push, pull_request]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-24.04

    steps:
    - uses: actions/checkout@v7

    - uses: actions/setup-node@v7
      with:
        node-version-file: ".nvmrc"
        cache: "npm"

    - run: npm ci
    - run: npm test

    - uses: oven-sh/setup-bun@v2
      with:
        bun-version: "1.3.14"

    - run: npm run test:bun
```

- [ ] **Step 4: Replace README with Node/Bun-only documentation**

Replace `README.md` with:

````markdown
Extract
=======

Extract turns [Mercury Parser](https://github.com/postlight/parser) into an
authenticated web service that can run on a VM without platform-specific
dependencies.

How it works
------------

One Express application authenticates each request and uses Mercury Parser to
fetch and extract the requested page:

```text
app/app.js       HTTP routes, authentication, and parsing
app/server.js    Node/Bun entry point and graceful shutdown
```

Installation
------------

Install Node.js 26, clone the repository, and install dependencies:

```bash
git clone https://github.com/feedbin/extract.git
cd extract
npm ci
```

Run the server in development:

```bash
PORT=8889 node app/server.js
```

Bun can run the same entry point:

```bash
PORT=8889 bun app/server.js
```

Run both compatibility suites with:

```bash
npm test
npm run test:bun
```

Configuration
-------------

Users are defined in a YAML mapping where each key is a username and each value
is that user's non-empty secret:

```yaml
username: secret
```

Set `EXTRACT_USERS` to the file path before starting the server:

```bash
EXTRACT_USERS=users.yml PORT=8889 node app/server.js
```

The file is read once at boot, so changes require a restart. Development falls
back to a `demo` user with secret `demo` when `EXTRACT_USERS` is unset.
Production requires `EXTRACT_USERS` and refuses to start without it.

API
---

The service exposes:

```text
GET /health_check
GET /parser/:username/:signature?base64_url=:base64_url
```

`signature` is the hexadecimal HMAC-SHA1 of the decoded URL using the user's
secret. `base64_url` is canonical RFC 4648 URL-safe Base64, with optional valid
padding and no whitespace.

This Node example constructs a request URL:

```js
const crypto = require("node:crypto")

const username = "username"
const secret = "secret"
const url = "https://feedbin.com/blog/2018/09/11/private-by-default/"
const signature = crypto.createHmac("sha1", secret).update(url).digest("hex")
const encodedUrl = Buffer.from(url).toString("base64url")
const requestUrl = new URL(`/parser/${username}/${signature}`, "http://localhost:8889")
requestUrl.searchParams.set("base64_url", encodedUrl)

console.log(requestUrl.toString())
```

Production with systemd
-----------------------

`config/systemd/extract@.service` is a Bun-backed blue/green systemd template.
It runs as `extract:extract` from:

```text
/usr/local/srv/apps/extract/current
```

Install the service account and unit:

```bash
sudo useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin extract
sudo install -m 0644 config/systemd/extract@.service /etc/systemd/system/
sudo install -d -o root -g extract -m 0750 /etc/extract
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/extract@.service
```

Copy `config/systemd/extract.env.example` to `/etc/extract/blue.env` and
`/etc/extract/green.env`. Install the users file and protect all configuration:

```bash
sudo install -o root -g extract -m 0640 users.yml /etc/extract/users.yml
sudo chown root:extract /etc/extract/blue.env /etc/extract/green.env
sudo chmod 0640 /etc/extract/blue.env /etc/extract/green.env
sudo systemctl enable extract@blue.service extract@green.service
```

Each color gets its own runtime directory and socket:

```text
/run/extract-blue/server.sock
/run/extract-green/server.sock
```

The reverse proxy account must belong to the `extract` group to traverse these
directories and connect to the sockets.

Blue/green deployment
---------------------

Place releases in versioned directories and atomically update `current`. Restart
the traffic-inactive color, verify its socket, switch the external proxy, then
stop the old color:

```bash
sudo ln -sfn /usr/local/srv/apps/extract/releases/2026-07-22-001 /usr/local/srv/apps/extract/current.next
sudo mv -Tf /usr/local/srv/apps/extract/current.next /usr/local/srv/apps/extract/current

sudo systemctl restart extract@green.service
curl --fail --unix-socket /run/extract-green/server.sock http://localhost/health_check

# Switch external traffic to the green socket, then retire blue.
sudo systemctl stop extract@blue.service
```

Reverse the colors on the next deployment. Follow logs with:

```bash
sudo journalctl --follow --unit extract@green.service
```

Proxy configuration and traffic switching remain outside this repository.
````

- [ ] **Step 5: Run repository, Node, and Bun verification**

Run:

```bash
node --test test/repository.test.js
npm test
npm run test:bun
```

Expected: 3 repository tests pass directly; 27 tests pass and zero fail under
both Node and Bun.

- [ ] **Step 6: Run the final cleanup audit**

Run:

```bash
git diff --check
git status --short
rg -n -i "ruby|bundler|bundle exec|rake|rack|puma|sinatra|parser_url|app/standalone|standalone_server|extract-standalone" \
  . --glob '!node_modules/**' --glob '!.git/**' --glob '!.superpowers/**' --glob '!docs/superpowers/**'
find . -path ./node_modules -prune -o -path ./.git -prune -o \
  -type f \( -name '*.rb' -o -name 'Gemfile*' -o -name '.ruby-version' -o -name 'config.ru' \) -print
```

Expected:

- `git diff --check` exits zero;
- only Task 4 files are uncommitted;
- `rg` returns no matches;
- `find` returns no files.

- [ ] **Step 7: Commit Node/Bun-only CI and documentation**

```bash
git add .github/workflows/ci.yml README.md test/repository.test.js
git commit -m "Document Node-only Extract service"
```

- [ ] **Step 8: Verify the committed branch is clean**

Run:

```bash
npm test
npm run test:bun
git diff --check
git status --short --branch
```

Expected: 27 tests pass under each runtime, no whitespace errors, and the
working tree is clean on the current `node` branch.
