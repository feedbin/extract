# Extract

Extract turns [Mercury Parser](https://github.com/postlight/parser) into an
authenticated web service that can run on a VM without platform-specific
dependencies.

How it works
------------

One Express application authenticates each request, fetches the page on the
event loop, and hands the HTML to a fixed-size Piscina worker pool for Mercury
Parser extraction:

```text
app/app.js           HTTP routes, authentication, and fetching
app/parse-pool.js    parser admission, pool configuration, and timeout
app/parse-worker.js  Mercury Parser worker function
app/server.js        Node/Bun entry point and graceful shutdown
```

Parsing runs off the event loop so a pathological page cannot block the
service. Requests wait when every parser is occupied. Once admitted, a parse
that exceeds its deadline has its worker terminated and replaced.

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

Optional environment variables tune the parsing isolation:

```text
PARSE_WORKERS   parse worker threads (default 2)
PARSE_TIMEOUT   parse deadline in milliseconds (default 10000); starts after
                the request is admitted to the parse pool
```

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
