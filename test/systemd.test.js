const {test} = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const projectRoot = path.join(__dirname, "..")
const unitPath = path.join(projectRoot, "config/systemd/extract@.service")
const environmentPath = path.join(projectRoot, "config/systemd/extract.env.example")

test("systemd template defines the Extract blue-green contract", () => {
    assert.equal(fs.existsSync(unitPath), true, "systemd template must exist")
    const lines = new Set(fs.readFileSync(unitPath, "utf8").split(/\r?\n/))
    const settings = [
        "Wants=network-online.target",
        "After=network-online.target",
        "User=extract",
        "Group=extract",
        "WorkingDirectory=/usr/local/srv/apps/extract/current",
        "Environment=NODE_ENV=production",
        "Environment=SOCKET_PATH=/run/extract-%i/server.sock",
        "EnvironmentFile=/etc/extract/%i.env",
        "RuntimeDirectory=extract-%i",
        "RuntimeDirectoryMode=0750",
        "UMask=0007",
        "ExecStart=/usr/local/bin/bun app/server.js",
        "Restart=on-failure",
        "RestartSec=5s",
        "KillSignal=SIGTERM",
        "TimeoutStopSec=30s",
        "NoNewPrivileges=true",
        "PrivateTmp=true",
        "ProtectSystem=strict",
        "ProtectHome=true",
        "StandardOutput=journal",
        "StandardError=journal",
        "SyslogIdentifier=extract-%i",
        "WantedBy=multi-user.target"
    ]

    for (const setting of settings) {
        assert.equal(lines.has(setting), true, `missing systemd setting: ${setting}`)
    }
})

test("systemd example defines the required environment", () => {
    assert.equal(fs.existsSync(environmentPath), true, "environment example must exist")
    const lines = new Set(fs.readFileSync(environmentPath, "utf8").split(/\r?\n/))

    assert.equal(lines.has("EXTRACT_USERS=/etc/extract/users.yml"), true)
})
