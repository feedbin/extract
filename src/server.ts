import app from "./app";

const port = parseInt(process.env.PORT || "8080", 10);

const server = app.listen(port, () => {
  console.log(`Extract started on port ${port}`);
});

process.on("SIGINT", () => {
  server.close((error?: Error) => {
    console.error("SIGINT received, shutting down");
    if (error) {
      console.error(error);
      process.exit(1);
    }
  });
});
