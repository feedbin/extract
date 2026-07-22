const app = require("./standalone")
const serverPort = process.env.PORT || 8889
const server = app.listen(serverPort, () => {
    console.log(`Extract standalone started on port ${serverPort}`)
})

function shutdown(signal) {
    if (process.env.NODE_ENV === "production") {
        console.log(`${signal} received, shutting down`)
        server.close((error) => {
            if (error) {
                console.error(error)
                process.exit(1)
            }
            process.exit(0)
        })
        server.closeIdleConnections()
    } else {
        process.exit(0)
    }
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
