const parser = require("@jocmp/mercury-parser")

module.exports = ({url, html}) => parser.parse(url, {html, fetchAllPages: false})
