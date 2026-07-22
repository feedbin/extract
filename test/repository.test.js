const {test} = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const projectRoot = path.join(__dirname, "..")
const retiredPaths = [
    ".ruby-version",
    "Gemfile",
    "Gemfile.lock",
    "Procfile",
    "Rakefile",
    "config.ru",
    "app/app.rb",
    "app/standalone.js",
    "app/standalone_server.js",
    "bin/console",
    "config/honeybadger.yml",
    "config/puma.rb",
    "config/systemd/extract-standalone@.service",
    "config/systemd/extract-standalone.env.example",
    "test/app_test.rb",
    "test/node_app_test.rb",
    "test/standalone.test.js",
    "test/standalone_server.test.js",
    "test/test_helper.rb",
    "test/test_server.rb",
    "docs/superpowers/plans/2026-07-22-bun-systemd-blue-green.md",
    "docs/superpowers/plans/2026-07-22-simplify-standalone-node-parser.md",
    "docs/superpowers/plans/2026-07-22-standalone-node-parser.md",
    "docs/superpowers/specs/2026-07-22-bun-systemd-blue-green-design.md",
    "docs/superpowers/specs/2026-07-22-simplify-standalone-node-parser-design.md",
    "docs/superpowers/specs/2026-07-22-standalone-node-parser-design.md"
]

test("repository excludes retired Ruby and comparison artifacts", () => {
    for (const retiredPath of retiredPaths) {
        assert.equal(
            fs.existsSync(path.join(projectRoot, retiredPath)),
            false,
            `retired path still exists: ${retiredPath}`
        )
    }
})
