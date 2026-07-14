require_relative "test_helper"
require "timeout"

class NodeAppTest < Test
  def test_connection_survives_parser_exception
    uri = URI(ENV["PARSER_URL"])

    Timeout.timeout(10) do
      socket = TCPSocket.new(uri.host, uri.port)

      socket.write(http_request(uri.host, "not json", "text/plain"))
      status, = read_http_response(socket)
      assert_includes status, "400"

      sleep 0.2

      payload = {
        url: "https://example.com/",
        options: {html: "<html><head><title>Still Alive</title></head><body><p>Alive.</p></body></html>", contentType: "html"}
      }.to_json
      socket.write(http_request(uri.host, payload, "application/json"))
      status, body = read_http_response(socket)

      assert_includes status, "200"
      assert_equal "Still Alive", JSON.parse(body).fetch("title")
    ensure
      socket&.close
    end
  end

  def test_production_sigterm_shuts_down_gracefully
    socket = Socket.new(:INET, :STREAM, 0)
    socket.bind(Addrinfo.tcp("127.0.0.1", 0))
    port = socket.local_address.ip_port.to_s
    socket.close

    pid = spawn({"PORT" => port, "NODE_ENV" => "production"}, "node", "app/server.js", out: File::NULL, err: File::NULL)

    attempts = 0
    begin
      Net::HTTP.get_response(URI("http://localhost:#{port}/health_check"))
    rescue Errno::ECONNREFUSED, Net::OpenTimeout
      attempts += 1
      raise "Node server failed to start" if attempts > 50
      sleep 0.1
      retry
    end

    idle_connection = Net::HTTP.start("localhost", port.to_i)
    idle_connection.get("/health_check")

    Process.kill("SIGTERM", pid)
    status = Timeout.timeout(5) { Process.wait2(pid).last }

    assert_predicate status, :success?
  ensure
    idle_connection&.finish rescue nil
    if pid
      begin
        Process.kill("KILL", pid)
        Process.wait(pid)
      rescue Errno::ESRCH, Errno::ECHILD
      end
    end
  end

  private

  def http_request(host, body, content_type)
    "POST /parser HTTP/1.1\r\n" \
      "Host: #{host}\r\n" \
      "Content-Type: #{content_type}\r\n" \
      "Content-Length: #{body.bytesize}\r\n" \
      "\r\n" \
      "#{body}"
  end

  def read_http_response(socket)
    status_line = socket.readline
    headers = {}
    while (line = socket.readline.chomp) != ""
      name, value = line.split(": ", 2)
      headers[name.downcase] = value
    end
    body = socket.read(headers.fetch("content-length").to_i)
    [status_line, body]
  end
end
