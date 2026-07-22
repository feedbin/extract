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

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"

// Raw body + manual JSON.parse mirrors app.rb, which reads the body itself
// regardless of content type, and only after authentication.
app.use(express.raw({type: () => true, limit: "10mb"}))

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

// Sinatra's halt sends Content-Type application/json with no charset, and the
// error contract is compared byte-for-byte against the Ruby version, so this
// bypasses res.set/res.json, which append "; charset=utf-8".
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
        await parse(request, response, url, {headers: {"User-Agent": USER_AGENT}})
    } catch (error) {
        responseError(request, response, error, url)
    }
})

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

module.exports = app
