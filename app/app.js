const Express = require("express");
const App = Express();
const Mercury = require("@postlight/mercury-parser");
const Validator = require("./validator");

function decodeURL(encodedURL) {
    return Buffer.from(encodedURL, "base64").toString("utf-8");
}

function getParams(request) {
    const user = request.params.user;
    const signature = request.params.signature;
    const base64url = request.query.base64_url.replace(/ /g, '+');
    const url = decodeURL(base64url);
    return {user, signature, url}
}

App.get("/health_check", (request, response) => {
    response.send("200 OK");
});

App.get("/parser/:user/:signature", (request, response, next) => {
    try {
        const {user, signature, url} = getParams(request);
        new Validator(user, url, signature).validate().then(result => {
            Mercury.parse(url).then(result => {
                const code = ("error" in result ? 400 : 200);
                response.status(code).send(result);
            }).catch(next);
        }).catch(function(error) {
            response.status(400).json({ error: true, messages: error });
        });
    } catch {
        response.status(400).json({ error: true, messages: "Invalid request. Missing user, signature or url." });
    }
});

const server = App.listen((process.env.PORT || 3000));

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