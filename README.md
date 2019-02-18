Extract
=======

Extract just the content from a web page.

Extract is a wrapper to turn the [Mercury Parser](https://github.com/postlight/mercury-parser) into a web service.

Why?
----

Mercury already offers an [API component](https://github.com/postlight/mercury-parser-api) meant to be deployed to AWS Lambda. There are a few reasons why this exists as an alternative.

1. Deploy elsewhere. Extract is a vanilla express-js node app that is easy to run in a VM and has no platform specific dependencies.
2. Built-in authorization system.

Installation
------------

1. Install [Node.js](https://nodejs.org/en/) and [npm](https://www.npmjs.com/).

2. Clone extract

    ```bash
    git clone https://github.com/feedbin/extract.git
    ```

3. Install the dependencies.

  ```bash
  cd extract
  npm install
  ```

4. Run the server

  ```bash
  node app/app.js
  ```

  extract also include an `ecosystem.config.js` to use with [pm2](https://github.com/Unitech/pm2)

  ```bash
  npm install -g pm2
  pm2 start ecosystem.config.js
  ```

Usage
-----

Extract has a simple directory structure for creating users and secret keys. To make a new user run the following:

```
cd extract
mkdir users
echo "PASSWORD" > users/USERNAME
```

Once a username and password is created you can make a request.

An example request looks like:

```
http://localhost:3000/parser/:username/:signature?base64_url=:base64_url
```

The parts that you need are:

- `username` your username
- `signature` the hexadecimal HMAC-SHA1 signature of the URL you want to parse
- `base64_url` base64 encoded version of the URL you want to parse

The URL is base64-encoded to avoid any issues in the way different systems encode URLs. It must use the [RFC 4648](https://tools.ietf.org/html/rfc4648#section-5) url-safe variant with no newlines.

If your platform does not offer a URL safe base64 option, you can replicate it. First create the base64 encoded string. Then replace the following characters:

- `+` => `-`
- `/` => `_`
- `\n` => ""

Here's a sample implementation in ruby. You can use this as a reference for matching your implementation.

```ruby
require "uri"
require "openssl"
require "base64"

username = "username"
secret = "secret"
host = "localhost"
port = 3000
url = "https://feedbin.com/blog/2018/09/11/private-by-default/"

digest = OpenSSL::Digest.new("sha1")
signature = OpenSSL::HMAC.hexdigest(digest, secret, url)

base64_url = Base64.urlsafe_encode64(url).gsub("\n", "")

URI::HTTPS.build({
  host: "localhost",
  port: 3000,
  path: "/parser/#{username}/#{signature}",
  query: "base64_url=#{base64_url}"
}).to_s
```

The above example would produce:

```
https://localhost:3000/parser/username/e4696f8630bb68c21d77a9629ce8d063d8e5f81c?base64_url=aHR0cHM6Ly9mZWVkYmluLmNvbS9ibG9nLzIwMTgvMDkvMTEvcHJpdmF0ZS1ieS1kZWZhdWx0Lw==
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
