# Simplify Standalone Node Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the standalone service GET-only, replace its handwritten users-file parser with `yaml`, remove its custom fetch User-Agent, simplify its Express error handling, and run it on Node 26 without weakening strict URL-safe Base64 validation.

**Architecture:** `app/standalone.js` remains a single exported Express app that loads users once at boot, authenticates GET requests, and calls Mercury Parser in-process. The users loader delegates YAML semantics to the `yaml` package; one-use parsing and exception helpers are folded into the sole parser route, while strict Base64 validation remains a separate boundary function.

**Tech Stack:** Node 26, Express 5, `yaml`, `@jocmp/mercury-parser`, `node:test`, `node:crypto`.

## Global Constraints

- Upgrade `.nvmrc` from Node 24 to Node 26.
- Add `yaml` as a production npm dependency and update `package-lock.json`.
- Preserve the existing strict `urlsafeDecode64()` implementation and authentication order.
- Remove the standalone POST parser endpoint entirely; unmatched POST requests return Express's normal 404.
- Do not modify `app/app.rb`, `app/app.js`, `app/server.js`, or the Ruby tests.
- Run shell commands after `source ~/.bash_profile` and select Node 26 with `nvm use 26` once installed.
- Use test-first red-green-refactor for every behavior change.

---

### Task 1: Node 26 and standards-compliant YAML loading

**Files:**
- Modify: `.nvmrc`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `app/standalone.js:1-32`
- Test: `test/standalone.test.js:10-17,104-110,133-137`

**Interfaces:**
- Consumes: `EXTRACT_USERS`, pointing to a one-document YAML mapping.
- Produces: the boot-time `users` object used by `authenticate(request, response)`.

- [ ] **Step 1: Write failing YAML coverage and strict-Base64 characterization**

Replace the users fixture and constants at the top of `test/standalone.test.js` with:

```js
const usersFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "extract-test-")), "users.yml")
fs.writeFileSync(usersFile, "user: key\nescaped: \"key\\nline\"\n")
process.env.EXTRACT_USERS = usersFile

const app = require("../app/standalone")

const USER = "user"
const KEY = "key"
const ESCAPED_USER = "escaped"
const ESCAPED_KEY = "key\nline"
```

Add this test after `GET parser with valid signature`:

```js
test("GET parser authenticates a YAML-escaped secret", async () => {
    const url = `${fixtureOrigin}/article`
    const response = await getParser(url, {
        user: ESCAPED_USER,
        signature: sign(url, ESCAPED_KEY)
    })

    assert.equal(response.status, 200)
    assert.equal((await response.json()).title, "The Title")
})
```

Add this characterization test after the existing invalid-Base64 test:

```js
test("GET parser rejects invalid base64_url padding", async () => {
    const response = await fetch(`${appOrigin}/parser/${USER}/whatever?base64_url=aA%3D`)
    assert.equal(response.status, 400)
    assert.equal((await response.json()).messages, "Invalid request. Invalid base64_url parameter.")
})
```

- [ ] **Step 2: Run the focused tests and verify the YAML case fails for the right reason**

Run:

```bash
source ~/.bash_profile && npm test -- --test-name-pattern='YAML-escaped secret|invalid base64_url padding'
```

Expected: the padding characterization passes, while the YAML-escaped-secret test fails with status `400` instead of `200` because the handwritten parser leaves `\\n` escaped.

- [ ] **Step 3: Upgrade the repository runtime declaration**

Replace `.nvmrc` with:

```text
26
```

Install and select that runtime:

```bash
source ~/.bash_profile && nvm install 26 && nvm use 26
```

Expected: `node --version` resolves to a `v26.x.x` release.

- [ ] **Step 4: Add the YAML dependency**

Run:

```bash
source ~/.bash_profile && nvm use 26 && npm install yaml
```

Expected: `yaml` appears under `dependencies` in `package.json`, and `package-lock.json` is updated.

- [ ] **Step 5: Replace the handwritten users parser**

Add the import and replace `loadUsers()` plus `unquote()` with:

```js
const crypto = require("node:crypto")
const fs = require("node:fs")
const YAML = require("yaml")
const parser = require("@jocmp/mercury-parser")
const express = require("express")
const app = express()

function loadUsers() {
    if (!process.env.EXTRACT_USERS) {
        return {demo: "demo"}
    }
    return YAML.parse(fs.readFileSync(process.env.EXTRACT_USERS, "utf8"))
}

const users = loadUsers()
```

Leave the rest of `app/standalone.js` unchanged in this task.

- [ ] **Step 6: Run the complete Node suite under Node 26**

Run:

```bash
source ~/.bash_profile && nvm use 26 && npm test
```

Expected: all 18 tests pass, including the YAML escape and strict-padding cases.

- [ ] **Step 7: Commit the runtime and YAML change**

```bash
git add .nvmrc package.json package-lock.json app/standalone.js test/standalone.test.js
git commit -m "Use YAML package in standalone parser"
```

---

### Task 2: GET-only standalone app and route simplification

**Files:**
- Modify: `app/standalone.js`
- Test: `test/standalone.test.js`

**Interfaces:**
- Consumes: the boot-time `users` object and strict `urlsafeDecode64(input)` from Task 1.
- Produces: health and GET parser routes only; JSON errors use Express's standard response helper.

- [ ] **Step 1: Write failing tests for the simplified behavior**

Add this constant after the user constants:

```js
const FORMER_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
```

Add a captured header variable with the server variables:

```js
let fixtureUserAgent
```

Add this case near the top of `fixtureHandler()`:

```js
if (request.url === "/user-agent") {
    fixtureUserAgent = request.headers["user-agent"]
    response.writeHead(200, {"Content-Type": "text/html"})
    response.end(page("User Agent"))
    return
}
```

Change the invalid-signature content-type assertion to:

```js
assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8")
```

Delete `postParser()` and the four existing POST tests. In their place add:

```js
test("POST parser route is unavailable", async () => {
    const url = "https://example.com/supplied"
    const response = await fetch(`${appOrigin}/parser/${USER}/${sign(url)}?base64_url=${b64(url)}`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({url, body: page("Posted Title")})
    })

    assert.equal(response.status, 404)
})
```

Add this test before the charset behavior tests:

```js
test("GET parser does not supply the former custom User-Agent", async () => {
    fixtureUserAgent = undefined
    const response = await getParser(`${fixtureOrigin}/user-agent`)

    assert.equal(response.status, 200)
    assert.notEqual(fixtureUserAgent, FORMER_USER_AGENT)
})
```

- [ ] **Step 2: Run the Node suite and verify the three intended failures**

Run:

```bash
source ~/.bash_profile && nvm use 26 && npm test
```

Expected failures:

- invalid-signature error content type is still `application/json`;
- POST parser still returns `200`;
- the fixture still receives `FORMER_USER_AGENT`.

All other tests pass.

- [ ] **Step 3: Simplify `app/standalone.js`**

Replace the file with:

```js
const crypto = require("node:crypto")
const fs = require("node:fs")
const YAML = require("yaml")
const parser = require("@jocmp/mercury-parser")
const express = require("express")
const app = express()

function loadUsers() {
    if (!process.env.EXTRACT_USERS) {
        return {demo: "demo"}
    }
    return YAML.parse(fs.readFileSync(process.env.EXTRACT_USERS, "utf8"))
}

const users = loadUsers()

function log(request, extra) {
    let output = `[${request.ip}] - ${request.method} ${request.url}`
    if (extra) {
        output = `${output}: ${extra}`
    }
    console.log(output)
}

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

function haltWithError(response, message) {
    response.status(400).json({error: true, messages: message})
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

    const user = request.params.user
    if (!(user in users)) {
        return haltWithError(response, `User does not exist: ${user}.`)
    }
    const key = users[user]
    if (!key || request.params.signature !== crypto.createHmac("sha1", key).update(url).digest("hex")) {
        return haltWithError(response, "Invalid signature.")
    }
    return url.toString("utf8")
}

app.get("/health_check", (request, response) => {
    log(request)
    response.send("OK")
})

app.get("/parser/:user/:signature", async (request, response) => {
    let url = null
    try {
        url = authenticate(request, response)
        if (url === null) {
            return
        }

        log(request, `url=${url}`)
        const start = Date.now()
        const result = await parser.parse(url)
        if (result && typeof result === "object" && "error" in result) {
            log(request, `parse_error url=${url} message=${result.message}`)
            return haltWithError(response, "Cannot extract this URL.")
        }

        log(request, `parse_time=${Date.now() - start} url=${url}`)
        response.json(result)
    } catch (error) {
        log(request, `exception=${error.message} url=${url}`)
        console.error(error.stack)
        if (!response.headersSent) {
            haltWithError(response, "Cannot extract this URL.")
        }
    }
})

module.exports = app
```

This removes `USER_AGENT`, `express.raw()`, `signatureValid()`, `parse()`,
`responseError()`, and the POST route while leaving the strict decoder intact.

- [ ] **Step 4: Run both complete suites**

Run:

```bash
source ~/.bash_profile && nvm use 26 && npm test
```

Expected: all 16 Node tests pass.

Run:

```bash
source ~/.bash_profile && bundle exec rake
```

Expected: 14 Ruby runs and 34 assertions pass with zero failures or errors.

- [ ] **Step 5: Inspect the final diff and commit**

Run:

```bash
git diff --check
git diff --stat HEAD~1
```

Expected: no whitespace errors; only `.nvmrc`, npm dependency metadata,
`app/standalone.js`, and `test/standalone.test.js` changed across the two
implementation commits.

Commit:

```bash
git add app/standalone.js test/standalone.test.js
git commit -m "Simplify standalone parser routes"
```
