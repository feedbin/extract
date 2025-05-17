import { Request } from "express";

export function log(request: Request, extra?: string): void {
  let output = `[${request.ip}] - ${request.method} ${request.url}`;
  if (extra) {
    output = `${output}: ${extra}`;
  }
  console.log(output);
}
