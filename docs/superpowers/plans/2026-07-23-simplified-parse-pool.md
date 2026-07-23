# Simplified Parse Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom worker lifecycle, poison cache, and watchdog with a small Piscina-backed parse pool whose requests wait indefinitely for admission and whose timeout starts only after admission.

**Architecture:** `app/parse-pool.js` will own a fixed-size Piscina instance plus a tiny FIFO admission gate. The gate limits submitted work to the worker count; after admission, each task gets a fresh `AbortSignal.timeout()`, allowing Piscina to terminate and replace a stuck worker without counting admission wait time against the parse timeout. Fetching and HTTP response behavior remain in `app/app.js`.

**Tech Stack:** Node.js 26, CommonJS, Express 5, Piscina 5, Node test runner

## Global Constraints

- Fetch and decode HTML on the main Node.js event loop.
- Parse fetched HTML outside the main event loop in a fixed-size worker pool.
- Default `PARSE_WORKERS` to `2` and `PARSE_TIMEOUT` to `10000` milliseconds.
- Wait without a queue limit when every parser worker is occupied.
- Start the parse timeout only after admission to the worker pool.
- Preserve the public API and successful parser response format.
- Remove the poison URL cache, parser-busy `503`, and event-loop watchdog.

---

### Task 1: Remove redundant timeout policies

**Files:**
- Modify: `app/app.js`
- Modify: `app/server.js`
- Delete: `app/watchdog.js`
- Delete: `app/watchdog-worker.js`
- Delete: `test/poison.test.js`
- Create: `test/timeout.test.js`

**Interfaces:**
- Consumes: the existing `parse(url, html)` pool interface.
- Produces: unchanged HTTP parser responses, except a URL that timed out is fetched and attempted again rather than cached as poisoned. The server no longer starts an event-loop watchdog.

- [ ] **Step 1: Replace the poison-cache test with a retry-after-timeout test**

Move the complete harness from `test/poison.test.js` to
`test/timeout.test.js`, then replace its final test with:

```js
// A 1ms deadline makes every parse time out: the worker round-trip alone
// takes longer, so both requests reliably exercise timeout handling.
```

```js
test("a URL is attempted again after a parse timeout", async () => {
    const url = `${fixtureOrigin}/article`

    const first = await fetch(parserUrl(url))
    assert.equal(first.status, 400)
    assert.equal((await first.json()).messages, "Cannot extract this URL.")
    assert.equal(fixtureHits, 1)

    const second = await fetch(parserUrl(url))
    assert.equal(second.status, 400)
    assert.equal((await second.json()).messages, "Cannot extract this URL.")
    assert.equal(fixtureHits, 2, "a previous timeout must not block a later fetch")
})
```

Delete `test/poison.test.js` after creating the renamed test.

- [ ] **Step 2: Run the timeout test and verify RED**

Run:

```bash
node --test test/timeout.test.js
```

Expected: FAIL with `fixtureHits` equal to `1` instead of `2`, because the
current poison cache blocks the second fetch.

- [ ] **Step 3: Remove poison-cache state and behavior from `app/app.js`**

Delete these constants:

```js
const POISON_TTL = 60 * 60 * 1000
const POISON_LIMIT = 1000
```

Delete the `poisonedUrls` map and the complete `isPoisoned()` and
`markPoisoned()` functions. Delete this pre-fetch check:

```js
if (isPoisoned(url)) {
    response.locals.extra = `poisoned url=${url}`
    return haltWithError(response, "Cannot extract this URL.")
}
```

Delete this timeout-specific branch from the parse error handler while
leaving the existing queue-full branch intact until Task 2:

```js
if (error.code === "PARSE_TIMEOUT") {
    markPoisoned(url)
}
```

- [ ] **Step 4: Restore the simple server entry point and delete watchdog files**

Remove the `startWatchdog` import and all `WATCHDOG_LIMIT` setup from
`app/server.js`, leaving its beginning as:

```js
if (process.env.NODE_ENV === "production" && !process.env.EXTRACT_USERS) {
    throw new Error("EXTRACT_USERS is required in production")
}
const app = require("./app")
const serverTarget = process.env.NODE_ENV === "production" ? process.env.SOCKET_PATH : process.env.PORT || 8889
```

Delete `app/watchdog.js` and `app/watchdog-worker.js` completely.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
node --test test/timeout.test.js test/server.test.js
```

Expected: PASS, including two upstream fixture hits in `test/timeout.test.js`.

- [ ] **Step 6: Check formatting and commit the policy removal**

Run:

```bash
git diff --check
git add app/app.js app/server.js app/watchdog.js app/watchdog-worker.js test/poison.test.js test/timeout.test.js
git commit -m "Remove redundant parser safeguards"
```

Expected: `git diff --check` exits 0 and the commit contains only the poison
cache, watchdog, and timeout integration-test changes.

---

### Task 2: Replace the custom pool with Piscina and waiting admission

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `app/parse-pool.js`
- Modify: `app/parse-worker.js`
- Modify: `app/app.js`
- Modify: `test/parse-pool.test.js`
- Modify: `test/stub-worker.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: `createParsePool({size, timeout, workerPath})`, where all options remain optional.
- Produces: `{parse(url, html), close()}`. `parse()` waits for FIFO admission, then resolves with the worker result or rejects with Piscina's `PISCINA_ERR_ABORT` when the parse deadline expires. `close()` returns the Promise from `Piscina.destroy()`.

- [ ] **Step 1: Replace the pool tests with application-owned behavior tests**

Replace `test/parse-pool.test.js` with:

```js
const {test} = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const createParsePool = require("../app/parse-pool")

const workerPath = path.join(__dirname, "stub-worker.js")

test("parse pool resolves results", async () => {
    const pool = createParsePool({size: 1, workerPath})
    const result = await pool.parse("http://example.com/", "<html></html>")
    assert.deepEqual(result, {url: "http://example.com/", html: "<html></html>"})
    await pool.close()
})

test("parse pool terminates a stuck parse and recovers its slot", async () => {
    const pool = createParsePool({size: 1, timeout: 200, workerPath})
    await assert.rejects(pool.parse("hang", ""), (error) => error.code === "PISCINA_ERR_ABORT")
    const result = await pool.parse("http://example.com/after", "ok")
    assert.equal(result.url, "http://example.com/after")
    await pool.close()
})

test("parse pool waits for capacity without consuming the parse timeout", async () => {
    const pool = createParsePool({size: 1, timeout: 100, workerPath})
    const work = [
        pool.parse("hang", ""),
        ...Array.from({length: 25}, (_, index) => pool.parse(`http://example.com/${index}`, "ok"))
    ]

    const [hung, ...waiting] = await Promise.allSettled(work)

    assert.equal(hung.status, "rejected")
    assert.equal(hung.reason.code, "PISCINA_ERR_ABORT")
    assert.equal(waiting.every((result) => result.status === "fulfilled"), true)
    await pool.close()
})
```

- [ ] **Step 2: Run the pool test and verify RED**

Run:

```bash
node --test test/parse-pool.test.js
```

Expected: FAIL. The current implementation reports `PARSE_TIMEOUT`, and its
default queue limit rejects some of the 25 waiting tasks.

- [ ] **Step 3: Install Piscina**

Run:

```bash
npm install piscina@^5.3.0
```

Expected: the command exits 0, and `package.json` and `package-lock.json` add
Piscina 5 as a production dependency.

- [ ] **Step 4: Replace `app/parse-pool.js` with a Piscina wrapper and FIFO admission gate**

```js
const Piscina = require("piscina")
const path = require("node:path")

function createParsePool({size = 2, timeout = 10000, workerPath = path.join(__dirname, "parse-worker.js")} = {}) {
    const pool = new Piscina({
        filename: workerPath,
        minThreads: size,
        maxThreads: size
    })
    const waiting = []
    let active = 0

    function acquire() {
        if (active < size) {
            active++
            return Promise.resolve()
        }
        return new Promise((resolve) => waiting.push(resolve))
    }

    function release() {
        const next = waiting.shift()
        if (next) {
            next()
        } else {
            active--
        }
    }

    async function parse(url, html) {
        await acquire()
        try {
            return await pool.run({url, html}, {signal: AbortSignal.timeout(timeout)})
        } finally {
            release()
        }
    }

    return {parse, close: () => pool.destroy()}
}

module.exports = createParsePool
```

- [ ] **Step 5: Convert production and test workers to Piscina's exported-function contract**

Replace `app/parse-worker.js` with:

```js
const parser = require("@jocmp/mercury-parser")

module.exports = ({url, html}) => parser.parse(url, {html})
```

Replace `test/stub-worker.js` with:

```js
module.exports = ({url, html}) => {
    if (url === "hang") {
        while (true) {
            // Busy loop until Piscina terminates this worker.
        }
    }
    return {url, html}
}
```

- [ ] **Step 6: Remove queue-limit configuration and response handling**

Construct the pool in `app/app.js` with only the retained settings:

```js
const pool = createParsePool({
    size: parseInt(process.env.PARSE_WORKERS, 10) || 2,
    timeout: parseInt(process.env.PARSE_TIMEOUT, 10) || 10000
})
```

Reduce the parse error handler to:

```js
try {
    result = await pool.parse(url, html)
} catch (error) {
    response.locals.extra = `parse_error url=${url} message=${error.message}`
    return haltWithError(response, "Cannot extract this URL.")
}
```

- [ ] **Step 7: Run the pool test and verify GREEN**

Run:

```bash
node --test test/parse-pool.test.js
```

Expected: PASS, 3 tests passed and 0 failed.

- [ ] **Step 8: Simplify the README architecture and configuration**

Replace the architecture introduction with:

````markdown
One Express application authenticates each request, fetches the page on the
event loop, and hands the HTML to a fixed-size Piscina worker pool for Mercury
Parser extraction:

```text
app/app.js           HTTP routes, authentication, and fetching
app/parse-pool.js    parser admission, pool configuration, and timeout
app/parse-worker.js  Mercury Parser worker function
app/server.js        Node/Bun entry point and graceful shutdown
```

Parsing runs off the event loop so a pathological page cannot block the
service. Requests wait when every parser is occupied. Once admitted, a parse
that exceeds its deadline has its worker terminated and replaced.
````

Replace the optional environment-variable block with:

```text
PARSE_WORKERS   parse worker threads (default 2)
PARSE_TIMEOUT   parse deadline in milliseconds (default 10000); starts after
                the request is admitted to the parse pool
```

- [ ] **Step 9: Run both project test commands**

Run:

```bash
npm test
npm run test:bun
```

Expected: both commands exit 0 with no failed tests.

- [ ] **Step 10: Review final scope and size reduction**

Run:

```bash
git diff --check
rg -n "POISON|QUEUE_FULL|PARSE_QUEUE_LIMIT|WATCHDOG|watchdog" README.md app test
git status --short
git diff --stat node...HEAD
git diff -- app/app.js app/parse-pool.js app/parse-worker.js app/server.js README.md test/parse-pool.test.js test/timeout.test.js
```

Expected:

- `git diff --check` exits 0;
- `rg` finds no removed safeguard names;
- the custom worker message/exit/replacement lifecycle is gone;
- fetch/parse separation, fixed worker count, FIFO waiting, and
  post-admission timeout remain; and
- the implementation is substantially smaller than commit `fd56c97`.

- [ ] **Step 11: Commit the completed pool simplification**

Run:

```bash
git add README.md package.json package-lock.json app/app.js app/parse-pool.js app/parse-worker.js test/parse-pool.test.js test/stub-worker.js
git commit -m "Simplify parse pool with Piscina"
```

Expected: the commit contains the dependency, pool wrapper, worker contract,
queue-policy removal, focused tests, and documentation changes.
