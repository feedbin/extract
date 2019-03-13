const request = require("supertest");
const app = require("../app/app")
const mkdirp = require('mkdirp');
const fs = require('fs');
const path = require("path");
const hmac = require("crypto-js/hmac-sha1");

describe("Test the health check path", () => {
    test("It should respond to GET", (done) => {
        request(app).get("/health_check").then((response) => {
            expect(response.statusCode).toBe(200);
            done();
        });
    });
});

describe("Test the parser path", () => {

    test("It should respond to GET", (done) => {
        const user = "test"
        const password = "test"
        const url = "http://example.com"
        const signature = hmac(url, password).toString()
        const base64_url = new Buffer.from(url).toString("base64");

        const writeFile = async (dir, path, content) => {
          await mkdirp(dir);
          fs.writeFileSync(path, content);
        }

        const file = path.normalize(path.join(__dirname, "..", "users"));
        writeFile(file, path.join(file, user), password);

        request(app).get(`/parser/${user}/${signature}?base64_url=${base64_url}`).then((response) => {
            expect(response.statusCode).toBe(200);
            done();
        });
    });

});