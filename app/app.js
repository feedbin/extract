const express = require("express");
const app = express();
const mercury = require("@postlight/mercury-parser");
const validator = require("./validator");

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

app.get("/health_check", (request, response) => {
    response.send("200 OK");
});

app.get("/parser/:user/:signature", (request, response, next) => {
    try {
        const {user, signature, url} = getParams(request);
        new validator(user, url, signature).validate().then(result => {
            mercury.parse(url).then(result => {
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

module.exports = app