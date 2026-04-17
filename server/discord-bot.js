import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } from 'discord.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const OWNER_ID = process.env.DISCORD_OWNER_ID; // Only this user can use admin commands

if (!DISCORD_TOKEN || !CLIENT_ID || !OWNER_ID) {
    console.error('[BOT] Missing required env vars: DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_OWNER_ID');
    process.exit(1);
}

const commands = [
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check if the game server is running'),

    new SlashCommandBuilder()
        .setName('restart')
        .setDescription('[Admin] Restart the game server'),

    new SlashCommandBuilder()
        .setName('update')
        .setDescription('[Admin] Pull latest changes from GitHub and restart'),

    new SlashCommandBuilder()
        .setName('players')
        .setDescription('[Admin] Show total number of registered players'),
].map(cmd => cmd.toJSON());

// Register slash commands
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('[BOT] Slash commands registered');
} catch (err) {
    console.error('[BOT] Failed to register commands:', err);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function isOwner(interaction) {
    return interaction.user.id === OWNER_ID;
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // Public command
    if (commandName === 'status') {
        await interaction.reply('Server is online and running.');
        return;
    }

    // All other commands are admin-only
    if (!isOwner(interaction)) {
        await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        return;
    }

    if (commandName === 'restart') {
        await interaction.reply('Restarting server...');
        try {
            // Give Discord time to send the reply before the process exits
            setTimeout(() => {
                console.log('[BOT] Restart triggered via Discord');
                process.exit(0); // PM2 / process manager will restart it
            }, 1000);
        } catch (err) {
            await interaction.followUp(`Restart failed: ${err.message}`);
        }
    }

    if (commandName === 'update') {
        await interaction.reply('Pulling latest changes from GitHub...');
        try {
            const { stdout, stderr } = await execAsync('git pull');
            const output = stdout || stderr || 'No output';
            await interaction.followUp(`\`\`\`\n${output.slice(0, 1900)}\n\`\`\`\nRestarting...`);
            setTimeout(() => {
                console.log('[BOT] Update + restart triggered via Discord');
                process.exit(0);
            }, 1500);
        } catch (err) {
            await interaction.followUp(`Update failed:\n\`\`\`\n${err.message.slice(0, 1900)}\n\`\`\``);
        }
    }

    if (commandName === 'players') {
        try {
            // Dynamically import Level to read the DB
            const { Level } = await import('level');
            const db = new Level('./db/chegg-games', { valueEncoding: 'json' });
            let count = 0;
            for await (const [key] of db.iterator()) {
                if (key.startsWith('user:')) count++;
            }
            await db.close();
            await interaction.reply(`Total registered players: **${count}**`);
        } catch (err) {
            await interaction.reply(`Failed to read player count: ${err.message}`);
        }
    }
});

client.once('clientReady', () => {
    console.log(`[BOT] Logged in as ${client.user.tag}`);
});

client.login(DISCORD_TOKEN);
