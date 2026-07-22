# Standalone Node Parser — Design

Date: 2026-07-22
Branch: `node`

## Goal

Add a pure-Node version of Extract that can run alongside the existing split
version (Ruby Sinatra web + Node parser service) so the two can be compared on
the same requests. The standalone version keeps the exact auth mechanism of the
Ruby app; page fetching is delegated to Mercury Parser's built-in fetch instead
of reimplementing the Ruby downloader.

## Decisions (made with Ben)

- **Fetching**: no new HTTP dependency. `GET` requests call
  `parser.parse(url, ...)` and let Mercury fetch the page itself. Mercury's
  redirect/charset/timeout behavior therefore differs from the Ruby
  downloader — that difference is part of what the side-by-side comparison is
  meant to reveal.
- **Tests**: Node-native, using `node:test` (no new dependency). Run with
  `npm test`. The existing Ruby suite under `bundle exec rake` is untouched.
- **Comparison**: no helper script. A third Procfile process runs the
  standalone app on its own port; comparison is manual (curl both ports).
- **Dependencies**: none added. The users file is flat `name: secret` YAML
  (per the README), parsed with a small built-in reader instead of a YAML
  package.

## Architecture

Two new files, mirroring the existing `app.js` / `server.js` split:

- `app/standalone.js` — exports an Express app: auth + parse, no proxying.
- `app/standalone_server.js` — entry point; listen + graceful shutdown,
  same pattern as `app/server.js`.

Existing files (`app/app.rb`, `app/app.js`, `app/server.js`) are not modified.

Procfile gains:

```
standalone: PORT=8889 node app/standalone_server.js
```

so `foreman start` runs web (8888), parser (3001), and standalone (8889)
side by side.

## Interface parity with the Ruby app

Routes:

- `GET /health_check` → `200 OK`, body `OK`.
- `GET /parser/:user/:signature?base64_url=...` — authenticate, then
  `parser.parse(url, {headers: {"User-Agent": <same Chrome UA as app.rb>}})`.
- `POST /parser/:user/:signature?base64_url=...` — authenticate, read JSON
  body, require `body` field, then
  `parser.parse(url, {html: json.body, contentType: "html"})` (same call the
  split stack makes; no fetching).

Auth (must match `app.rb` exactly):

- Users loaded once at boot from the `EXTRACT_USERS` file (flat
  `name: secret` mapping); fallback `{demo: "demo"}` when unset.
- `base64_url` is RFC 4648 url-safe base64 of the target URL. Decoding is
  strict like Ruby's `Base64.urlsafe_decode64`: reject characters outside
  `A-Za-z0-9_-` and `=` padding, reject impossible lengths. (Node's
  `Buffer.from(..., "base64url")` is lenient, so validation is explicit.)
- Signature is hex HMAC-SHA1 of the decoded URL with the user's secret,
  compared as a string (same as Ruby's `==`).

Error responses (status 400, `Content-Type: application/json` — no charset,
matching Sinatra's `halt`), body `{"error": true, "messages": <msg>}` with the
exact Ruby strings:

| Condition | Message |
|---|---|
| No `base64_url` param | `Invalid request. Missing base64_url parameter.` |
| Bad base64 | `Invalid request. Invalid base64_url parameter.` |
| Unknown user | `User does not exist: <user>.` |
| Bad signature | `Invalid signature.` |
| POST body not JSON | `Invalid JSON body.` |
| POST JSON without `body` | `Missing body field in JSON body.` |
| Parse/fetch failure | `Cannot extract this URL.` |

Success responses: Mercury's result JSON, `200`,
`application/json; charset=utf-8` (what the split stack returns after
proxying). A Mercury result containing `error` or a thrown exception is
normalized to `Cannot extract this URL.` — exactly how `app.rb` treats a
non-OK parser response — with the underlying detail logged, not returned.

Ordering matches `authenticate` in `app.rb`: missing param → bad base64 →
unknown user → bad signature.

## Known behavioral deltas (accepted)

- Fetch behavior (user agent aside): redirect limit, timeouts, charset
  detection, and origin-error messages are Mercury's, not the Ruby
  downloader's. In particular the Ruby-only message
  `Cannot extract this URL. Origin returned HTTP <code>.` becomes plain
  `Cannot extract this URL.`
- No Librato/Honeybadger instrumentation in the standalone process (can be
  added later if it graduates from comparison to production).
- Users file reader handles the documented flat mapping (comments and blank
  lines tolerated), not arbitrary YAML.

## Logging

Console logging in the style of `app.js`: request line plus `url=` on
authenticated requests and `parse_time=` on successful parses.

## Testing (`test/standalone.test.js`, node:test)

Fixture HTTP server via `node:http` on an ephemeral port serving: a titled
page, a meta-charset (windows-1252) page, a header-charset page, a 301→final
redirect chain, and a 500 page. The app under test listens on an ephemeral
port with `EXTRACT_USERS` pointed at a temp users file.

Scenarios (mirroring `test/app_test.rb` where applicable):

1. health check
2. GET with valid signature → 200, parsed title, JSON content type
3. invalid signature → 400 + exact message
4. unknown user → 400 + exact message
5. missing `base64_url` → 400 + exact message
6. invalid `base64_url` (`%%`) → 400 + exact message
7. POST with supplied `body` → 200, parsed title (no fetch)
8. POST invalid JSON → 400 `Invalid JSON body.`
9. POST missing `body` field → 400 `Missing body field in JSON body.`
10. redirect chain → 200 (final-URL reporting asserted to Mercury's actual
    behavior, documented in the test)
11. origin 500 → 400 `Cannot extract this URL.`
12. charset pages → assert Mercury's actual decoding behavior (documented
    drift if it differs from Ruby)

`package.json` gains `"scripts": {"test": "node --test test/"}`.

## README

Short new section documenting the standalone process, its port, and that it
exists for side-by-side comparison with the split version.
