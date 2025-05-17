import request from "supertest";
import app from "./app";
import mkdirp from "mkdirp";
import fs from "fs";
import path from "path";
import { calculateSignature } from "./signature";

jest.mock("./logger");

describe("Test the health check", () => {
  test("It should respond to GET", (done) => {
    request(app).get("/health_check").expect(200).end(done);
  });
});

describe("Test the parser", () => {
  const user = "test";
  const password = "test";
  const url = "http://example.com";
  const signature = calculateSignature(password, url);
  const encodedURL = Buffer.from(url).toString("base64");

  beforeEach(() => {
    const file = path.normalize(path.join(__dirname, "..", "users"));
    const writeFile = async (dir: string, path: string, content: string) => {
      await mkdirp(dir);
      fs.writeFileSync(path, content);
    };
    writeFile(file, path.join(file, user), password);
  });

  test("It should respond to GET", (done) => {
    request(app)
      .get(`/parser/${user}/${signature}?base64_url=${encodedURL}`)
      .expect(200)
      .end(done);
  });

  test("It should fail with invalid user", (done) => {
    request(app)
      .get(`/parser/invalid_user/${signature}?base64_url=${encodedURL}`)
      .expect(
        400,
        {
          error: true,
          messages: "User does not exist: invalid_user.",
        },
        done,
      );
  });

  test("It should fail with invalid signature", (done) => {
    request(app)
      .get(`/parser/${user}/invalid_signature?base64_url=${encodedURL}`)
      .expect(
        400,
        {
          error: true,
          messages: "Invalid signature.",
        },
        done,
      );
  });

  test("It should fail with missing params", (done) => {
    request(app).get(`/parser/${user}/${signature}`).expect(
      400,
      {
        error: true,
        messages: "Invalid request. Missing base64_url parameter.",
      },
      done,
    );
  });
});
