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
