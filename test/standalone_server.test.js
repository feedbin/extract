const {afterEach, test} = require("node:test")
const assert = require("node:assert/strict")
const {once} = require("node:events")
const {spawn} = require("node:child_process")
const fs = require("node:fs")
const http = require("node:http")
const os = require("node:os")
const path = require("node:path")

const projectRoot = path.join(__dirname, "..")
const runningChildren = new Set()
const temporaryDirectories = new Set()

function createTemporaryDirectory() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "extract-standalone-server-test-"))
    temporaryDirectories.add(directory)
    return directory
}

function startStandalone({socketPath, usersYaml = "user: key\n", includeExtractUsers = true} = {}) {
    const directory = createTemporaryDirectory()
    const usersFile = path.join(directory, "users.yml")

    const environment = {
        ...process.env,
        NODE_ENV: "production"
    }
    if (includeExtractUsers) {
        fs.writeFileSync(usersFile, usersYaml)
        environment.EXTRACT_USERS = usersFile
    } else {
        delete environment.EXTRACT_USERS
    }
    if (socketPath) {
        environment.SOCKET_PATH = socketPath
    } else {
        delete environment.SOCKET_PATH
    }

    const child = spawn(process.execPath, ["app/standalone_server.js"], {
        cwd: projectRoot,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"]
    })
    child.output = {stdout: "", stderr: ""}
    child.stdout.on("data", (chunk) => { child.output.stdout += chunk })
    child.stderr.on("data", (chunk) => { child.output.stderr += chunk })
    runningChildren.add(child)
    child.once("exit", () => runningChildren.delete(child))
    return child
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForSocket(socketPath, child) {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
        if (fs.existsSync(socketPath)) {
            return
        }
        if (child.exitCode !== null) {
            throw new Error(`Standalone server exited before listening with code ${child.exitCode}: ${child.output.stdout}${child.output.stderr}`)
        }
        await delay(25)
    }
    throw new Error(`Standalone server did not create socket: ${child.output.stderr}`)
}

async function waitForExit(child) {
    if (child.exitCode !== null) {
        return {code: child.exitCode, signal: child.signalCode}
    }
    const [code, signal] = await Promise.race([
        once(child, "exit"),
        delay(5_000).then(() => {
            throw new Error(`Standalone server did not exit: ${child.output.stderr}`)
        })
    ])
    return {code, signal}
}

function request(socketPath) {
    return new Promise((resolve, reject) => {
        const request = http.get({socketPath, path: "/health_check"}, (response) => {
            let body = ""
            response.setEncoding("utf8")
            response.on("data", (chunk) => { body += chunk })
            response.on("end", () => resolve({status: response.statusCode, body}))
        })
        request.on("error", reject)
    })
}

async function stopChild(child) {
    if (child.exitCode === null) {
        child.kill("SIGTERM")
        try {
            await waitForExit(child)
        } catch (error) {
            child.kill("SIGKILL")
            await once(child, "exit")
        }
    }
}

afterEach(async () => {
    await Promise.all([...runningChildren].map(stopChild))
    for (const directory of temporaryDirectories) {
        fs.rmSync(directory, {recursive: true, force: true})
    }
    temporaryDirectories.clear()
})

test("production standalone serves health checks over its Unix socket", async () => {
    const socketPath = path.join(createTemporaryDirectory(), "extract.sock")
    const child = startStandalone({socketPath})

    await waitForSocket(socketPath, child)
    const response = await request(socketPath)

    assert.equal(response.status, 200)
    assert.equal(response.body, "OK")

    child.kill("SIGTERM")
    const exit = await waitForExit(child)
    assert.equal(exit.code, 0)
    assert.equal(fs.existsSync(socketPath), false)
})

test("production standalone requires SOCKET_PATH", async () => {
    const child = startStandalone()
    const exit = await waitForExit(child)

    assert.notEqual(exit.code, 0)
    assert.match(child.output.stderr, /SOCKET_PATH is required in production/)
})

test("production standalone requires EXTRACT_USERS before loading the app", async () => {
    const child = startStandalone({includeExtractUsers: false})
    const exit = await waitForExit(child)

    assert.notEqual(exit.code, 0)
    assert.match(child.output.stderr, /EXTRACT_USERS is required in production/)
})

test("production standalone rejects invalid users YAML at boot", async () => {
    const invalidDocuments = [
        ["null document", "null\n"],
        ["array document", "- key\n"],
        ["empty mapping", "{}\n"],
        ["empty secret", "user: \"\"\n"],
        ["non-string secret", "user: 123\n"]
    ]

    for (const [name, usersYaml] of invalidDocuments) {
        const socketPath = path.join(createTemporaryDirectory(), "extract.sock")
        const child = startStandalone({socketPath, usersYaml})
        const exit = await waitForExit(child)

        assert.notEqual(exit.code, 0, name)
        assert.match(child.output.stderr, /Invalid EXTRACT_USERS configuration: expected a non-empty mapping of usernames to non-empty string secrets/, name)
    }
})
