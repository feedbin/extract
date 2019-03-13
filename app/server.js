const app = require("./app");
const server = app.listen((process.env.PORT || 3000));

process.on("SIGINT", () => {
    if (process.env.NODE_ENV === "production") {
        server.close(function(error) {
            console.error("SIGINT received, shutting down");
            if (error) {
                console.error(err);
                process.exit(1);
            }
        })
    } else {
        process.exit(0);
    }
})