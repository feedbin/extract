const {workerData} = require("node:worker_threads")
const fs = require("node:fs")

const heartbeat = new BigInt64Array(workerData.buffer)

setInterval(() => {
    const last = Number(Atomics.load(heartbeat, 0))
    if (Date.now() - last > workerData.limit) {
        // The main thread is blocked, so write to stderr directly (console
        // output is forwarded through the blocked thread) and use SIGKILL
        // (signal handlers would never run).
        fs.writeSync(2, `Event loop blocked for over ${workerData.limit}ms, killing process\n`)
        process.kill(process.pid, "SIGKILL")
    }
}, 1000)
