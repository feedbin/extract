const crypto = require("node:crypto")
const fs = require("node:fs")
const YAML = require("yaml")
const express = require("express")
const createParsePool = require("./parse-pool")
const app = express()

// Production listens on a Unix socket, so the client IP is only available
// from the reverse proxy's X-Forwarded-For header.
app.set("trust proxy", true)

function loadUsers() {
    if (!process.env.EXTRACT_USERS) {
        return {demo: "demo"}
    }
    const users = YAML.parse(fs.readFileSync(process.env.EXTRACT_USERS, "utf8"))
    if (!users || typeof users !== "object" || !Object.values(users).every((secret) => typeof secret === "string" && secret.length > 0)) {
        throw new Error("Invalid EXTRACT_USERS configuration: expected a mapping of usernames to non-empty string secrets")
    }
    return users
}

const users = loadUsers()

function log(request, response, extra) {
    let output = `[${request.ip}] - ${request.method} ${request.url} status_code=${response.statusCode}`
    if (extra) {
        output = `${output}: ${extra}`
    }
    console.log(output)
}

// Log every request once its response is sent. Handlers add context
// through response.locals.extra.
app.use((request, response, next) => {
    response.on("finish", () => log(request, response, response.locals.extra))
    next()
})

// Buffer's base64url decoder is lenient, so validate the URL-safe alphabet,
// padding, length, and canonical trailing bits before accepting input.
function urlsafeDecode64(input) {
    if (input.endsWith("=") || input.length % 4 === 0) {
        if (!/^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2}==|[A-Za-z0-9_-]{3}=)?$/.test(input)) {
            return null
        }
    } else if (!/^[A-Za-z0-9_-]+$/.test(input) || input.length % 4 === 1) {
        return null
    }
    const unpadded = input.replace(/=+$/, "")
    const decoded = Buffer.from(unpadded, "base64url")
    if (decoded.toString("base64url") !== unpadded) {
        return null
    }
    return decoded
}

function haltWithError(response, message) {
    response.status(400).json({error: true, messages: message})
    return null
}

const FETCH_TIMEOUT = 10000
const MAX_CONTENT_LENGTH = 5242880

const pool = createParsePool({
    size: parseInt(process.env.PARSE_WORKERS, 10) || 2,
    timeout: parseInt(process.env.PARSE_TIMEOUT, 10) || 10000
})
// Exposed so tests can shut the workers down and let the process exit.
app.locals.parsePool = pool

function charsetFrom(contentType) {
    const match = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType || "")
    return match ? match[1] : null
}

// Mercury skips all charset handling for pre-fetched HTML, so decode here.
// A meta tag wins over the Content-Type header, matching Mercury's own fetch.
function decodeHtml(body, contentType) {
    if (body[0] === 0xFF && body[1] === 0xFE) {
        return new TextDecoder("utf-16le").decode(body)
    }
    if (body[0] === 0xFE && body[1] === 0xFF) {
        return new TextDecoder("utf-16be").decode(body)
    }
    const head = body.subarray(0, 16384).toString("latin1")
    const metaCharset = /<meta[^>]*charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1]
    const label = metaCharset || charsetFrom(contentType) || "utf-8"
    try {
        return new TextDecoder(label).decode(body)
    } catch {
        return new TextDecoder().decode(body)
    }
}

function discard(response) {
    response.body?.cancel().catch(() => {})
}

// Mirrors the fetch behavior Mercury had when it fetched URLs itself:
// 10 second deadline, 5MB cap, reject non-200 and non-text responses.
async function fetchHtml(url) {
    const response = await fetch(url, {signal: AbortSignal.timeout(FETCH_TIMEOUT)})
    if (response.status !== 200) {
        discard(response)
        throw new Error(`Resource returned a response status code of ${response.status} and resource was instructed to reject non-200 status codes.`)
    }
    const contentType = response.headers.get("content-type") ?? ""
    if (!contentType.includes("html") && !contentType.includes("text")) {
        discard(response)
        throw new Error("Content does not appear to be text.")
    }
    if (Number(response.headers.get("content-length")) > MAX_CONTENT_LENGTH) {
        discard(response)
        throw new Error(`Content for this resource was too large. Maximum content length is ${MAX_CONTENT_LENGTH}.`)
    }
    const chunks = []
    let length = 0
    for await (const chunk of response.body ?? []) {
        length += chunk.length
        if (length > MAX_CONTENT_LENGTH) {
            throw new Error(`Content for this resource was too large. Maximum content length is ${MAX_CONTENT_LENGTH}.`)
        }
        chunks.push(chunk)
    }
    return decodeHtml(Buffer.concat(chunks), contentType)
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
    if (!Object.hasOwn(users, user)) {
        return haltWithError(response, `User does not exist: ${user}.`)
    }
    const key = users[user]
    if (!key || request.params.signature !== crypto.createHmac("sha1", key).update(url).digest("hex")) {
        return haltWithError(response, "Invalid signature.")
    }
    return url.toString("utf8")
}

app.get("/health_check", (request, response) => {
    response.send("OK")
})

app.get("/parser/:user/:signature", async (request, response) => {
    let url = null
    try {
        url = authenticate(request, response)
        if (url === null) {
            return
        }

        const fetchStart = Date.now()
        let html = null
        try {
            html = await fetchHtml(url)
        } catch (error) {
            response.locals.extra = `fetch_error url=${url} message=${error.message}`
            return haltWithError(response, "Cannot extract this URL.")
        }

        const parseStart = Date.now()
        let result = null
        try {
            result = await pool.parse(url, html)
        } catch (error) {
            response.locals.extra = `parse_error url=${url} message=${error.message}`
            return haltWithError(response, "Cannot extract this URL.")
        }

        if (result && typeof result === "object" && "error" in result) {
            response.locals.extra = `parse_error url=${url} message=${result.message}`
            return haltWithError(response, "Cannot extract this URL.")
        }

        response.locals.extra = `fetch_time=${parseStart - fetchStart} parse_time=${Date.now() - parseStart} url=${url}`
        response.json(result)
    } catch (error) {
        response.locals.extra = `exception=${error.message} url=${url}`
        console.error(error.stack)
        if (!response.headersSent) {
            haltWithError(response, "Cannot extract this URL.")
        }
    }
})

module.exports = app
