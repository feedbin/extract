const {test} = require("node:test")
const assert = require("node:assert/strict")
const {spawnSync} = require("node:child_process")
const path = require("node:path")

test("server entry point has valid syntax", () => {
    const server = path.join(__dirname, "..", "app", "server.js")
    const checkArguments = ["--check", server]
    const result = spawnSync(process.execPath, checkArguments, {encoding: "utf8"})

    assert.equal(result.status, 0, result.stderr)
})
