if (process.env.NODE_ENV === "production" && !process.env.EXTRACT_USERS) {
    throw new Error("EXTRACT_USERS is required in production")
}
const app = require("./app")
const serverTarget = process.env.NODE_ENV === "production" ? process.env.SOCKET_PATH : process.env.PORT || 8889
if (!serverTarget) {
    throw new Error("SOCKET_PATH is required in production")
}
const server = app.listen(serverTarget, () => {
    console.log(`Extract started on ${serverTarget}`)
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
