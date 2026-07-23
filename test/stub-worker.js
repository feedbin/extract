module.exports = ({url, html}) => {
    if (url === "hang") {
        while (true) {
            // Busy loop until Piscina terminates this worker.
        }
    }
    if (url === "boom") {
        throw new Error("boom")
    }
    return {url, html}
}
