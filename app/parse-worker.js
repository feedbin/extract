const {parentPort} = require("node:worker_threads")
const parser = require("@jocmp/mercury-parser")

parentPort.on("message", async ({url, html}) => {
    try {
        const result = await parser.parse(url, {html})
        parentPort.postMessage({result})
    } catch (error) {
        parentPort.postMessage({error: error.message})
    }
})
