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

App.get("/parser/:user/:signature", (request, response) => {
    const user = request.params.user;
    const signature = request.params.signature;
    const url = decodeURL(request.query.base64_url);

    new Validator(user, url, signature).validate();

    Mercury.parse(url).then(result => {
        const { error } = result;
        if (error) {
            response.status(500);
        }
        response.send(result);
    });
});

App.listen(process.env.PORT || 3000);
