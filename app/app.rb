# frozen_string_literal: true

require "sinatra"
require "http"
require "openssl"
require "base64"
require "connection_pool"

set :protection, except: [:json_csrf]

$parser = ConnectionPool.new(size: 1, timeout: 5) {
  HTTP.persistent(ENV["PARSER_URL"])
}

def signature_valid?(user, signature, data)
  path = File.expand_path(File.join("..", "users", user), __dir__)
  key = File.read(path).strip
  signature == OpenSSL::HMAC.hexdigest("sha1", key, data)
end

def parse(json)
  $parser.with do |connection|
    connection
      .timeout(connect: 1, write: 5, read: 5)
      .post("/parser", json: json)
  end
end

def halt_with_error(error)
  halt 400, {"Content-Type" => "application/json"}, {
    error: true,
    messages: error
  }.to_json
end

def download_with_http(url)
  response = HTTP
    .follow(max_hops: 5)
    .timeout(connect: 4, write: 4, read: 5)
    .get(url)
  {
    url: url,
    options: {
      html: response.to_s,
      contentType: response.headers[:content_type]
    }
  }
end

get "/health_check" do
  "OK"
end

get "/parser/:user/:signature" do
  url = begin
    Base64.decode64(params["base64_url"])
  rescue NoMethodError
    halt_with_error("Invalid request. Missing base64_url parameter.")
  end

  logger.info "url=#{url}"

  begin
    halt_with_error("Invalid signature.") unless signature_valid?(params["user"], params["signature"], url)
  rescue Errno::ENOENT
    halt_with_error("User does not exist: #{params["user"]}.")
  end

  payload = download_with_http(url)
  response = parse(payload)
  body = response.to_s
  halt_with_error("Cannot extract this URL.") unless response.status.ok?
  headers("Content-Type" => response.headers[:content_type])
  body
rescue => exception
  logger.error "Exception processing exception=#{exception} url=#{url} user=#{params["user"]} "
  logger.error exception.backtrace.join("\n")
  halt_with_error("Cannot extract this URL.")
  raise exception
end
