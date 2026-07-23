# Simplified Parse Pool Design

## Goal

Keep HTTP fetching off the parser workers and protect the service from a
synchronous Mercury Parser hang, while replacing the branch's custom worker
lifecycle machinery with a small, understandable design.

## Scope

The service will continue to:

- authenticate requests before doing network work;
- fetch and decode HTML on the main Node.js event loop;
- limit fetches to 10 seconds and responses to 5 MB;
- disable Mercury's multi-page fetching so parser workers do no network work;
- parse fetched HTML outside the main event loop;
- use a fixed number of parser workers; and
- terminate a worker when its parse exceeds the configured parse timeout.

The poison URL cache and event-loop watchdog are removed. They are additional
policies rather than requirements of fetch/parse isolation, and Piscina owns
worker termination and replacement after a timed-out task.

## Architecture

`app/app.js` remains responsible for HTTP behavior, authentication, fetching,
decoding, logging, and translating internal failures into API responses.

`app/parse-pool.js` becomes a thin wrapper around Piscina. Piscina owns worker
creation, task delivery, worker termination, and worker replacement. The
wrapper preserves the existing `parse(url, html)` and `close()` interface so
the route and test teardown remain straightforward.

`app/parse-worker.js` exports one function that calls
`parser.parse(url, {html, fetchAllPages: false})`. Piscina loads and invokes
that export directly, so the application no longer handles worker messages,
exits, or errors itself. Disabling multi-page fetching keeps all network I/O
in `app/app.js` on the main event loop.

## Admission and Timing

The wrapper contains a small FIFO admission gate with capacity equal to the
configured worker count. A call to `parse()` waits at that gate until a worker
slot is available. There is no queue limit and waiting requests are not
rejected because of parser load.

After admission, the wrapper submits the task to Piscina with an
`AbortSignal.timeout(PARSE_TIMEOUT)`. Queue time therefore does not consume the
parse timeout. When the task settles, the wrapper releases the admission slot
to the next waiter in FIFO order.

Piscina uses the same value for `minThreads` and `maxThreads`, keeping the pool
at a fixed size. Its internal queue remains available for brief worker startup
and replacement windows, but the admission gate ensures that no more than the
configured number of application tasks are submitted concurrently.

## Configuration

The service retains:

- `PARSE_WORKERS`, defaulting to `2`; and
- `PARSE_TIMEOUT`, defaulting to `10000` milliseconds.

`PARSE_QUEUE_LIMIT` and `WATCHDOG_LIMIT` are removed. Sustained overload can
leave an unbounded number of HTTP requests waiting for parser admission; this
is intentional because the required behavior is to wait rather than reject a
request when all parser workers are occupied.

## Errors and Shutdown

A Piscina abort caused by the parse deadline is logged as a parse error and
returns the existing generic `400` extraction failure. Mercury Parser errors
and worker failures use the same existing response. There is no parser-busy
`503` response.

`close()` destroys the Piscina pool for test teardown. Production shutdown
continues to rely on the existing server process shutdown behavior.

## File Changes

- Add Piscina to `package.json` and `package-lock.json`.
- Replace the implementation of `app/parse-pool.js` with the Piscina wrapper
  and FIFO admission gate.
- Simplify `app/parse-worker.js` to an exported parser function.
- Remove poison-cache and queue-full handling from `app/app.js`.
- Restore `app/server.js` to the simple server entry point from `node`.
- Delete `app/watchdog.js` and `app/watchdog-worker.js`.
- Update `README.md` to describe the smaller architecture and configuration.
- Replace custom worker-lifecycle tests with application-owned behavior tests.
- Delete the poison-cache integration test.

## Testing

Tests will cover the behavior owned by the application:

1. A normal parse returns its worker result.
2. A synchronous hung parse times out and the next parse succeeds, proving
   that the worker slot is recovered.
3. More requests than the worker count wait and eventually run instead of
   receiving a queue-full rejection.
4. Time spent waiting for admission does not consume the parse timeout.
5. A supplied page with a next-page link is parsed without worker network I/O
   or aggregation of linked content.
6. The existing HTTP, authentication, fetch, charset, redirect, and upstream
   failure tests continue to pass.

Tests will not duplicate Piscina's internal lifecycle test suite for worker
crashes, message handling, or pool closure.

## Non-goals

- Retrying failed parses.
- Remembering or blocking URLs that previously timed out.
- Detecting unrelated event-loop stalls.
- Limiting the number of requests waiting for parser admission.
- Changing the public API or successful parser response format.
