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

test("CI runs the Node and Bun suites without Ruby", () => {
    const workflow = fs.readFileSync(path.join(projectRoot, ".github/workflows/ci.yml"), "utf8")

    assert.match(workflow, /actions\/setup-node@v7/)
    assert.match(workflow, /npm ci/)
    assert.match(workflow, /npm test/)
    assert.match(workflow, /oven-sh\/setup-bun@v2/)
    assert.match(workflow, /npm run test:bun/)
    assert.doesNotMatch(workflow, /ruby|bundler|bundle exec|rake/i)
})

test("README documents only the primary Node and Bun service", () => {
    const readme = fs.readFileSync(path.join(projectRoot, "README.md"), "utf8")

    assert.match(readme, /node app\/server\.js/)
    assert.match(readme, /config\/systemd\/extract@\.service/)
    assert.match(readme, /extract@green\.service/)
    assert.match(readme, /\/run\/extract-green\/server\.sock/)
    assert.doesNotMatch(readme, /Ruby|Sinatra|Puma|Bundler|Foreman|PARSER_URL|standalone/i)
})
