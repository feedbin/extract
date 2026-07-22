Extract
=======

Extract turns [Mercury Parser](https://github.com/postlight/parser) into an
authenticated web service that can run on a VM without platform-specific
dependencies.

How it works
------------

One Express application authenticates each request and uses Mercury Parser to
fetch and extract the requested page:

```text
app/app.js       HTTP routes, authentication, and parsing
app/server.js    Node/Bun entry point and graceful shutdown
```

Installation
------------

Install Node.js 26, clone the repository, and install dependencies:

```bash
git clone https://github.com/feedbin/extract.git
cd extract
npm ci
```

Run the server in development:

```bash
PORT=8889 node app/server.js
```

Bun can run the same entry point:

```bash
PORT=8889 bun app/server.js
```

Run both compatibility suites with:

```bash
npm test
npm run test:bun
```

Configuration
-------------

Users are defined in a YAML mapping where each key is a username and each value
is that user's non-empty secret:

```yaml
username: secret
```

Set `EXTRACT_USERS` to the file path before starting the server:

```bash
EXTRACT_USERS=users.yml PORT=8889 node app/server.js
```

The file is read once at boot, so changes require a restart. Development falls
back to a `demo` user with secret `demo` when `EXTRACT_USERS` is unset.
Production requires `EXTRACT_USERS` and refuses to start without it.

API
---

The service exposes:

```text
GET /health_check
GET /parser/:username/:signature?base64_url=:base64_url
```

`signature` is the hexadecimal HMAC-SHA1 of the decoded URL using the user's
secret. `base64_url` is canonical RFC 4648 URL-safe Base64, with optional valid
padding and no whitespace.

This Node example constructs a request URL:

```js
const crypto = require("node:crypto")

const username = "username"
const secret = "secret"
const url = "https://feedbin.com/blog/2018/09/11/private-by-default/"
const signature = crypto.createHmac("sha1", secret).update(url).digest("hex")
const encodedUrl = Buffer.from(url).toString("base64url")
const requestUrl = new URL(`/parser/${username}/${signature}`, "http://localhost:8889")
requestUrl.searchParams.set("base64_url", encodedUrl)

console.log(requestUrl.toString())
```

Production with systemd
-----------------------

`config/systemd/extract@.service` is a Bun-backed blue/green systemd template.
It runs as `extract:extract` from:

```text
/usr/local/srv/apps/extract/current
```

Install the service account and unit:

```bash
sudo useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin extract
sudo install -m 0644 config/systemd/extract@.service /etc/systemd/system/
sudo install -d -o root -g extract -m 0750 /etc/extract
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/extract@.service
```

Copy `config/systemd/extract.env.example` to `/etc/extract/blue.env` and
`/etc/extract/green.env`. Install the users file and protect all configuration:

```bash
sudo install -o root -g extract -m 0640 users.yml /etc/extract/users.yml
sudo chown root:extract /etc/extract/blue.env /etc/extract/green.env
sudo chmod 0640 /etc/extract/blue.env /etc/extract/green.env
sudo systemctl enable extract@blue.service extract@green.service
```

Each color gets its own runtime directory and socket:

```text
/run/extract-blue/server.sock
/run/extract-green/server.sock
```

The reverse proxy account must belong to the `extract` group to traverse these
directories and connect to the sockets.

Blue/green deployment
---------------------

Place releases in versioned directories and atomically update `current`. Restart
the traffic-inactive color, verify its socket, switch the external proxy, then
stop the old color:

```bash
sudo ln -sfn /usr/local/srv/apps/extract/releases/2026-07-22-001 /usr/local/srv/apps/extract/current.next
sudo mv -Tf /usr/local/srv/apps/extract/current.next /usr/local/srv/apps/extract/current

sudo systemctl restart extract@green.service
curl --fail --unix-socket /run/extract-green/server.sock http://localhost/health_check

# Switch external traffic to the green socket, then retire blue.
sudo systemctl stop extract@blue.service
```

Reverse the colors on the next deployment. Follow logs with:

```bash
sudo journalctl --follow --unit extract@green.service
```

Proxy configuration and traffic switching remain outside this repository.
