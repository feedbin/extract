const Piscina = require("piscina")
const path = require("node:path")

function createParsePool({size = 2, timeout = 10000, workerPath = path.join(__dirname, "parse-worker.js")} = {}) {
    const pool = new Piscina({
        filename: workerPath,
        minThreads: size,
        maxThreads: size,
        atomics: "disabled"
    })
    const waiting = []
    let active = 0

    function acquire() {
        if (active < size) {
            active++
            return Promise.resolve()
        }
        return new Promise((resolve) => waiting.push(resolve))
    }

    function release() {
        const next = waiting.shift()
        if (next) {
            next()
        } else {
            active--
        }
    }

    async function parse(url, html) {
        await acquire()
        try {
            return await pool.run({url, html}, {signal: AbortSignal.timeout(timeout)})
        } finally {
            release()
        }
    }

    return {parse, close: () => pool.destroy()}
}

module.exports = createParsePool
