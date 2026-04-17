module.exports = {
    apps: [
        {
            name: 'chegg-server',
            script: 'server/index.js',
            watch: false
        },
        {
            name: 'chegg-bot',
            script: 'server/discord-bot.js',
            watch: false
        }
    ]
};
