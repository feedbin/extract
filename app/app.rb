# frozen_string_literal: true

require "dotenv/load"
require "sinatra"
require "http"
require "openssl"
require "base64"
require "connection_pool"
require "yaml"
require "librato-rack"
require "honeybadger"

set :protection, except: [:json_csrf]

use Librato::Rack
use Honeybadger::Rack::ErrorNotifier

$parser = ConnectionPool.new(size: 1, timeout: 5) {
  HTTP.persistent(ENV["PARSER_URL"])
}

$users = begin
  if ENV["EXTRACT_USERS"]
    YAML.safe_load_file(ENV["EXTRACT_USERS"])
  else
    {"demo" => "demo"}
  end
end


def signature_valid?(user, signature, data)
  key = $users[user]
  return false unless key

  signature == OpenSSL::HMAC.hexdigest("sha1", key, data)
end

def parse_with_mercury(json)
  $parser.with do |connection|
    response = connection
      .timeout(connect: 1, write: 5, read: 5)
      .post("/parser", json: json)

    body = response.to_s
    halt_with_error("Cannot extract this URL.") unless response.status.ok?
    headers("Content-Type" => response.headers[:content_type])
    body
  end
end

def halt_with_error(error)
  halt 400, {"Content-Type" => "application/json"}, {
    error: true,
    messages: error
  }.to_json
end

def parser_object(url:, html:)
  {
    url: url,
    options: {
      html: html,
      contentType: "html"
    }
  }
end

def download_with_http(url)
  response = HTTP
    .follow(max_hops: 5)
    .timeout(connect: 4, write: 4, read: 5)
    .headers({accept_encoding: "gzip, deflate", user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"})
    .use(:auto_inflate)
    .get(url)

  unless response.status.success?
    halt_with_error("Cannot extract this URL. Origin returned HTTP #{response.status.code}.")
  end

  # Redirects can land on a different URL than requested. The parser needs the
  # final one so relative links in the document resolve against the right base.
  parser_object(url: response.uri.to_s, html: normalize_to_utf8(response.to_s, response.charset))
end

def find_encoding(name)
  return unless name
  Encoding.find(name)
rescue ArgumentError
  nil
end

# The charset of a page served without one in the Content-Type header is only
# discoverable from the document itself, per the HTML spec via a <meta> tag in
# the first 1024 bytes.
def detect_meta_encoding(html)
  head = html.byteslice(0, 2048)
  return unless (match = head.match(/<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_\-]+)/i))
  find_encoding(match[1])
end

# The parser payload is JSON, which can only carry valid UTF-8, so anything
# else has to be transcoded before it goes on the wire.
def normalize_to_utf8(html, declared_charset)
  html = +html
  if html.encoding == Encoding::BINARY
    html.force_encoding(find_encoding(declared_charset) || detect_meta_encoding(html) || Encoding::UTF_8)
  end

  if html.encoding == Encoding::UTF_8
    html.scrub
  else
    html.encode(Encoding::UTF_8, invalid: :replace, undef: :replace)
  end
rescue Encoding::ConverterNotFoundError
  html.force_encoding(Encoding::UTF_8).scrub
end

def authenticate(user, signature)
  halt_with_error("Invalid request. Missing base64_url parameter.") unless params["base64_url"]

  url = begin
    Base64.urlsafe_decode64(params["base64_url"])
  rescue ArgumentError
    halt_with_error("Invalid request. Invalid base64_url parameter.")
  end

  halt_with_error("User does not exist: #{user}.") unless $users.key?(user)
  halt_with_error("Invalid signature.") unless signature_valid?(user, signature, url)

  url
end

def response_error!(exception, url, user)
  logger.error "Exception processing exception=#{exception} url=#{url} user=#{user} "
  logger.error exception.backtrace.join("\n")
  halt_with_error("Cannot extract this URL.")
end

get "/env" do
  ENV.inspect
end

get "/health_check" do
  "OK"
end

get "/parser/:user/:signature" do
  url = authenticate(params["user"], params["signature"])
  logger.info "url=#{url}"
  payload = download_with_http(url)
  parse_with_mercury(payload)
rescue => exception
  response_error!(exception, url, params["user"])
end

post "/parser/:user/:signature" do
  url = authenticate(params["user"], params["signature"])

  json = begin
    JSON.parse(request.body.read)
  rescue JSON::ParserError
    halt_with_error("Invalid JSON body.")
  end

  halt_with_error("Missing body field in JSON body.") unless json["body"]
  logger.info "url=#{url}"
  payload = parser_object(url: url, html: json["body"])
  parse_with_mercury(payload)
rescue => exception
  response_error!(exception, url, params["user"])
end
