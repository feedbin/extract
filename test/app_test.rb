require_relative "test_helper"

class AppTest < Test

  def test_health_check
    get "/health_check"
    assert_equal 200, last_response.status
    assert_equal "OK", last_response.body
  end

  def test_parser_with_valid_signature
    url = "https://example.com"
    base64_url = Base64.urlsafe_encode64(url)
    signature = OpenSSL::HMAC.hexdigest("sha1", @key, url)
    title = "The Title"

    stub_request(:get, url)
      .to_return(
        status: 200,
        body: "<title>#{title}</title>",
        headers: {"Content-Type" => "text/html"}
      )

    get "/parser/#{@user}/#{signature}?base64_url=#{base64_url}"

    assert_equal 200, last_response.status
    assert_equal "application/json; charset=utf-8", last_response.content_type
    assert_equal title, JSON.load(last_response.body).fetch("title")
  end

  def test_parser_with_invalid_signature
    url = "https://example.com"
    base64_url = Base64.urlsafe_encode64(url)
    invalid_signature = "invalid"

    get "/parser/#{@user}/#{invalid_signature}?base64_url=#{base64_url}"

    assert_equal 400, last_response.status
    assert_equal "application/json", last_response.content_type
    assert_equal "Invalid signature.", JSON.parse(last_response.body).fetch("messages")
  end

  def test_post_parser_with_valid_signature
    url = "https://example.com"
    signature = OpenSSL::HMAC.hexdigest("sha1", @key, url)
    title = "The Title"
    html_body = "<title>#{title}</title>"

    post "/parser/#{@user}/#{signature}", {url: url, body: html_body}.to_json, "CONTENT_TYPE" => "application/json"

    assert_equal "application/json; charset=utf-8", last_response.content_type
    assert_equal title, JSON.load(last_response.body).fetch("title")
  end
end