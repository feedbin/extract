const {test, before, after} = require("node:test")
const assert = require("node:assert/strict")
const {once} = require("node:events")
const http = require("node:http")
const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const usersFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "extract-test-")), "users.yml")
fs.writeFileSync(usersFile, "user: key\n")
process.env.EXTRACT_USERS = usersFile

const app = require("../app/standalone")

let appServer
let appOrigin

before(async () => {
    appServer = app.listen(0)
    await once(appServer, "listening")
    appOrigin = `http://localhost:${appServer.address().port}`
})

after(() => {
    appServer.close()
})

test("health check", async () => {
    const response = await fetch(`${appOrigin}/health_check`)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), "OK")
})
