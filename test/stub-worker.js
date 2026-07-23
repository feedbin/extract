module.exports = ({url, html}) => {
    if (url === "hang") {
        while (true) {
            // Busy loop until Piscina terminates this worker.
        }
    }
    return {url, html}
}
