require "webmock/minitest"
require_relative "test_helper"

class AppTest < Test

  def test_health_check
    get "/health_check"
    assert_equal 200, last_response.status
    assert_equal "OK", last_response.body
  end

  def test_parser_with_valid_signature
    user = "testuser"
    url = "https://example.com"
    base64_url = Base64.urlsafe_encode64(url)
    key = "secret-key"
    signature = OpenSSL::HMAC.hexdigest("sha1", key, url)
    title = "The Title"

    Dir.mktmpdir do |dir|
      users_dir = File.join(dir, "users")
      Dir.mkdir(users_dir)
      File.write(File.join(users_dir, user), key)

      Dir.chdir(dir) do
        stub_request(:get, url)
          .to_return(
            status: 200,
            body: "<title>#{title}</title>",
            headers: {"Content-Type" => "text/html"}
          )

        get "/parser/#{user}/#{signature}?base64_url=#{base64_url}"

        assert_equal 200, last_response.status
        assert_equal "application/json; charset=utf-8", last_response.content_type
        assert_equal title, JSON.load(last_response.body).fetch("title")
      end
    end
  end

  def test_parser_with_invalid_signature
    user = "testuser"
    url = "https://example.com"
    base64_url = Base64.urlsafe_encode64(url)
    invalid_signature = "invalid"

    Dir.mktmpdir do |dir|
      users_dir = File.join(dir, "users")
      Dir.mkdir(users_dir)
      File.write(File.join(users_dir, user), "secret-key")

      Dir.chdir(dir) do
        get "/parser/#{user}/#{invalid_signature}?base64_url=#{base64_url}"

        assert_equal 400, last_response.status
        assert_equal "application/json", last_response.content_type

        body = JSON.parse(last_response.body)
        assert_equal true, body["error"]
        assert_equal "Invalid signature.", body["messages"]
      end
    end
  end
end