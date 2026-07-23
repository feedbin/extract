const {test} = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const createParsePool = require("../app/parse-pool")

const workerPath = path.join(__dirname, "stub-worker.js")

test("parse pool resolves results", async () => {
    const pool = createParsePool({size: 1, workerPath})
    const result = await pool.parse("http://example.com/", "<html></html>")
    assert.deepEqual(result, {url: "http://example.com/", html: "<html></html>"})
    await pool.close()
})

test("parse pool terminates a stuck parse and recovers its slot", async () => {
    const pool = createParsePool({size: 1, timeout: 200, workerPath})
    await assert.rejects(pool.parse("hang", ""), (error) => error.name === "AbortError")
    const result = await pool.parse("http://example.com/after", "ok")
    assert.equal(result.url, "http://example.com/after")
    await pool.close()
})

test("parse pool waits for capacity without consuming the parse timeout", async () => {
    const pool = createParsePool({size: 1, timeout: 100, workerPath})
    const work = [
        pool.parse("hang", ""),
        ...Array.from({length: 25}, (_, index) => pool.parse(`http://example.com/${index}`, "ok"))
    ]

    const [hung, ...waiting] = await Promise.allSettled(work)

    assert.equal(hung.status, "rejected")
    assert.equal(hung.reason.name, "AbortError")
    assert.equal(waiting.every((result) => result.status === "fulfilled"), true)
    await pool.close()
})
