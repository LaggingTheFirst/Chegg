module.exports = {
    apps: [
        {
            name: 'chegg-server',
            script: 'server/index.js',
            watch: false,
			env: {
                PORT: 443
            }
        },
        {
            name: 'chegg-bot',
            script: 'server/discord-bot.js',
            watch: false
        }
    ]
};
