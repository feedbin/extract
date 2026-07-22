const {test, before, after} = require("node:test")
const assert = require("node:assert/strict")
const {once} = require("node:events")
const http = require("node:http")
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const usersFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "extract-test-")), "users.yml")
fs.writeFileSync(usersFile, "user: key\nescaped: \"key\\nline\"\n")
process.env.EXTRACT_USERS = usersFile

const app = require("../app/standalone")

const USER = "user"
const KEY = "key"
const ESCAPED_USER = "escaped"
const ESCAPED_KEY = "key\nline"

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
    if (request.url === "/undeclared-binary") {
        response.writeHead(200, {"Content-Type": "text/html"})
        response.end(Buffer.from(page("Caf\xE9"), "latin1"))
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

test("GET parser authenticates a YAML-escaped secret", async () => {
    const url = `${fixtureOrigin}/article`
    const response = await getParser(url, {
        user: ESCAPED_USER,
        signature: sign(url, ESCAPED_KEY)
    })

    assert.equal(response.status, 200)
    assert.equal((await response.json()).title, "The Title")
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

test("GET parser rejects invalid base64_url padding", async () => {
    const response = await fetch(`${appOrigin}/parser/${USER}/whatever?base64_url=aA%3D`)
    assert.equal(response.status, 400)
    assert.equal((await response.json()).messages, "Invalid request. Invalid base64_url parameter.")
})

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

// The tests below document how Mercury's built-in fetching compares to the
// Ruby downloader in app.rb — the behavioral surface the standalone version
// exists to measure.

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

test("GET parser with undeclared binary page", async () => {
    const response = await getParser(`${fixtureOrigin}/undeclared-binary`)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).title, "Caf�")
})

test("GET parser follows redirects", async () => {
    const response = await getParser(`${fixtureOrigin}/redirect`)
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.title, "The Title")
    // Drift from Ruby: the split stack reports the FINAL url after redirects;
    // Mercury reports the requested one.
    assert.equal(result.url, `${fixtureOrigin}/redirect`)
})

test("GET parser with origin error status", async () => {
    const response = await getParser(`${fixtureOrigin}/error-500`)
    assert.equal(response.status, 400)
    // Drift from Ruby, which says "Cannot extract this URL. Origin returned
    // HTTP 500." — Mercury swallows the status code.
    assert.equal((await response.json()).messages, "Cannot extract this URL.")
})
