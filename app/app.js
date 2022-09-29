const express = require("express")
const app = express()
const parser = require("@postlight/parser")
const validator = require("./validator")

function decodeURL(encodedURL) {
    return Buffer.from(encodedURL, "base64").toString("utf-8")
}

function getParams(request) {
    const user = request.params.user
    const signature = request.params.signature
    const base64url = request.query.base64_url.replace(/ /g, "+")
    const url = decodeURL(base64url)
    return { user, signature, url }
}

function log(request, extra) {
    let output = `[${request.ip}] - ${request.method} ${request.url}`
    if (extra) {
        output = `${output}: ${extra}`
    }
    console.log(output)
}

function errorHandler(request, response, next, error, message) {
    log(request, message)
    response.status(400).json({
        error: true,
        messages: message
    })
    next(error)
}

app.get("/health_check", (request, response) => {
    log(request)
    response.send("200 OK")
})

app.get("/parser/:user/:signature", async (request, response, next) => {
    try {
        let { user, signature, url } = getParams(request)

        try {
            const auth = new validator(user, url, signature)
            await auth.validate()
        } catch (error) {
            errorHandler(request, response, next, error, error.message)
            return
        }

        try {
            let result = await parser.parse(url)
            const code = "error" in result ? 400 : 200
            log(request)
            response.status(code).send(result)
        } catch (error) {
            errorHandler(request, response, next, error, "Cannot extract this URL.")
            return
        }
    } catch (error) {
        errorHandler(request, response, next, error, "Invalid request. Missing base64_url parameter.")
        return
    }
})

module.exports = app
