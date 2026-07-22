Extract
=======

Extract just the content from a web page.

Extract is a wrapper to turn the [Mercury Parser](https://github.com/postlight/parser) into a web service.

Why?
----

Mercury already offers an [API component](https://github.com/postlight/parser-api), meant to be deployed to AWS Lambda. There are a few reasons why this exists as an alternative.

1. Deploy elsewhere. Extract is meant to run in a VM, and has no platform specific dependencies.

2. Built-in authorization system.

3. Performance. In my experience, running it on a VM has been faster than the lambda version.

Here's a graph where you can see a decrease in average response time around the `17. Feb` mark. This is when Feedbin switched from the lambda hosted version, to extract running on a VPS.

![Response Time](https://user-images.githubusercontent.com/133809/53254496-54e85b00-3678-11e9-949a-f61824a4ac96.png)

How it Works
------------

Extract is two processes, defined in the `Procfile`:

- **web**: a Ruby ([Sinatra](https://sinatrarb.com)) app that authenticates requests and downloads the requested page.
- **parser**: a Node.js service that wraps Mercury Parser. The web process sends it downloaded pages over HTTP, using the address in the `PARSER_URL` environment variable.

There is also an experimental standalone version that performs authentication
and parsing in a single Node.js process, using Mercury Parser's built-in
ability to fetch pages:

- **standalone**: `PORT=8889 node app/standalone_server.js`

It uses the same `EXTRACT_USERS` auth as the web process and runs alongside it
on its own port, so the two implementations can be compared on identical
requests, e.g. `http://localhost:8888/parser/...` vs
`http://localhost:8889/parser/...`.

Installation
------------

1. Install [Node.js](https://nodejs.org/en/) and [Ruby](https://www.ruby-lang.org/en/).

2. Clone extract

    ```bash
    git clone https://github.com/feedbin/extract.git
    ```

3. Install the dependencies.

    ```bash
    cd extract
    npm install
    bundle install
    ```

4. Run both processes. With a Procfile runner like [foreman](https://github.com/ddollar/foreman):

    ```bash
    foreman start
    ```

    Or run them separately:

    ```bash
    PORT=3001 node app/server.js
    PARSER_URL=http://127.0.0.1:3001 bundle exec puma --port 8888
    ```

Bun and systemd
---------------

The standalone server can run under Bun. The Node and Bun compatibility suites
exercise the same tests:

```bash
npm test
npm run test:bun
```

`config/systemd/extract-standalone@.service` is a systemd template for
blue/green deployment. It runs as `extract:extract`, starts Bun from
`/usr/local/bin/bun`, and resolves the application through this symlink:

```text
/usr/local/srv/apps/extract/current
```

Create the service account and install the unit:

```bash
sudo useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin extract
sudo install -m 0644 config/systemd/extract-standalone@.service /etc/systemd/system/
sudo install -d -o root -g extract -m 0750 /etc/extract
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/extract-standalone@.service
```

The template instance is the deployment color. Each instance gets a private
runtime directory and Unix socket:

```text
/run/extract-standalone-blue/standalone.sock
/run/extract-standalone-green/standalone.sock
```

Create one environment file per color using
`config/systemd/extract-standalone.env.example` as a starting point:

```text
# /etc/extract/blue.env
EXTRACT_USERS=/etc/extract/users.yml

# /etc/extract/green.env
EXTRACT_USERS=/etc/extract/users.yml
```

Install the users file and keep all configuration readable by the service
account, then enable the instances:

```bash
sudo install -o root -g extract -m 0640 users.yml /etc/extract/users.yml
sudo chown root:extract /etc/extract/blue.env /etc/extract/green.env
sudo chmod 0640 /etc/extract/blue.env /etc/extract/green.env
sudo systemctl enable extract-standalone@blue.service
sudo systemctl enable extract-standalone@green.service
```

The reverse proxy account must be a member of the `extract` group so it can
traverse the runtime directory and connect to the socket.

For a deployment, install dependencies in a versioned release directory and
atomically update `current`. Restart the traffic-inactive color, verify its own
socket, switch traffic in the external proxy or load balancer, and stop the old
color. `restart` also starts an inactive unit when it is stopped and guarantees
that it loads the new `current` release if it was already running:

```bash
sudo ln -sfn /usr/local/srv/apps/extract/releases/RELEASE /usr/local/srv/apps/extract/current.next
sudo mv -Tf /usr/local/srv/apps/extract/current.next /usr/local/srv/apps/extract/current

sudo systemctl restart extract-standalone@green.service
curl --fail --unix-socket /run/extract-standalone-green/standalone.sock http://localhost/health_check

# Switch external traffic to the green socket, then retire blue.
sudo systemctl stop extract-standalone@blue.service
```

For the next deployment, reverse the colors. Follow either instance in the
journal with:

```bash
sudo journalctl --follow --unit extract-standalone@green.service
```

The reverse proxy and its traffic-switching mechanism are intentionally not
managed by this repository.

Usage
-----

Users are defined in a YAML file, where each key is a username and each value is that user's secret key:

```yaml
# users.yml
username: secret
```

Point the `EXTRACT_USERS` environment variable at this file when starting the web process:

```bash
EXTRACT_USERS=users.yml PARSER_URL=http://127.0.0.1:3001 bundle exec puma --port 8888
```

The file is read once at boot, so changes to it require a restart. In
development and the Ruby stack, an unset `EXTRACT_USERS` falls back to a single
user named `demo` with the secret `demo`. The production standalone entry point
requires `EXTRACT_USERS` and refuses to start without it.

Once a username and secret key has been created, you can make a request.

An example request looks like:

```
http://localhost:8888/parser/:username/:signature?base64_url=:base64_url
```

The parts that you need are:

- `username` your username
- `signature` the hexadecimal HMAC-SHA1 signature of the URL you want to parse
- `base64_url` base64 encoded version of the URL you want to parse

The URL is base64-encoded to avoid any issues in the way different systems encode URLs. It must use the [RFC 4648](https://tools.ietf.org/html/rfc4648#section-5) url-safe variant with no newlines.

If your platform does not offer a URL safe base64 option, you can replicate it. First create the base64 encoded string. Then replace the following characters:

- `+` => `-`
- `/` => `_`
- `\n` => `""`

Here's a sample implementation in ruby. You can use this as a reference for matching your implementation.

```ruby
require "uri"
require "openssl"
require "base64"

username = "username"
secret = "secret"
host = "localhost"
port = 8888
url = "https://feedbin.com/blog/2018/09/11/private-by-default/"

digest = OpenSSL::Digest.new("sha1")
signature = OpenSSL::HMAC.hexdigest(digest, secret, url)

base64_url = Base64.urlsafe_encode64(url).gsub("\n", "")

URI::HTTP.build({
  host: host,
  port: port,
  path: "/parser/#{username}/#{signature}",
  query: "base64_url=#{base64_url}"
}).to_s
```

The above example would produce:

```
http://localhost:8888/parser/username/e4696f8630bb68c21d77a9629ce8d063d8e5f81c?base64_url=aHR0cHM6Ly9mZWVkYmluLmNvbS9ibG9nLzIwMTgvMDkvMTEvcHJpdmF0ZS1ieS1kZWZhdWx0Lw==
```

With the output:

```json
{
    "title": "Private by Default",
    "author": null,
    "date_published": "2018-09-11T00:00:00.000Z",
    "dek": null,
    "lead_image_url": "https://assets.feedbin.com/assets-site/blog/2018-09-11/embed-3f43088538ae5ed7e585c00013adc13a915fd35de31990b3081a085b963ed7dd.png",
    "content": "<div>content</div>",
    "next_page_url": null,
    "url": "https://feedbin.com/blog/2018/09/11/private-by-default/",
    "domain": "feedbin.com",
    "excerpt": "September 11, 2018 by Ben Ubois I want Feedbin to be the opposite of Big Social. I think people should have the right not to be tracked on the Internet and Feedbin can help facilitate that. Since&hellip;",
    "word_count": 787,
    "direction": "ltr",
    "total_pages": 1,
    "rendered_pages": 1
}
```
