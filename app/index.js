const Express = require("express");
const App = Express();
const Mercury = require("@postlight/mercury-parser");
const Validator = require('./validator');

function decodeURL(encodedURL) {
    if (!encodedURL) {
        throw new Error("base64_url parameter required");
    }
    return Buffer.from(encodedURL, 'base64').toString("utf-8");
}

function getParams(request) {
    const user = request.params.user;
    const signature = request.params.signature;
    const url = decodeURL(request.query.base64_url);
    return {user, signature, url}
}

App.get("/health_check", (request, response) => {
    response.send("200 OK");
});

App.get("/parser/:user/:signature", (request, response, next) => {
    const {user, signature, url} = getParams(request);
    new Validator(user, url, signature).validate().then(result => {
        Mercury.parse(url).then(result => {
            response.status(("error" in result ? 500 : 200))
            response.send(result);
        }).catch(next);
    }).catch(next);
});

App.listen(process.env.PORT || 3000);
