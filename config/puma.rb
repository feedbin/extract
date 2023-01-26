require "etc"

app_directory = File.expand_path("..", __dir__)
shared_directory = File.join(app_directory, "shared")

bind "unix://#{shared_directory}/tmp/puma.sock"
pidfile "#{shared_directory}/tmp/puma.pid"
state_path "#{shared_directory}/tmp/puma.state"

environment ENV.fetch("RACK_ENV", "development")
workers ENV.fetch("WEB_CONCURRENCY", Etc.nprocessors).to_i
threads_count = ENV.fetch("MAX_THREADS", 24)
threads threads_count, threads_count
