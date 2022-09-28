const express = require("express");
const app = express();
const parser = require("@postlight/parser");
const validator = require("./validator");

function decodeURL(encodedURL) {
    return Buffer.from(encodedURL, "base64").toString("utf-8");
}

function getParams(request) {
    const user = request.params.user;
    const signature = request.params.signature;
    const base64url = request.query.base64_url.replace(/ /g, "+");
    const url = decodeURL(base64url);
    return { user, signature, url };
}

app.get("/health_check", (request, response) => {
    console.log(`[${request.ip}] - ${request.method} ${request.url}`);

    response.send("200 OK");
});

app.get("/parser/:user/:signature", (request, response) => {
    try {
        const { user, signature, url } = getParams(request);
        new validator(user, url, signature)
            .validate()
            .then(() => {
                parser
                    .parse(url)
                    .then((result) => {
                        const code = "error" in result ? 400 : 200;

                        console.log(`[${request.ip}] - ${request.method} ${request.url}`);

                        response.status(code).send(result);
                    })
                    .catch(function () {
                        const errorMessage = "Cannot extract this URL.";
                        console.log(`[${request.ip}] - ${request.method} ${request.url}: ${errorMessage}`);

                        response.status(400).json({ error: true, messages: errorMessage });
                    });
            })
            .catch(function (error) {
                console.log(`[${request.ip}] - ${request.method} ${request.url}: ${error}`);

                response.status(400).json({ error: true, messages: error });
            });
    } catch {
        const errorMessage = "Invalid request. Missing base64_url parameter.";
        console.log(`[${request.ip}] - ${request.method} ${request.url}: ${errorMessage}`);

        response.status(400).json({
            error: true,
            messages: errorMessage
        });
    }
});

module.exports = app;
