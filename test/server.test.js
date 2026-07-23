const {test} = require("node:test")
const assert = require("node:assert/strict")
const {spawnSync} = require("node:child_process")
const path = require("node:path")

test("server entry point has valid syntax", () => {
    const server = path.join(__dirname, "..", "app", "server.js")
    // Bun has no --check flag and would execute the server; bun build --no-bundle parses without running
    const checkArguments = process.versions.bun ? ["build", "--no-bundle", server] : ["--check", server]
    const result = spawnSync(process.execPath, checkArguments, {encoding: "utf8"})

    assert.equal(result.status, 0, result.stderr)
})
