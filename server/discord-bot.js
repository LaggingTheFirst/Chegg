import { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } from 'discord.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import 'dotenv/config';

const execAsync = promisify(exec);

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const OWNER_ID = process.env.DISCORD_OWNER_ID;
const BASE_URL = process.env.BASE_URL || 'https://chegg.hydrophobicmc.us';
const API = `${BASE_URL}/api`;

if (!DISCORD_TOKEN || !CLIENT_ID || !OWNER_ID) {
    console.error('[BOT] Missing required env vars: DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_OWNER_ID');
    process.exit(1);
}

const commands = [
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check if the game server is running'),

    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Show the top 10 players by ELO'),

    new SlashCommandBuilder()
        .setName('player')
        .setDescription('Look up a player\'s stats')
        .addStringOption(opt => opt.setName('username').setDescription('Player username').setRequired(true)),

    new SlashCommandBuilder()
        .setName('live')
        .setDescription('Show currently active games with spectate links'),

    new SlashCommandBuilder()
        .setName('restart')
        .setDescription('[Admin] Restart the game server'),

    new SlashCommandBuilder()
        .setName('update')
        .setDescription('[Admin] Pull latest changes from GitHub and restart'),

    new SlashCommandBuilder()
        .setName('players')
        .setDescription('[Admin] Show total number of registered players'),

    new SlashCommandBuilder()
        .setName('announce')
        .setDescription('[Admin] Post a server announcement')
        .addStringOption(opt => opt.setName('message').setDescription('Announcement text').setRequired(true)),
].map(cmd => cmd.toJSON());

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

const RANK_COLORS = [0xb87333, 0xaaaaaa, 0xffd700, 0x00cfff, 0x00e676, 0x9c27b0];
function eloToRankColor(elo) {
    if (elo >= 4000) return 0x00e676;
    if (elo >= 2000) return 0x9c27b0;
    if (elo >= 1500) return 0x00cfff;
    if (elo >= 1000) return 0xffd700;
    if (elo >= 600)  return 0xaaaaaa;
    return 0xb87333;
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    // ── Public commands ──────────────────────────────────────────────────────

    if (commandName === 'status') {
        try {
            const res = await fetch(`${API}/leaderboard?limit=1`);
            if (res.ok) {
                await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00e676).setTitle('✅ Server Online').setDescription(`[Play now](${BASE_URL})`)] });
            } else {
                await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xef4444).setTitle('⚠️ Server Issue').setDescription('Server responded with an error.')] });
            }
        } catch {
            await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xef4444).setTitle('❌ Server Offline').setDescription('Could not reach the game server.')] });
        }
        return;
    }

    if (commandName === 'leaderboard') {
        await interaction.deferReply();
        try {
            const res = await fetch(`${API}/leaderboard?limit=10`);
            const data = await res.json();
            if (!data.success) throw new Error(data.error);

            const medals = ['🥇', '🥈', '🥉'];
            const rows = data.players
                .filter(p => !p.isBot)
                .slice(0, 10)
                .map((p, i) => {
                    const medal = medals[i] || `**${i + 1}.**`;
                    const wr = p.games > 0 ? Math.round((p.wins / p.games) * 100) : 0;
                    return `${medal} **${p.username}** — ${p.elo} ELO (${p.wins}W/${p.losses}L, ${wr}% WR)`;
                })
                .join('\n');

            const embed = new EmbedBuilder()
                .setColor(0xffd700)
                .setTitle('🏆 Leaderboard')
                .setDescription(rows || 'No players yet.')
                .setFooter({ text: `${data.total} total players` })
                .setURL(`${BASE_URL}/leaderboard`);

            await interaction.editReply({ embeds: [embed] });
        } catch (err) {
            await interaction.editReply(`Failed to fetch leaderboard: ${err.message}`);
        }
        return;
    }

    if (commandName === 'player') {
        const username = interaction.options.getString('username');
        await interaction.deferReply();
        try {
            const res = await fetch(`${API}/player/${encodeURIComponent(username)}`);
            if (res.status === 404) {
                await interaction.editReply(`Player **${username}** not found.`);
                return;
            }
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            const p = data.player;
            const wr = p.games > 0 ? Math.round((p.wins / p.games) * 100) : 0;

            const embed = new EmbedBuilder()
                .setColor(eloToRankColor(p.elo))
                .setTitle(`👤 ${p.username}`)
                .addFields(
                    { name: 'ELO', value: `${p.elo}`, inline: true },
                    { name: 'Rank', value: `#${p.rank}`, inline: true },
                    { name: 'Record', value: `${p.wins}W / ${p.losses}L`, inline: true },
                    { name: 'Win Rate', value: `${wr}%`, inline: true },
                    { name: 'Games', value: `${p.games}`, inline: true },
                );

            await interaction.editReply({ embeds: [embed] });
        } catch (err) {
            await interaction.editReply(`Failed to fetch player: ${err.message}`);
        }
        return;
    }

    if (commandName === 'live') {
        await interaction.deferReply();
        try {
            const { Level } = await import('level');
            const db = new Level('./db/chegg-games', { valueEncoding: 'json' });

            // Read recent games to find active ones (saved within last 10 minutes)
            const tenMinAgo = Date.now() - 10 * 60 * 1000;
            const active = [];
            for await (const [key, value] of db.iterator()) {
                if (!key.startsWith('game:')) continue;
                const game = typeof value === 'string' ? JSON.parse(value) : value;
                if (game.finalState) continue; // completed
                if (game.lastUpdate && game.lastUpdate > tenMinAgo) {
                    active.push({ roomId: key.substring(5), game });
                }
            }
            await db.close();

            if (active.length === 0) {
                await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🎮 Live Games').setDescription('No active games right now.')] });
                return;
            }

            const rows = active.map(({ roomId, game }) => {
                const state = game.lastState ? (typeof game.lastState === 'string' ? JSON.parse(game.lastState) : game.lastState) : null;
                const blue = state?.metadata?.blue?.username || 'Blue';
                const red = state?.metadata?.red?.username || 'Red';
                const turn = state?.turnNumber || '?';
                return `⚔️ **${blue}** vs **${red}** — Turn ${turn}\n[Spectate](${BASE_URL}/match/${roomId})`;
            }).join('\n\n');

            const embed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle(`🎮 Live Games (${active.length})`)
                .setDescription(rows);

            await interaction.editReply({ embeds: [embed] });
        } catch (err) {
            await interaction.editReply(`Failed to fetch live games: ${err.message}`);
        }
        return;
    }

    // ── Admin commands ───────────────────────────────────────────────────────

    if (!isOwner(interaction)) {
        await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        return;
    }

    if (commandName === 'announce') {
        const message = interaction.options.getString('message');
        const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle('📢 Announcement')
            .setDescription(message)
            .setTimestamp();
        await interaction.reply({ embeds: [embed] });
        return;
    }

    if (commandName === 'restart') {
        await interaction.reply('Restarting server...');
        try {
            const { stdout } = await execAsync('npx pm2 restart chegg-server');
            await interaction.followUp(`Done. \`\`\`\n${stdout.slice(0, 1900)}\n\`\`\``);
        } catch (err) {
            await interaction.followUp(`Restart failed: \`\`\`\n${err.message.slice(0, 1900)}\n\`\`\``);
        }
        return;
    }

    if (commandName === 'update') {
        await interaction.reply('Pulling latest changes from GitHub...');
        try {
            const { stdout: pullOut, stderr: pullErr } = await execAsync('git pull');
            await interaction.followUp(`\`\`\`\n${(pullOut || pullErr || 'No output').slice(0, 1900)}\n\`\`\``);
            await interaction.followUp('Restarting server...');
            const { stdout: restartOut } = await execAsync('npx pm2 restart chegg-server');
            await interaction.followUp(`Done. \`\`\`\n${restartOut.slice(0, 1900)}\n\`\`\``);
        } catch (err) {
            await interaction.followUp(`Failed: \`\`\`\n${err.message.slice(0, 1900)}\n\`\`\``);
        }
        return;
    }

    if (commandName === 'players') {
        try {
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
        return;
    }
});

client.once('clientReady', () => {
    console.log(`[BOT] Logged in as ${client.user.tag}`);
});

client.login(DISCORD_TOKEN);
