class TestServer
  def port
    @port ||= begin
      socket = Socket.new(:INET, :STREAM, 0)
      socket.bind(Addrinfo.tcp("127.0.0.1", 0))
      port = socket.local_address.ip_port
      socket.close
      port.to_s
    end
  end

  def start
    return if @pid

    ENV["PARSER_URL"] = "http://localhost:#{port}"

    @pid = spawn({"PORT" => port}, "node", "app/server.js", out: "/dev/null", err: "/dev/null")

    attempts = 0
    until running?
      sleep 0.1
      attempts += 1
      raise "Node server failed to start" if attempts > 10
    end
  end

  def stop
    return unless @pid

    Process.kill("SIGTERM", @pid)
    Process.wait(@pid)
    @pid = nil
  rescue Errno::ESRCH, Errno::ECHILD
    @pid = nil
  end

  def running?
    response = Net::HTTP.get_response(URI("#{ENV["PARSER_URL"]}/health_check"))
    response.code == "200"
  rescue Errno::ECONNREFUSED, Net::OpenTimeout
    false
  end
end