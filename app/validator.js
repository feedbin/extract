const hmac = require("crypto-js/hmac-sha1")
const fs = require("fs")
const path = require("path")

class Validator {
    constructor(user, data, signature) {
        this.user = user
        this.data = data
        this.signature = signature
    }

    async validate() {
        let key
        try {
            key = await this.key()
        } catch (e) {
            throw Error(`User does not exist: ${this.user}.`)
        }

        if (this.calculateSignature(key) !== this.signature) {
            throw Error(`Invalid signature.`)
        }
    }

    async key() {
        return new Promise((resolve, reject) => {
            const filepath = path.normalize(path.join(__dirname, "..", "users", this.user))
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
        return hmac(this.data, key).toString()
    }
}

module.exports = Validator