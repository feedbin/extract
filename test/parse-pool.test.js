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

test("parse pool terminates and replaces a stuck worker", async () => {
    const pool = createParsePool({size: 1, timeout: 200, workerPath})
    await assert.rejects(pool.parse("hang", ""), (error) => error.code === "PARSE_TIMEOUT")
    const result = await pool.parse("http://example.com/after", "ok")
    assert.equal(result.url, "http://example.com/after")
    await pool.close()
})

test("parse pool rejects new work when the queue is full", async () => {
    const pool = createParsePool({size: 1, timeout: 500, queueLimit: 1, workerPath})
    const hung = pool.parse("hang", "")
    const queued = pool.parse("http://example.com/queued", "")
    await assert.rejects(pool.parse("http://example.com/rejected", ""), (error) => error.code === "QUEUE_FULL")
    await assert.rejects(hung, (error) => error.code === "PARSE_TIMEOUT")
    assert.equal((await queued).url, "http://example.com/queued")
    await pool.close()
})

test("parse pool survives a crashing worker", async () => {
    const pool = createParsePool({size: 1, workerPath})
    await assert.rejects(pool.parse("boom", ""), /boom/)
    const result = await pool.parse("http://example.com/next", "")
    assert.equal(result.url, "http://example.com/next")
    await pool.close()
})

test("parse pool rejects work after close", async () => {
    const pool = createParsePool({size: 1, workerPath})
    await pool.close()
    await assert.rejects(pool.parse("http://example.com/", ""), (error) => error.code === "POOL_CLOSED")
})
