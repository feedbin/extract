import fs from "fs";
import path from "path";
import { calculateSignature } from "./signature";

export class Validator {
  private user: string;
  private data: string;
  private signature: string;

  constructor(user: string, data: string, signature: string) {
    this.user = user;
    this.data = data;
    this.signature = signature;
  }

  async validate(): Promise<void> {
    let key: string;
    try {
      key = await this.key();
    } catch (e) {
      throw new Error(`User does not exist: ${this.user}.`);
    }

    if (calculateSignature(key, this.data) !== this.signature) {
      throw new Error(`Invalid signature.`);
    }
  }

  private async key(): Promise<string> {
    return new Promise((resolve, reject) => {
      const filepath = path.normalize(
        path.join(__dirname, "..", "users", this.user),
      );
      fs.readFile(filepath, { encoding: "utf-8" }, (error, data) => {
        if (error) {
          reject(error);
        } else {
          resolve(data.trim());
        }
      });
    });
  }
}
