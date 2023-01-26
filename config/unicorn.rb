require "etc"

working_directory File.expand_path("..", __dir__)

shared_directory = File.join(File.expand_path("..", ENV["PWD"]), "shared")
shared_directory = File.directory?(shared_directory) ? shared_directory : ENV["PWD"]

pid               File.join(shared_directory, "tmp", "unicorn.pid")
listen            File.join(shared_directory, "tmp", "unicorn.sock")
logger            Logger.new($stdout)
worker_processes  ENV.fetch("WEB_CONCURRENCY", Etc.nprocessors).to_i

before_fork do |server, worker|
  old_pid = "#{server.config[:pid]}.oldbin"
  if old_pid != server.pid
    begin
      sig = (worker.nr + 1) >= server.worker_processes ? :QUIT : :TTOU
      Process.kill(sig, File.read(old_pid).to_i)
    rescue Errno::ENOENT, Errno::ESRCH
    end
  end
end
