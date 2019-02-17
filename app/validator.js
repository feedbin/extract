const HMAC = require("crypto-js/hmac-sha1");
const FS = require('fs');
const Path = require('path');

class Validator {
    constructor(user, data, signature) {
        this.user = user;
        this.data = data;
        this.signature = signature;
    }

    validate() {
        return new Promise((resolve, reject) => {
            const key = this.key().then(key => {
                if (!this.data) {
                    reject(`data required`);
                }
                if (this.calculateSignature(key) !== this.signature) {
                    reject(`invalid signature`);
                }
                resolve();
            }).catch(error => {
                reject(`user does not exist: ${this.user}`);
            });
        });
    }

    key() {
        return new Promise((resolve, reject) => {
            const filePath = Path.normalize(Path.join(__dirname, "..", "users", this.user));
            FS.readFile(filePath, {encoding: 'utf-8'}, (error, data) => {
                if (error) {
                    reject(error)
                } else {
                    resolve(data.trim())
                }
            })
        })
    }

    calculateSignature(key) {
        return HMAC(this.data, key).toString();
    }
}
module.exports = Validator;