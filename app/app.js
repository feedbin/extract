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
    const users = YAML.parse(fs.readFileSync(process.env.EXTRACT_USERS, "utf8"))
    const valid = users !== null &&
        typeof users === "object" &&
        !Array.isArray(users) &&
        Object.keys(users).length > 0 &&
        Object.values(users).every((secret) => typeof secret === "string" && secret.length > 0)
    if (!valid) {
        throw new Error("Invalid EXTRACT_USERS configuration: expected a non-empty mapping of usernames to non-empty string secrets")
    }
    return users
}

const users = loadUsers()

function log(request, extra) {
    let output = `[${request.ip}] - ${request.method} ${request.url}`
    if (extra) {
        output = `${output}: ${extra}`
    }
    console.log(output)
}

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
