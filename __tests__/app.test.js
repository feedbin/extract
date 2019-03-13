const request = require("supertest");
const app = require("../app/app")
const mkdirp = require('mkdirp');
const fs = require('fs');
const path = require("path");
const hmac = require("crypto-js/hmac-sha1");

describe("Test the health check", () => {
    test("It should respond to GET", (done) => {
        request(app).get("/health_check").expect(200).end(done);
    });
});

describe("Test the parser", () => {

    const user = "test"
    const password = "test"
    const url = "http://example.com"
    const signature = hmac(url, password).toString()
    const base64_url = new Buffer.from(url).toString("base64");
    const file = path.normalize(path.join(__dirname, "..", "users"));
    const writeFile = async (dir, path, content) => {
      await mkdirp(dir);
      fs.writeFileSync(path, content);
    }
    writeFile(file, path.join(file, user), password);

    test("It should respond to GET", (done) => {
        request(app).get(`/parser/${user}/${signature}?base64_url=${base64_url}`).expect(200).end(done);
    });

    test("It should fail with invalid user", (done) => {
        request(app).get(`/parser/invalid_user/${signature}?base64_url=${base64_url}`).expect(400, {
            error: true,
            messages: "User does not exist: invalid_user."
        }, done);
    });

    test("It should fail with invalid signature", (done) => {
        request(app).get(`/parser/${user}/invalid_signature?base64_url=${base64_url}`).expect(400, {
            error: true,
            messages: "Invalid signature."
        }, done);
    });

    test("It should fail with missing params", (done) => {
        request(app).get(`/parser/${user}/${signature}`).expect(400, {
            error: true,
            messages: "Invalid request. Missing base64_url parameter."
        }, done);
    });

});