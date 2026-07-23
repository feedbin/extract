const {test} = require("node:test")
const assert = require("node:assert/strict")
const {once} = require("node:events")
const http = require("node:http")
const createParsePool = require("../app/parse-pool")

test("parse worker does not fetch or aggregate a linked next page", async () => {
    let requests = 0
    const fixtureServer = http.createServer((request, response) => {
        requests++
        response.writeHead(200, {"Content-Type": "text/html"})
        response.end(`
            <html>
                <head><title>Second page</title></head>
                <body><article><p>SECOND_PAGE_SENTINEL</p></article></body>
            </html>
        `)
    })
    fixtureServer.listen(0, "127.0.0.1")
    await once(fixtureServer, "listening")

    const origin = `http://127.0.0.1:${fixtureServer.address().port}`
    const html = `
        <html>
            <head><title>First page</title></head>
            <body>
                <article><p>FIRST_PAGE_SENTINEL ${"first page content ".repeat(30)}</p></article>
                <div class="pagination"><a rel="next" href="${origin}/article/2">Next Page</a></div>
            </body>
        </html>
    `
    const pool = createParsePool({size: 1})

    try {
        const result = await pool.parse(`${origin}/article/1`, html)

        assert.equal(requests, 0)
        assert.match(result.content, /FIRST_PAGE_SENTINEL/)
        assert.doesNotMatch(result.content, /SECOND_PAGE_SENTINEL/)
        assert.equal(result.total_pages, 1)
        assert.equal(result.rendered_pages, 1)
    } finally {
        await pool.close()
        await new Promise((resolve) => fixtureServer.close(resolve))
    }
})
