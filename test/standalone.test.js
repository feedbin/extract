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

const USER = "user"
const KEY = "key"

let appServer
let appOrigin
let fixtureServer
let fixtureOrigin

function page(title) {
    return `<html><head><title>${title}</title></head><body><p>Some body text.</p></body></html>`
}

function fixtureHandler(request, response) {
    if (request.url === "/article") {
        response.writeHead(200, {"Content-Type": "text/html"})
        response.end(page("The Title"))
        return
    }
    response.writeHead(404, {"Content-Type": "text/html"})
    response.end(page("Not Found"))
}

before(async () => {
    appServer = app.listen(0)
    await once(appServer, "listening")
    appOrigin = `http://localhost:${appServer.address().port}`

    fixtureServer = http.createServer(fixtureHandler)
    fixtureServer.listen(0)
    await once(fixtureServer, "listening")
    fixtureOrigin = `http://localhost:${fixtureServer.address().port}`
})

after(() => {
    appServer.close()
    fixtureServer.close()
})

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

test("health check", async () => {
    const response = await fetch(`${appOrigin}/health_check`)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), "OK")
})

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
