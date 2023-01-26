require "etc"

app_directory = File.expand_path("..", __dir__)

bind "unix://#{app_directory}/tmp/puma.sock"
pidfile "#{app_directory}/tmp/puma.pid"
state_path "#{app_directory}/tmp/puma.state"

environment ENV.fetch("RACK_ENV", "development")
workers 0
threads_count = ENV.fetch("MAX_THREADS", 24)
threads threads_count, threads_count
