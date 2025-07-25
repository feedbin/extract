# frozen_string_literal: true

require "sinatra"
require "http"
require "openssl"
require "base64"
require "connection_pool"
require "yaml"

set :protection, except: [:json_csrf]

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
    .headers({accept_encoding: "gzip, deflate"})
    .use(:auto_inflate)
    .get(url)

  parser_object(url: url, html: response.to_s)
end

def authenticate(user, signature)
  url = begin
    Base64.urlsafe_decode64(params["base64_url"])
  rescue NoMethodError
    halt_with_error("Invalid request. Missing base64_url parameter.")
  end

  halt_with_error("User does not exist: #{user}.") unless $users.key?(user)
  halt_with_error("Invalid signature.") unless signature_valid?(user, signature, url)

  url
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
