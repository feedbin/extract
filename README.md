# Extract

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

Install Node.js 26

```bash
git clone https://github.com/feedbin/extract.git
cd extract
npm ci
```

Run the server in development:

```bash
PORT=8889 node app/server.js
```


Run both compatibility suites with:

```bash
npm test
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
