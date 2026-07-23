const {Worker} = require("node:worker_threads")
const path = require("node:path")

// Runs parses in worker threads so runaway synchronous parsing cannot block
// the event loop. A task that exceeds the deadline gets its worker terminated
// and replaced; terminating the thread is the only way to stop stuck
// synchronous code.
function createParsePool({size = 2, timeout = 10000, queueLimit = 20, workerPath = path.join(__dirname, "parse-worker.js")} = {}) {
    const queue = []
    const slots = []
    let closed = false

    function startWorker(slot) {
        const worker = new Worker(workerPath)
        // Unreferenced workers let the process exit naturally; pending task
        // timers keep the event loop alive while a parse is in flight.
        worker.unref()
        worker.on("message", (message) => {
            if (slot.worker === worker && slot.task) {
                finish(slot, message)
            }
        })
        worker.on("error", (error) => {
            if (slot.worker === worker) {
                replace(slot, error)
            }
        })
        worker.on("exit", (code) => {
            if (slot.worker === worker) {
                replace(slot, new Error(`Parse worker exited with code ${code}`))
            }
        })
        slot.worker = worker
    }

    function takeTask(slot) {
        const task = slot.task
        clearTimeout(slot.timer)
        slot.task = null
        slot.timer = null
        return task
    }

    function finish(slot, message) {
        const task = takeTask(slot)
        if (message.error) {
            task.reject(new Error(message.error))
        } else {
            task.resolve(message.result)
        }
        dispatch(slot)
    }

    function replace(slot, error) {
        const task = takeTask(slot)
        const worker = slot.worker
        slot.worker = null
        worker.removeAllListeners()
        worker.terminate()
        startWorker(slot)
        if (task) {
            task.reject(error)
        }
        dispatch(slot)
    }

    function expire(slot) {
        const error = new Error(`Parse timed out after ${timeout}ms`)
        error.code = "PARSE_TIMEOUT"
        replace(slot, error)
    }

    function dispatch(slot) {
        if (slot.task || queue.length === 0) {
            return
        }
        slot.task = queue.shift()
        slot.timer = setTimeout(() => expire(slot), timeout)
        slot.worker.postMessage({url: slot.task.url, html: slot.task.html})
    }

    for (let i = 0; i < size; i++) {
        const slot = {worker: null, task: null, timer: null}
        startWorker(slot)
        slots.push(slot)
    }

    function parse(url, html) {
        return new Promise((resolve, reject) => {
            if (closed) {
                reject(closedError())
                return
            }
            if (queue.length >= queueLimit) {
                const error = new Error("Parse queue is full")
                error.code = "QUEUE_FULL"
                reject(error)
                return
            }
            queue.push({url, html, resolve, reject})
            const idle = slots.find((slot) => !slot.task)
            if (idle) {
                dispatch(idle)
            }
        })
    }

    function closedError() {
        const error = new Error("Parse pool is closed")
        error.code = "POOL_CLOSED"
        return error
    }

    // Terminates all workers so the process can exit; used by tests and
    // graceful shutdown. unref() alone is not enough because a worker's
    // MessagePort becomes referenced again once it has delivered a message.
    function close() {
        closed = true
        while (queue.length > 0) {
            queue.shift().reject(closedError())
        }
        return Promise.all(slots.map((slot) => {
            const task = takeTask(slot)
            if (task) {
                task.reject(closedError())
            }
            const worker = slot.worker
            slot.worker = null
            worker.removeAllListeners()
            return worker.terminate()
        }))
    }

    return {parse, close}
}

module.exports = createParsePool
