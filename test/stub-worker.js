const {parentPort} = require("node:worker_threads")

// Stand-in for parse-worker.js in pool tests: "hang" simulates a runaway
// synchronous parse, "boom" a crashing worker. The guard keeps this file
// harmless if a test runner ever executes it directly.
if (parentPort) {
    parentPort.on("message", ({url, html}) => {
        if (url === "hang") {
            while (true) {
                // busy loop until terminated
            }
        }
        if (url === "boom") {
            throw new Error("boom")
        }
        parentPort.postMessage({result: {url, html}})
    })
}
