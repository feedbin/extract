import express, { Request, Response, NextFunction } from "express";
// @ts-ignore: Missing types for @postlight/parser
import { parse } from "@postlight/parser";
import { Validator } from "./validator";
import { log } from "./logger";

const app = express();

function decodeURL(encodedURL: string): string {
  return Buffer.from(encodedURL, "base64").toString("utf-8");
}

interface Params {
  user: string;
  signature: string;
  url: string;
}

function getParams(request: Request): Params {
  const user = request.params.user;
  const signature = request.params.signature;
  const base64url = (request.query.base64_url as string).replace(/ /g, "+");
  const url = decodeURL(base64url);
  return { user, signature, url };
}

function errorHandler(
  request: Request,
  response: Response,
  next: NextFunction,
  error: Error,
  message: string,
): void {
  log(request, message);
  response.status(400).json({
    error: true,
    messages: message,
  });
  next(error);
}

app.get("/health_check", (request: Request, response: Response) => {
  log(request);
  response.send("200 OK");
});

app.get(
  "/parser/:user/:signature",
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { user, signature, url } = getParams(request);

      try {
        const auth = new Validator(user, url, signature);
        await auth.validate();
      } catch (error: any) {
        errorHandler(request, response, next, error, error.message);
        return;
      }

      try {
        const result = await parse(url);
        const code = "error" in result ? 400 : 200;
        log(request);
        response.status(code).send(result);
      } catch (error: any) {
        errorHandler(
          request,
          response,
          next,
          error,
          "Cannot extract this URL.",
        );
        return;
      }
    } catch (error: any) {
      errorHandler(
        request,
        response,
        next,
        error,
        "Invalid request. Missing base64_url parameter.",
      );
      return;
    }
  },
);

export default app;
