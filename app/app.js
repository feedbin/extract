const parser  = require("@jocmp/mercury-parser")
const express = require("express")
const app     = express()

function log(request, extra) {
    let output = `[${request.ip}] - ${request.method} ${request.url}`
    if (extra) {
        output = `${output}: ${extra}`
    }
    console.log(output)
}

app.use(express.json({limit: `10mb`}))

app.get("/health_check", (request, response) => {
    log(request)
    response.send("200 OK")
})

app.post("/parser", async (request, response, next) => {
    try {
        const start = new Date().getTime()
        const result = await parser.parse(request.body.url, request.body.options)
        const end = new Date().getTime() - start
        const code = "error" in result ? 400 : 200
        log(request, `parse_time=${end} url=${request.body.url}`)
        response.status(code).send(result)
    } catch (error) {
        log(request, error.message)
        response.status(400).json({
            error: true,
            messages: error.message
        })
        next(error)
    }
})

module.exports = app
