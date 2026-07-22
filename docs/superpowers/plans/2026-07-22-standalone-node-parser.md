# Standalone Node Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure-Node Extract service (auth + parse in one process) that runs alongside the existing Ruby-web + Node-parser split for side-by-side comparison.

**Architecture:** `app/standalone.js` is an Express app replicating `app/app.rb`'s routes, auth, and error contract exactly, but calling `@jocmp/mercury-parser` in-process and letting Mercury fetch pages itself. `app/standalone_server.js` is the entry point, mirroring `app/server.js`. Tests are node-native (`node:test`) against a local fixture HTTP server.

**Tech Stack:** Node 24, Express 5, @jocmp/mercury-parser, node:test, node:crypto. **No new dependencies.**

Spec: `docs/superpowers/specs/2026-07-22-standalone-node-parser-design.md`

## Global Constraints

- Never modify `app/app.rb`, `app/app.js`, `app/server.js`, or the Ruby tests — the split version must be untouched.
- No new npm or gem dependencies.
- Error responses: status 400, header exactly `Content-Type: application/json` (no charset — use `setHeader`/`end`, not `res.json`, because Express's `res.set` appends `charset=utf-8`), body `{"error": true, "messages": <msg>}`.
- Exact Ruby error strings (see spec table). Check order: missing `base64_url` → invalid base64 → unknown user → invalid signature; for POST, body errors only after auth passes.
- User-Agent for Mercury fetches must equal `app.rb`'s: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36`
- Shell commands: prepend `source ~/.bash_profile` (nvm PATH).
- Run node tests with `npm test` (`node --test`); Ruby suite with `bundle exec rake`.

---

### Task 1: App skeleton, health check, server entry, test wiring

**Files:**
- Create: `app/standalone.js`
- Create: `app/standalone_server.js`
- Create: `test/standalone.test.js`
- Modify: `package.json` (add `scripts.test`)

**Interfaces:**
- Produces: `app/standalone.js` exports the Express app (`module.exports = app`), reads `EXTRACT_USERS` at require time. Test file establishes the boot pattern (env var before `require`) and `appOrigin` helper later tasks use.

- [ ] **Step 1: Write the failing test**

`test/standalone.test.js`:

```js
const {test, before, after} = require("node:test")
const assert = require("node:assert/strict")
const {once} = require("node:events")
const http = require("node:http")
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const usersFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "extract-test-")), "users.yml")
fs.writeFileSync(usersFile, "user: key\n")
process.env.EXTRACT_USERS = usersFile

const app = require("../app/standalone")

let appServer
let appOrigin

before(async () => {
    appServer = app.listen(0)
    await once(appServer, "listening")
    appOrigin = `http://localhost:${appServer.address().port}`
})

after(() => {
    appServer.close()
})

test("health check", async () => {
    const response = await fetch(`${appOrigin}/health_check`)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), "OK")
})
```

`package.json` scripts block:

```json
"scripts": {
    "test": "node --test test/"
},
```

- [ ] **Step 2: Run test to verify it fails**

Run: `source ~/.bash_profile && npm test`
Expected: FAIL — `Cannot find module '../app/standalone'`

- [ ] **Step 3: Write minimal implementation**

`app/standalone.js`:

```js
const crypto = require("node:crypto")
const fs = require("node:fs")
const parser = require("@jocmp/mercury-parser")
const express = require("express")
const app = express()

function loadUsers() {
    if (!process.env.EXTRACT_USERS) {
        return {demo: "demo"}
    }
    const users = {}
    for (const line of fs.readFileSync(process.env.EXTRACT_USERS, "utf8").split("\n")) {
        const trimmed = line.trim()
        if (trimmed === "" || trimmed.startsWith("#")) {
            continue
        }
        const match = trimmed.match(/^([^:]+):\s*(.*)$/)
        if (match) {
            users[unquote(match[1].trim())] = unquote(match[2].trim())
        }
    }
    return users
}

function unquote(value) {
    if (value.length > 1 && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))) {
        return value.slice(1, -1)
    }
    return value
}

const users = loadUsers()

function log(request, extra) {
    let output = `[${request.ip}] - ${request.method} ${request.url}`
    if (extra) {
        output = `${output}: ${extra}`
    }
    console.log(output)
}

app.get("/health_check", (request, response) => {
    log(request)
    response.send("OK")
})

module.exports = app
```

`app/standalone_server.js` (mirrors `app/server.js`):

```js
const app = require("./standalone")
const serverPort = process.env.PORT || 8889
const server = app.listen(serverPort, () => {
    console.log(`Extract standalone started on port ${serverPort}`)
})

function shutdown(signal) {
    if (process.env.NODE_ENV === "production") {
        console.log(`${signal} received, shutting down`)
        server.close((error) => {
            if (error) {
                console.error(error)
                process.exit(1)
            }
            process.exit(0)
        })
        server.closeIdleConnections()
    } else {
        process.exit(0)
    }
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `source ~/.bash_profile && npm test`
Expected: PASS (1 test). Verify `node --test` picks up only `standalone.test.js` and ignores the `.rb` files.

- [ ] **Step 5: Commit**

```bash
git add app/standalone.js app/standalone_server.js test/standalone.test.js package.json
git commit -m "Standalone skeleton with health check"
```

---

### Task 2: GET endpoint — auth parity and Mercury fetch

**Files:**
- Modify: `app/standalone.js`
- Modify: `test/standalone.test.js`

**Interfaces:**
- Consumes: `appOrigin`, users fixture (`user: key`) from Task 1.
- Produces: test helpers `sign(url)`, `b64(url)`, `getParser(url, overrides)`, fixture server (`fixtureOrigin`, `fixtureHandler`) reused by Tasks 3–4. App functions `authenticate(request, response)` (returns URL string or null after responding), `haltWithError(response, message)`, `parse(request, response, url, options)`.

- [ ] **Step 1: Write the failing tests**

Add to `test/standalone.test.js` — fixture server in `before`/`after` (extend existing hooks), helpers, tests:

```js
function page(title) {
    return `<html><head><title>${title}</title></head><body><p>Some body text.</p></body></html>`
}

function fixtureHandler(request, response) {
    if (request.url === "/article") {
        response.writeHead(200, {"Content-Type": "text/html"})
        response.end(page("The Title"))
    } else {
        response.writeHead(404, {"Content-Type": "text/html"})
        response.end(page("Not Found"))
    }
}

let fixtureServer
let fixtureOrigin
```

In `before` (after app boot):

```js
fixtureServer = http.createServer(fixtureHandler)
fixtureServer.listen(0)
await once(fixtureServer, "listening")
fixtureOrigin = `http://localhost:${fixtureServer.address().port}`
```

In `after`: `fixtureServer.close()`

Helpers + tests:

```js
const USER = "user"
const KEY = "key"

function sign(url, key = KEY) {
    return crypto.createHmac("sha1", key).update(url).digest("hex")
}

function b64(url) {
    return Buffer.from(url).toString("base64url")
}

function getParser(url, {user = USER, signature, base64} = {}) {
    const sig = signature ?? sign(url)
    const encoded = base64 ?? b64(url)
    return fetch(`${appOrigin}/parser/${user}/${sig}?base64_url=${encoded}`)
}

test("GET parser with valid signature", async () => {
    const response = await getParser(`${fixtureOrigin}/article`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8")
    const result = await response.json()
    assert.equal(result.title, "The Title")
})

test("GET parser with invalid signature", async () => {
    const response = await getParser(`${fixtureOrigin}/article`, {signature: "invalid"})
    assert.equal(response.status, 400)
    assert.equal(response.headers.get("content-type"), "application/json")
    const result = await response.json()
    assert.equal(result.messages, "Invalid signature.")
    assert.equal(result.error, true)
})

test("GET parser with unknown user", async () => {
    const response = await getParser(`${fixtureOrigin}/article`, {user: "ghost"})
    assert.equal(response.status, 400)
    assert.equal((await response.json()).messages, "User does not exist: ghost.")
})

test("GET parser with missing base64_url", async () => {
    const response = await fetch(`${appOrigin}/parser/${USER}/whatever`)
    assert.equal(response.status, 400)
    assert.equal((await response.json()).messages, "Invalid request. Missing base64_url parameter.")
})

test("GET parser with invalid base64_url", async () => {
    const response = await fetch(`${appOrigin}/parser/${USER}/whatever?base64_url=%25%25`)
    assert.equal(response.status, 400)
    assert.equal((await response.json()).messages, "Invalid request. Invalid base64_url parameter.")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `source ~/.bash_profile && npm test`
Expected: new tests FAIL (404 route → status mismatch); health check still passes.

- [ ] **Step 3: Implement**

Add to `app/standalone.js` (below `log`, above `module.exports`):

```js
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"

// Matches Ruby's Base64.urlsafe_decode64, which is strict: characters outside
// the url-safe alphabet, stray padding, or an impossible length raise instead
// of decoding loosely the way Buffer.from(..., "base64url") does.
function urlsafeDecode64(input) {
    if (input.endsWith("=") || input.length % 4 === 0) {
        if (!/^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2}==|[A-Za-z0-9_-]{3}=)?$/.test(input)) {
            return null
        }
    } else if (!/^[A-Za-z0-9_-]+$/.test(input) || input.length % 4 === 1) {
        return null
    }
    return Buffer.from(input.replace(/=+$/, ""), "base64url")
}

function signatureValid(user, signature, data) {
    const key = users[user]
    if (!key) {
        return false
    }
    return signature === crypto.createHmac("sha1", key).update(data).digest("hex")
}

function haltWithError(response, message) {
    response.statusCode = 400
    response.setHeader("Content-Type", "application/json")
    response.end(JSON.stringify({error: true, messages: message}))
    return null
}

function authenticate(request, response) {
    const raw = request.query.base64_url
    const param = Array.isArray(raw) ? raw[raw.length - 1] : raw
    if (param === undefined) {
        return haltWithError(response, "Invalid request. Missing base64_url parameter.")
    }
    const url = urlsafeDecode64(param)
    if (url === null) {
        return haltWithError(response, "Invalid request. Invalid base64_url parameter.")
    }
    if (!(request.params.user in users)) {
        return haltWithError(response, `User does not exist: ${request.params.user}.`)
    }
    if (!signatureValid(request.params.user, request.params.signature, url)) {
        return haltWithError(response, "Invalid signature.")
    }
    return url.toString("utf8")
}

async function parse(request, response, url, options) {
    const start = Date.now()
    const result = await parser.parse(url, options)
    if (result && typeof result === "object" && "error" in result) {
        log(request, `parse_error url=${url} message=${result.message}`)
        return haltWithError(response, "Cannot extract this URL.")
    }
    log(request, `parse_time=${Date.now() - start} url=${url}`)
    response.json(result)
}

function responseError(request, response, error, url) {
    log(request, `exception=${error.message} url=${url}`)
    console.error(error.stack)
    if (!response.headersSent) {
        haltWithError(response, "Cannot extract this URL.")
    }
}

app.get("/parser/:user/:signature", async (request, response) => {
    let url = null
    try {
        url = authenticate(request, response)
        if (url === null) {
            return
        }
        log(request, `url=${url}`)
        await parse(request, response, url, {headers: {"User-Agent": USER_AGENT}})
    } catch (error) {
        responseError(request, response, error, url)
    }
})
```

Notes:
- `signature === hmac` string compare mirrors Ruby's `==` (`app.rb:35`).
- HMAC over the decoded **bytes** (Buffer), matching Ruby which signs the binary decoded string.
- `haltWithError` uses `setHeader`/`end` so the header is exactly `application/json` — Sinatra's `halt` sends no charset and the Ruby tests assert that.

- [ ] **Step 4: Run tests to verify they pass**

Run: `source ~/.bash_profile && npm test`
Expected: PASS (6 tests). If the content-type assertion fails with `application/json; charset=utf-8` on error responses, Express is appending charset — ensure `setHeader`/`end` are used, not `res.set`/`res.send`/`res.json`.

- [ ] **Step 5: Commit**

```bash
git add app/standalone.js test/standalone.test.js
git commit -m "Standalone GET endpoint with Ruby-parity auth"
```

---

### Task 3: POST endpoint — raw body, JSON errors, auth ordering

**Files:**
- Modify: `app/standalone.js`
- Modify: `test/standalone.test.js`

**Interfaces:**
- Consumes: `authenticate`, `haltWithError`, `parse`, `responseError`, test helpers from Task 2.
- Produces: `postParser(url, body, overrides)` test helper for Task 4.

- [ ] **Step 1: Write the failing tests**

```js
function postParser(url, body, {user = USER, signature, contentType = "application/json"} = {}) {
    const sig = signature ?? sign(url)
    return fetch(`${appOrigin}/parser/${user}/${sig}?base64_url=${b64(url)}`, {
        method: "POST",
        headers: {"Content-Type": contentType},
        body
    })
}

test("POST parser with valid signature", async () => {
    const url = "https://example.com/supplied"
    const response = await postParser(url, JSON.stringify({url, body: page("Posted Title")}))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8")
    assert.equal((await response.json()).title, "Posted Title")
})

test("POST parser with invalid JSON body", async () => {
    const url = "https://example.com/supplied"
    const response = await postParser(url, "not json", {contentType: "text/plain"})
    assert.equal(response.status, 400)
    assert.equal((await response.json()).messages, "Invalid JSON body.")
})

test("POST parser with missing body field", async () => {
    const url = "https://example.com/supplied"
    const response = await postParser(url, JSON.stringify({url}))
    assert.equal(response.status, 400)
    assert.equal((await response.json()).messages, "Missing body field in JSON body.")
})

test("POST parser authenticates before reading the body", async () => {
    const url = "https://example.com/supplied"
    const response = await postParser(url, "not json", {signature: "invalid"})
    assert.equal(response.status, 400)
    assert.equal((await response.json()).messages, "Invalid signature.")
})
```

Note the POST happy path parses the **supplied** html — the fixture server must receive no request (`https://example.com` would fail to resolve into a parse anyway, proving no fetch happens, since the test asserts 200).

- [ ] **Step 2: Run tests to verify they fail**

Run: `source ~/.bash_profile && npm test`
Expected: 4 new failures (404 for POST route).

- [ ] **Step 3: Implement**

In `app/standalone.js`, add above the routes:

```js
app.use(express.raw({type: () => true, limit: "10mb"}))
```

(This must be added **before** the GET route definition in the file so it applies to all routes; body parsing is lazy per-request. Raw + manual `JSON.parse` mirrors `app.rb`, which reads the body itself regardless of content type, only after auth.)

Add the POST route after the GET route:

```js
app.post("/parser/:user/:signature", async (request, response) => {
    let url = null
    try {
        url = authenticate(request, response)
        if (url === null) {
            return
        }

        let json
        try {
            json = JSON.parse(request.body)
        } catch {
            return haltWithError(response, "Invalid JSON body.")
        }

        // Ruby's `unless json["body"]` only rejects nil/false — an empty
        // string is accepted — so an explicit check replaces JS falsiness.
        const html = (json && typeof json === "object") ? json.body : undefined
        if (html === undefined || html === null || html === false) {
            return haltWithError(response, "Missing body field in JSON body.")
        }

        log(request, `url=${url}`)
        await parse(request, response, url, {html, contentType: "html"})
    } catch (error) {
        responseError(request, response, error, url)
    }
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `source ~/.bash_profile && npm test`
Expected: PASS (10 tests). If "Invalid JSON body." never triggers, check that `express.raw` matches all content types (`type: () => true`); an unparsed body arrives as `undefined` and `JSON.parse(undefined)` throws, which is the correct path for empty bodies too.

- [ ] **Step 5: Commit**

```bash
git add app/standalone.js test/standalone.test.js
git commit -m "Standalone POST endpoint"
```

---

### Task 4: Mercury fetch behavior — charsets, redirects, origin errors

These tests document how Mercury's own fetching compares to the Ruby downloader (the point of the side-by-side). Expected values below are best-effort predictions; where Mercury behaves differently, **pin the assertion to observed behavior and note the drift in a comment** — do not change the app to chase the Ruby downloader.

**Files:**
- Modify: `test/standalone.test.js`
- Modify (only if a genuine app bug surfaces): `app/standalone.js`

**Interfaces:**
- Consumes: `fixtureHandler`, `getParser` from Task 2.

- [ ] **Step 1: Extend the fixture server**

Add cases to `fixtureHandler` before the 404 fallback:

```js
    if (request.url === "/meta-charset") {
        response.writeHead(200, {"Content-Type": "text/html"})
        response.end(Buffer.from("<html><head><meta charset=\"windows-1252\"><title>Caf\xE9</title></head><body><p>Some body text.</p></body></html>", "latin1"))
        return
    }
    if (request.url === "/header-charset") {
        response.writeHead(200, {"Content-Type": "text/html; charset=windows-1252"})
        response.end(Buffer.from(page("Caf\xE9"), "latin1"))
        return
    }
    if (request.url === "/undeclared-utf8") {
        response.writeHead(200, {"Content-Type": "text/html"})
        response.end(page("Café “quoted”"))
        return
    }
    if (request.url === "/redirect") {
        response.writeHead(301, {"Location": `${fixtureOrigin}/article`})
        response.end()
        return
    }
    if (request.url === "/error-500") {
        response.writeHead(500, {"Content-Type": "text/html"})
        response.end(page("500 Internal Server Error"))
        return
    }
```

- [ ] **Step 2: Write the tests**

```js
test("GET parser with meta charset page", async () => {
    const response = await getParser(`${fixtureOrigin}/meta-charset`)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).title, "Café")
})

test("GET parser with header charset page", async () => {
    const response = await getParser(`${fixtureOrigin}/header-charset`)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).title, "Café")
})

test("GET parser with undeclared utf8 page", async () => {
    const response = await getParser(`${fixtureOrigin}/undeclared-utf8`)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).title, "Café “quoted”")
})

test("GET parser follows redirects", async () => {
    const response = await getParser(`${fixtureOrigin}/redirect`)
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.title, "The Title")
    // NOTE: pin to observed behavior. The Ruby stack reports the FINAL url
    // after redirects; Mercury likely reports the requested one. Document
    // whichever is real here.
    assert.equal(result.url, `${fixtureOrigin}/redirect`)
})

test("GET parser with origin error status", async () => {
    const response = await getParser(`${fixtureOrigin}/error-500`)
    assert.equal(response.status, 400)
    // Drift from Ruby, which says "Cannot extract this URL. Origin returned
    // HTTP 500." — the standalone can't see the status, Mercury ate it.
    assert.equal((await response.json()).messages, "Cannot extract this URL.")
})
```

- [ ] **Step 3: Run, observe, pin**

Run: `source ~/.bash_profile && npm test`
Expected: charset and error tests PASS as written; the redirect `result.url` assertion may fail — replace the expected value with the observed one and adjust the comment to state the actual drift. Any *crash* (not assertion mismatch) is an app bug — fix `app/standalone.js`.

- [ ] **Step 4: Commit**

```bash
git add test/standalone.test.js
git commit -m "Document Mercury fetch behavior vs Ruby downloader"
```

---

### Task 5: Procfile, README, full-suite verification

**Files:**
- Modify: `Procfile`
- Modify: `README.md`

- [ ] **Step 1: Add the Procfile process**

```
standalone: PORT=8889 node app/standalone_server.js
```

- [ ] **Step 2: README section**

After the "How it Works" section's process list, add:

```markdown
There is also an experimental standalone version that performs authentication
and parsing in a single Node.js process, using Mercury Parser's built-in
ability to fetch pages:

- **standalone**: `PORT=8889 node app/standalone_server.js`

It uses the same `EXTRACT_USERS` auth as the web process and runs alongside it
on its own port, so the two implementations can be compared on identical
requests, e.g. `http://localhost:8888/parser/...` vs
`http://localhost:8889/parser/...`.
```

- [ ] **Step 3: Verify both suites**

Run: `source ~/.bash_profile && npm test`
Expected: all node tests PASS.

Run: `source ~/.bash_profile && bundle exec rake`
Expected: existing Ruby suite PASS, unchanged.

Boot check: `source ~/.bash_profile && foreman start` (or start the standalone alone) and curl the demo route once; Ctrl-C. Optional if tests are green.

- [ ] **Step 4: Commit**

```bash
git add Procfile README.md
git commit -m "Run standalone Node version alongside split version"
```
