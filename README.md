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

The file is read once at boot, so changes to it require a restart. If `EXTRACT_USERS` is not set, extract falls back to a single development user, username `demo` with the secret key `demo`. Do not rely on the default in production.

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
