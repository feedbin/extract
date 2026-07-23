const {Worker} = require("node:worker_threads")
const path = require("node:path")

// Kills the process from a side thread if the main event loop stops beating
// for longer than the limit, so the supervisor can restart it. Last-resort
// backstop: the parse pool should keep the loop from ever blocking.
function startWatchdog(limit) {
    const buffer = new SharedArrayBuffer(8)
    const heartbeat = new BigInt64Array(buffer)
    Atomics.store(heartbeat, 0, BigInt(Date.now()))
    const worker = new Worker(path.join(__dirname, "watchdog-worker.js"), {workerData: {buffer, limit}})
    worker.unref()
    setInterval(() => {
        Atomics.store(heartbeat, 0, BigInt(Date.now()))
    }, 1000).unref()
}

module.exports = startWatchdog
