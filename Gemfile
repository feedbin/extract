source "https://rubygems.org"
git_source(:github) { |name| "https://github.com/#{name}.git" }

gem "dotenv"

gem "librato-metrics", github: "feedbin/librato-metrics",     branch: "feedbin"
gem "librato-rack"

gem "honeybadger"
gem "puma"
gem "rake"
gem "sd_notify"
gem "sinatra"
gem "connection_pool"
gem "http"

group :development do
  gem "irb"
end

group :test do
  gem "minitest"
  gem "webmock"
  gem "rack-test"
end