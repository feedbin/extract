# Simplify Standalone Node Parser — Design

Date: 2026-07-22

## Goal

Reduce the standalone Node parser to its GET-only comparison use case while
replacing handwritten YAML parsing with the `yaml` package and preserving its
strict URL-safe Base64 authentication behavior.

## Runtime and dependencies

- Keep Node 24 as selected by `.nvmrc`.
- Add the `yaml` npm package as a production dependency.
- Continue reading `EXTRACT_USERS` once when `app/standalone.js` is required.
- Parse the users file with `YAML.parse(fs.readFileSync(path, "utf8"))` and
  retain the `{demo: "demo"}` fallback when `EXTRACT_USERS` is unset.

## HTTP interface

The standalone app retains these routes:

- `GET /health_check` returns `200 OK` with body `OK`.
- `GET /parser/:user/:signature?base64_url=...` authenticates and asks Mercury
  Parser to fetch and parse the decoded URL.

The explicit POST parser route is removed. Express will therefore handle POST
requests to that path as an unmatched route and return its normal `404`
response.

Mercury fetches no longer receive an application-supplied User-Agent header.
They use the dependency's default request headers.

## Authentication and errors

The existing `urlsafeDecode64()` implementation remains unchanged. Node 24's
standard `Buffer.from(value, "base64url")` decoder is deliberately lenient and
does not preserve the current invalid-Base64 error contract.

Authentication continues in this order:

1. missing `base64_url`;
2. invalid URL-safe Base64;
3. unknown user;
4. invalid HMAC-SHA1 signature.

`haltWithError()` will use Express's
`response.status(400).json({error: true, messages: message})`. Error responses
will consequently use `Content-Type: application/json; charset=utf-8` rather
than the previous charset-free value.

## Code simplification

- Remove the handwritten YAML line parser and `unquote()` helper.
- Remove the raw-body middleware, POST route, and POST-only test helpers.
- Remove the custom User-Agent constant and GET parser header options.
- Inline one-use helpers (`signatureValid()`, `parse()`, and `responseError()`)
  when doing so leaves the GET route easier to follow.
- Preserve request logging, parse timing, Mercury error normalization, and the
  exported Express app interface.

## Testing

Use `node:test` and follow red-green-refactor:

- Add a users fixture whose quoted YAML secret includes an escape sequence,
  proving that the `yaml` parser rather than the old line parser is active.
- Assert that POST to the parser path now returns `404`.
- Capture the fixture server's User-Agent header and assert that the former
  Chrome User-Agent is no longer supplied.
- Update error content-type expectations for `response.json()`.
- Retain malformed URL-safe Base64 tests, including bad characters and bad
  padding, so strict decoding cannot be accidentally relaxed.
- Run both `npm test` and `bundle exec rake`; the Ruby application remains
  untouched.
