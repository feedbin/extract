ENV["RACK_ENV"] = "test"
ENV["PARSER_URL"] = "http://parser.test"

require "minitest/autorun"
require "webmock/minitest"
require "rack/test"
require "json"
require "tmpdir"
require_relative "../app/app.rb"

class Test < Minitest::Test
  include Rack::Test::Methods

  def app
    Sinatra::Application
  end
end