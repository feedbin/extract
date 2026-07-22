# Node-Only Extract Cleanup — Design

Date: 2026-07-22

## Goal

Make the Node/Bun application the only Extract implementation. Remove the
retired Ruby web application, its split Node parser, comparison-era naming,
tests, dependencies, process definitions, and documentation.

Capistrano integration is explicitly outside this cleanup. Production keeps a
single `/usr/local/srv/apps/extract/current` application symlink.

## Application structure

The surviving application is renamed from comparison-era `standalone` names to
the repository's primary names:

```text
app/app.js       Express application
app/server.js    Node/Bun process entry point and graceful shutdown
```

The existing HTTP interface and behavior remain unchanged:

- `GET /health_check` returns `OK`;
- `GET /parser/:user/:signature?base64_url=...` authenticates the request and
  parses the remote page with Mercury Parser;
- production requires `EXTRACT_USERS` and a Unix `SOCKET_PATH`;
- development retains the `demo:demo` fallback and `PORT` default;
- configured users YAML and strict URL-safe Base64 validation remain unchanged.

The old split parser (`app/app.js` and `app/server.js` before the rename) is
deleted before the surviving files take those paths. The old `Procfile` is
deleted because there is no longer a multi-process local stack.

## Ruby removal

Delete the complete Ruby runtime and support surface:

```text
.ruby-version
Gemfile
Gemfile.lock
Rakefile
config.ru
app/app.rb
bin/console
config/honeybadger.yml
config/puma.rb
test/app_test.rb
test/node_app_test.rb
test/test_helper.rb
test/test_server.rb
```

Remove stale, untracked Puma PID/state files from `tmp/`. Remove Ruby-only
ignore entries that no longer describe repository output, while retaining
generic/deployment ignores such as `.env`, `node_modules`, `shared`, and
`tmp`.

## Tests and continuous integration

Rename the Node test files with the application:

```text
test/app.test.js
test/server.test.js
test/systemd.test.js
```

Tests continue using real local HTTP servers and real child processes. Their
module and entry-point paths change to `app/app.js` and `app/server.js`; test
coverage and behavior do not otherwise weaken.

GitHub Actions removes Ruby setup and `bundle exec rake`. CI installs npm
dependencies, runs the Node 26 suite with `npm test`, installs Bun, and runs
the same suite with `npm run test:bun`.

## Production service

Rename the service artifacts:

```text
config/systemd/extract@.service
config/systemd/extract.env.example
```

Supported instances become:

```text
extract@blue.service
extract@green.service
```

The service restores and preserves the approved non-Capistrano contract:

- `WorkingDirectory=/usr/local/srv/apps/extract/current`;
- `ExecStart=/usr/local/bin/bun app/server.js`;
- `EnvironmentFile=/etc/extract/%i.env`;
- `SOCKET_PATH=/run/extract-%i/server.sock`;
- `RuntimeDirectory=extract-%i`, mode `0750`, with `UMask=0007`;
- the existing restart, graceful shutdown, logging, and hardening settings.

The current uncommitted `current-%i` and `shared/tmp/sockets` experiment is
discarded as explicitly approved. No Capistrano files or hooks are added.

## Documentation

Rewrite README as Node/Bun-only documentation:

- Node 26/npm installation and tests;
- optional Bun test/runtime command;
- development startup through `app/server.js`;
- users YAML, authentication, and API request construction;
- the renamed systemd template, sockets, environment example, and blue/green
  operational sequence.

Remove all Ruby, Sinatra, Puma, Bundler, Foreman, split-parser, and comparison
instructions. Replace the Ruby signing example with a Node example using
`node:crypto` and `Buffer`.

Delete all existing comparison-era Superpowers plans/specs. This design and
its implementation plan become the repository's current design record.

## Verification

The completion gate is:

```bash
npm test
npm run test:bun
git diff --check
```

Both runtime suites must pass with the same test count. A repository-wide
search must find no active Ruby files, Ruby tooling, old split-parser paths,
`standalone` filenames, or `extract-standalone` service references. Historical
terms inside Git history are outside the working-tree check.
