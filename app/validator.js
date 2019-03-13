const hmac = require("crypto-js/hmac-sha1");
const fs = require("fs");
const path = require("path");

class Validator {
    constructor(user, data, signature) {
        this.user = user;
        this.data = data;
        this.signature = signature;
    }

    validate() {
        return new Promise((resolve, reject) => {
            const key = this.key().then(key => {
                if (this.calculateSignature(key) !== this.signature) {
                    reject(`Invalid signature.`);
                }
                resolve();
            }).catch(error => {
                reject(`User does not exist: ${this.user}.`);
            });
        });
    }

    key() {
        return new Promise((resolve, reject) => {
            const filepath = path.normalize(path.join(__dirname, "..", "users", this.user));
            fs.readFile(filepath, {encoding: "utf-8"}, (error, data) => {
                if (error) {
                    reject(error)
                } else {
                    resolve(data.trim())
                }
            })
        })
    }

    calculateSignature(key) {
        return hmac(this.data, key).toString();
    }
}

module.exports = Validator;