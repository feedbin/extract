# frozen_string_literal: true

require "sinatra"
require "openssl"
require "posix/spawn"
require "base64"

def signature_valid?(user, signature, data)
  path = File.expand_path(File.join("..", "users", user), __dir__)
  key = File.read(path).strip
  signature == OpenSSL::HMAC.hexdigest("sha1", key, data)
end

def halt_with_error(error)
  halt 400, {"Content-Type" => "application/json"}, {
    error: true,
    messages: error
  }.to_json
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

  result = POSIX::Spawn::Child.new("./node_modules/.bin/postlight-parser", url, timeout: 5)

  if result.status.success?
    content_type :json
    result.out
  else
    raise
  end
rescue => exception
  logger.error "Exception processing exception=#{exception} url=#{url} user=#{params["user"]}"
  halt_with_error("Cannot extract this URL.")
  raise exception
end
