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
    base64_url = Base64.urlsafe_encode64(url)
    signature = OpenSSL::HMAC.hexdigest("sha1", @key, url)
    title = "The Title"
    html_body = "<title>#{title}</title>"

    post "/parser/#{@user}/#{signature}?base64_url=#{base64_url}", {url: url, body: html_body}.to_json, "CONTENT_TYPE" => "application/json"

    assert_equal title, JSON.load(last_response.body).fetch("title")
    assert_equal "application/json; charset=utf-8", last_response.content_type
  end

  def test_parser_with_missing_base64_url
    get "/parser/#{@user}/whatever"

    assert_equal 400, last_response.status
    assert_equal "Invalid request. Missing base64_url parameter.", JSON.parse(last_response.body).fetch("messages")
  end

  def test_parser_with_invalid_base64_url
    get "/parser/#{@user}/whatever?base64_url=%25%25"

    assert_equal 400, last_response.status
    assert_equal "Invalid request. Invalid base64_url parameter.", JSON.parse(last_response.body).fetch("messages")
  end

  def test_parser_with_meta_charset_page
    url = "https://example.com/meta-charset"
    base64_url = Base64.urlsafe_encode64(url)
    signature = OpenSSL::HMAC.hexdigest("sha1", @key, url)

    stub_request(:get, url)
      .to_return(
        status: 200,
        body: "<html><head><meta charset=\"windows-1252\"><title>Caf\xE9</title></head><body>body</body></html>".b,
        headers: {"Content-Type" => "text/html"}
      )

    get "/parser/#{@user}/#{signature}?base64_url=#{base64_url}"

    assert_equal 200, last_response.status
    assert_equal "Café", JSON.parse(last_response.body).fetch("title")
  end

  def test_parser_with_header_charset_page
    url = "https://example.com/header-charset"
    base64_url = Base64.urlsafe_encode64(url)
    signature = OpenSSL::HMAC.hexdigest("sha1", @key, url)

    stub_request(:get, url)
      .to_return(
        status: 200,
        body: "<title>Caf\xE9</title>".b,
        headers: {"Content-Type" => "text/html; charset=windows-1252"}
      )

    get "/parser/#{@user}/#{signature}?base64_url=#{base64_url}"

    assert_equal 200, last_response.status
    assert_equal "Café", JSON.parse(last_response.body).fetch("title")
  end

  def test_parser_with_undeclared_utf8_page
    url = "https://example.com/undeclared-utf8"
    base64_url = Base64.urlsafe_encode64(url)
    signature = OpenSSL::HMAC.hexdigest("sha1", @key, url)

    stub_request(:get, url)
      .to_return(
        status: 200,
        body: "<title>Café “quoted”</title>".b,
        headers: {"Content-Type" => "text/html"}
      )

    get "/parser/#{@user}/#{signature}?base64_url=#{base64_url}"

    assert_equal 200, last_response.status
    assert_equal "Café “quoted”", JSON.parse(last_response.body).fetch("title")
  end

  def test_parser_with_undeclared_binary_page
    url = "https://example.com/undeclared-binary"
    base64_url = Base64.urlsafe_encode64(url)
    signature = OpenSSL::HMAC.hexdigest("sha1", @key, url)

    stub_request(:get, url)
      .to_return(
        status: 200,
        body: "<title>Caf\xE9</title>".b,
        headers: {"Content-Type" => "text/html"}
      )

    get "/parser/#{@user}/#{signature}?base64_url=#{base64_url}"

    assert_equal 200, last_response.status
    assert_equal "Caf�", JSON.parse(last_response.body).fetch("title")
  end

  def test_parser_reports_final_url_after_redirect
    start_url = "https://example.com/start"
    final_url = "https://example.com/articles/final"
    base64_url = Base64.urlsafe_encode64(start_url)
    signature = OpenSSL::HMAC.hexdigest("sha1", @key, start_url)

    stub_request(:get, start_url)
      .to_return(status: 301, headers: {"Location" => final_url})
    stub_request(:get, final_url)
      .to_return(
        status: 200,
        body: "<title>Moved</title>",
        headers: {"Content-Type" => "text/html"}
      )

    get "/parser/#{@user}/#{signature}?base64_url=#{base64_url}"

    assert_equal 200, last_response.status
    assert_equal "Moved", JSON.parse(last_response.body).fetch("title")
    assert_equal final_url, JSON.parse(last_response.body).fetch("url")
  end

  def test_parser_with_origin_error_status
    url = "https://example.com/error-page"
    base64_url = Base64.urlsafe_encode64(url)
    signature = OpenSSL::HMAC.hexdigest("sha1", @key, url)

    stub_request(:get, url)
      .to_return(
        status: 500,
        body: "<html><title>500 Internal Server Error</title><body>oops</body></html>",
        headers: {"Content-Type" => "text/html"}
      )

    get "/parser/#{@user}/#{signature}?base64_url=#{base64_url}"

    assert_equal 400, last_response.status
    assert_equal "Cannot extract this URL. Origin returned HTTP 500.", JSON.parse(last_response.body).fetch("messages")
  end
end