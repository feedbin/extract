USERS = Tempfile.new
USERS.write("user=key")
USERS.close

ENV["RACK_ENV"] = "test"
ENV["EXTRACT_USERS"] = USERS.path

require "minitest/autorun"
require "webmock/minitest"
require "rack/test"
require "json"
require "tmpdir"
require "open3"
require "net/http"

require_relative "test_server"
require_relative "../app/app.rb"

WebMock.disable_net_connect!(allow_localhost: true)

NODE_SERVER = TestServer.new
NODE_SERVER.start

Minitest.after_run do
  USERS.close
  USERS.unlink
  NODE_SERVER.stop
end

class Test < Minitest::Test
  include Rack::Test::Methods

  def setup
    @user, @key = File.read(USERS).split("=", 2)
  end

  def app
    Sinatra::Application
  end
end
