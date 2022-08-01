const app = require("./app");
const serverPort = process.env.PORT || 3000;
const server = app.listen(serverPort, () => {
    console.log(`Extract started on port ${serverPort}`);
});

process.on("SIGINT", () => {
    if (process.env.NODE_ENV === "production") {
        server.close(function (error) {
            console.error("SIGINT received, shutting down");
            if (error) {
                console.error(err);
                process.exit(1);
            }
        });
    } else {
        process.exit(0);
    }
});
