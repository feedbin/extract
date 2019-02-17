const HMAC = require("crypto-js/hmac-sha1");
const FS = require('fs');
const Path = require('path');

class Validator {
    constructor(user, data, theirSignature) {
        this.user = user;
        this.data = data;
        this.theirSignature = theirSignature;
    }

    validate() {
        const key = this._key();
        if (!key) {
            throw new Error(`user does not exist: ${this.user}`);
        }
        if (!this.data) {
            throw new Error("data required");
        }
        if (this._mySignature(key) !== this.theirSignature) {
            throw new Error(`invalid signature`);
        }
        return true;
    }

    _key() {
        let key;
        const filePath = Path.join(__dirname, "users", this.user);
        if (FS.existsSync(filePath)) {
            key = FS.readFileSync(filePath, {encoding: 'utf-8'}).trim();
        }
        return key;
    }

    _mySignature(key) {
        return HMAC(this.data, key).toString();
    }
}
module.exports = Validator;