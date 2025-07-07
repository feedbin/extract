# frozen_string_literal: true

require "sinatra"
require "http"
require "openssl"
require "base64"
require "connection_pool"

if ENV["RACK_ENV"] == "test"
  set :protection, false
else
  set :protection, except: [:json_csrf]
end

$parser = ConnectionPool.new(size: 1, timeout: 5) {
  HTTP.persistent(ENV["PARSER_URL"])
}

def signature_valid?(user, signature, data)
  if ENV["RACK_ENV"] == "test"
    path = File.join("users", user)
  else
    path = File.expand_path(File.join("..", "users", user), __dir__)
  end
  key = File.read(path).strip
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

def parser_object(url:, html:, content_type:)
  {
    url: url,
    options: {
      html: html,
      contentType: content_type
    }
  }
end

def download_with_http(url)
  response = HTTP
    .follow(max_hops: 5)
    .timeout(connect: 4, write: 4, read: 5)
    .headers({accept_encoding: "gzip, deflate"})
    .use(:auto_inflate)
    .get(url)

  parser_object(url: url, html: response.to_s, content_type: response.headers[:content_type])
end

def authenticate(user, signature, url)
  begin
    halt_with_error("Invalid signature.") unless signature_valid?(user, signature, url)
  rescue Errno::ENOENT
    halt_with_error("User does not exist: #{user}.")
  end
end

def response_error!(exception, url, user)
  logger.error "Exception processing exception=#{exception} url=#{url} user=#{user} "
  logger.error exception.backtrace.join("\n")
  halt_with_error("Cannot extract this URL.")
  raise exception
end

get "/health_check" do
  "OK"
end

get "/parser/:user/:signature" do
  url = begin
    Base64.urlsafe_decode64(params["base64_url"])
  rescue NoMethodError
    halt_with_error("Invalid request. Missing base64_url parameter.")
  end

  logger.info "url=#{url}"

  authenticate(params["user"], params["signature"], url)

  payload = download_with_http(url)

  parse_with_mercury(payload)
rescue => exception
  response_error!(exception, url, params["user"])
end

post "/parser/:user/:signature" do
  request.body.rewind
  begin
    json_body = JSON.parse(request.body.read)
  rescue JSON::ParserError
    halt_with_error("Invalid JSON body.")
  end

  url = json_body["url"]
  body = json_body["body"]

  halt_with_error("Missing url field in JSON body.") unless url
  halt_with_error("Missing body field in JSON body.") unless body

  logger.info "url=#{url}"

  authenticate(params["user"], params["signature"], url)

  payload = parser_object(url: url, html: body, content_type: "text/html")

  parse_with_mercury(payload)
rescue => exception
  response_error!(exception, url, params["user"])
end
