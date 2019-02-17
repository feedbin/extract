module.exports = {
    apps : [{
        name: "extract",
        script: "./app/app.js",
        instances: "max",
        env: {
            NODE_ENV: "development",
        },
        env_production: {
            NODE_ENV: "production",
        }
    }]
}
