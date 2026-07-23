const {test, before, after} = require("node:test")
const assert = require("node:assert/strict")
const {once} = require("node:events")
const {spawn} = require("node:child_process")
const net = require("node:net")
const http = require("node:http")
const crypto = require("node:crypto")
const path = require("node:path")

// The app under test runs in a child process because it is configured
// through environment variables, and bun test runs every file in a single
// process where env changes and the require cache would leak into other
// test files.

let appOrigin
let appProcess
let fixtureServer
let fixtureOrigin
let fixtureHits = 0

async function freePort() {
    const server = net.createServer()
    server.listen(0)
    await once(server, "listening")
    const port = server.address().port
    server.close()
    await once(server, "close")
    return port
}

async function waitForServer(origin) {
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            const response = await fetch(`${origin}/health_check`)
            if (response.ok) {
                return
            }
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
    }
    throw new Error("Server did not start")
}

before(async () => {
    fixtureServer = http.createServer((request, response) => {
        fixtureHits++
        response.writeHead(200, {"Content-Type": "text/html"})
        response.end("<html><head><title>Slow</title></head><body><p>Some body text.</p></body></html>")
    })
    fixtureServer.listen(0)
    await once(fixtureServer, "listening")
    fixtureOrigin = `http://localhost:${fixtureServer.address().port}`

    // A 1ms deadline makes every parse time out: the worker round-trip alone
    // takes longer, so the first request reliably poisons its URL.
    const port = await freePort()
    appOrigin = `http://localhost:${port}`
    const env = {...process.env, PORT: String(port), PARSE_TIMEOUT: "1"}
    delete env.EXTRACT_USERS
    delete env.NODE_ENV
    appProcess = spawn(process.execPath, [path.join(__dirname, "..", "app", "server.js")], {env, stdio: "ignore"})
    await waitForServer(appOrigin)
})

after(() => {
    appProcess?.kill()
    fixtureServer?.close()
})

function parserUrl(url) {
    const signature = crypto.createHmac("sha1", "demo").update(url).digest("hex")
    return `${appOrigin}/parser/demo/${signature}?base64_url=${Buffer.from(url).toString("base64url")}`
}

test("a parse timeout opens the poison circuit breaker", async () => {
    const url = `${fixtureOrigin}/article`

    const first = await fetch(parserUrl(url))
    assert.equal(first.status, 400)
    assert.equal((await first.json()).messages, "Cannot extract this URL.")
    assert.equal(fixtureHits, 1)

    const second = await fetch(parserUrl(url))
    assert.equal(second.status, 400)
    assert.equal((await second.json()).messages, "Cannot extract this URL.")
    assert.equal(fixtureHits, 1, "poisoned URL must be rejected before fetching again")
})
