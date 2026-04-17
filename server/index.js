import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { Level } from 'level';
import { RoomManager } from './RoomManager.js';
import { TournamentManager } from './TournamentManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const PORT = process.env.PORT || 1109;
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'admin123').replace(/^["']|["']$/g, '');

const db = new Level('./db/chegg-games', { valueEncoding: 'json' });

const adminTokens = new Set();

const rateLimitStore = new Map();

function rateLimit(options = {}) {
    const windowMs = options.windowMs || 60000;
    const max = options.max || 10;
    const message = options.message || 'Too many requests, please try again later';

    return (req, res, next) => {
        const key = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        
        if (!rateLimitStore.has(key)) {
            rateLimitStore.set(key, []);
        }
        
        const requests = rateLimitStore.get(key);
        const recentRequests = requests.filter(time => now - time < windowMs);
        
        if (recentRequests.length >= max) {
            return res.status(429).json({ 
                success: false, 
                error: message,
                retryAfter: Math.ceil((recentRequests[0] + windowMs - now) / 1000)
            });
        }
        
        recentRequests.push(now);
        rateLimitStore.set(key, recentRequests);
        
        next();
    };
}

setInterval(() => {
    const now = Date.now();
    for (const [key, requests] of rateLimitStore.entries()) {
        const recentRequests = requests.filter(time => now - time < 3600000);
        if (recentRequests.length === 0) {
            rateLimitStore.delete(key);
        } else {
            rateLimitStore.set(key, recentRequests);
        }
    }
}, 300000);

function generateToken() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function calculateEloMatchup(ratingA, ratingB, scoreA, kFactor = 32) {
    const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
    const newRatingA = Math.round(ratingA + kFactor * (scoreA - expectedA));
    const diff = newRatingA - ratingA;
    return { newRating: newRatingA, diff };
}

function verifyAdminToken(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'No authorization token provided' });
    }
    
    const token = authHeader.substring(7);
    
    if (!adminTokens.has(token)) {
        return res.status(403).json({ success: false, error: 'Invalid or expired token' });
    }
    
    next();
}

app.use(express.json());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.post('/api/admin/auth', rateLimit({ max: 10, windowMs: 60000, message: 'Too many login attempts' }), (req, res) => {
    const { password } = req.body;
    
    console.log('[ADMIN AUTH] Attempt with password:', password);
    console.log('[ADMIN AUTH] Expected password:', ADMIN_PASSWORD);
    console.log('[ADMIN AUTH] Match:', password === ADMIN_PASSWORD);
    
    if (password === ADMIN_PASSWORD) {
        const token = generateToken();
        adminTokens.add(token);
        
        setTimeout(() => {
            adminTokens.delete(token);
        }, 24 * 60 * 60 * 1000);
        
        console.log('[ADMIN AUTH] Success - token generated');
        
        res.json({
            success: true,
            token,
            message: 'Authentication successful'
        });
    } else {
        console.log('[ADMIN AUTH] Failed - invalid password');
        res.status(401).json({
            success: false,
            error: 'Invalid password'
        });
    }
});

app.get('/api/leaderboard', rateLimit({ max: 30, windowMs: 60000 }), async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const search = req.query.search || '';
        
        const allPlayers = [];
        
        for await (const [key, value] of db.iterator()) {
            if (key.startsWith('user:')) {
                const username = key.substring(5);
                const profile = typeof value === 'string' ? JSON.parse(value) : value;
                
                allPlayers.push({
                    username,
                    elo: profile.elo || 1200,
                    wins: profile.wins || 0,
                    losses: profile.losses || 0,
                    games: (profile.wins || 0) + (profile.losses || 0),
                    isBot: !!profile.isBot
                });
            }
        }
        
        allPlayers.sort((a, b) => b.elo - a.elo);
        
        const rankedPlayers = allPlayers.map((player, index) => ({
            ...player,
            rank: index + 1
        }));
        
        const filteredPlayers = search 
            ? rankedPlayers.filter(p => p.username.toLowerCase().includes(search.toLowerCase()))
            : rankedPlayers;
        
        const result = filteredPlayers.slice(0, limit);
        
        res.json({
            success: true,
            players: result,
            total: allPlayers.length,
            filtered: filteredPlayers.length
        });
    } catch (err) {
        console.error('Leaderboard error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch leaderboard' });
    }
});

app.get('/api/player/:username', rateLimit({ max: 60, windowMs: 60000 }), async (req, res) => {
    try {
        const username = req.params.username;
        const profile = await db.get(`user:${username}`);
        const data = typeof profile === 'string' ? JSON.parse(profile) : profile;
        
        const allPlayers = [];
        for await (const [key, value] of db.iterator()) {
            if (key.startsWith('user:')) {
                const p = typeof value === 'string' ? JSON.parse(value) : value;
                allPlayers.push({ elo: p.elo || 1200 });
            }
        }
        
        allPlayers.sort((a, b) => b.elo - a.elo);
        const rank = allPlayers.findIndex(p => p.elo <= (data.elo || 1200)) + 1;
        
        res.json({
            success: true,
            player: {
                username,
                elo: data.elo || 1200,
                wins: data.wins || 0,
                losses: data.losses || 0,
                games: (data.wins || 0) + (data.losses || 0),
                rank
            }
        });
    } catch (err) {
        if (err.code === 'LEVEL_NOT_FOUND') {
            res.status(404).json({ success: false, error: 'Player not found' });
        } else {
            console.error('Player lookup error:', err);
            res.status(500).json({ success: false, error: 'Failed to fetch player' });
        }
    }
});

app.get('/api/player/:username/matches', rateLimit({ max: 60, windowMs: 60000 }), async (req, res) => {
    try {
        const username = req.params.username;
        const limit = parseInt(req.query.limit) || 20;
        
        const matches = [];
        
        for await (const [key, value] of db.iterator()) {
            if (key.startsWith('game:')) {
                const game = typeof value === 'string' ? JSON.parse(value) : value;
                
                if (!game.finalState) continue;
                
                const state = typeof game.finalState === 'string' ? JSON.parse(game.finalState) : game.finalState;
                const metadata = state.metadata || {};
                
                const bluePlayer = metadata.blue?.username;
                const redPlayer = metadata.red?.username;
                
                if (bluePlayer === username || redPlayer === username) {
                    const playerColor = bluePlayer === username ? 'blue' : 'red';
                    const opponentColor = playerColor === 'blue' ? 'red' : 'blue';
                    const opponent = playerColor === 'blue' ? redPlayer : bluePlayer;
                    const result = game.winner === playerColor ? 'win' : 'loss';
                    
                    matches.push({
                        id: game.id,
                        opponent: opponent || 'Unknown',
                        result,
                        turns: game.turns || 0,
                        timestamp: game.timestamp || 0,
                        playerColor
                    });
                }
            }
        }
        
        matches.sort((a, b) => b.timestamp - a.timestamp);
        const limitedMatches = matches.slice(0, limit);
        
        res.json({
            success: true,
            matches: limitedMatches,
            total: matches.length
        });
    } catch (err) {
        console.error('Match history error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch match history' });
    }
});

app.post('/api/player/:username/ai-win', rateLimit({ max: 10, windowMs: 60000 }), async (req, res) => {
    try {
        const username = req.params.username;
        const { winner, token } = req.body; // winner can be 'player' or 'ai'
        const botName = '[Bot] Chegg AI';
        
        // Load player
        const profileStr = await db.get(`user:${username}`);
        const playerData = typeof profileStr === 'string' ? JSON.parse(profileStr) : profileStr;
        
        if (token && playerData.token !== token) {
             return res.status(401).json({ success: false, error: 'Invalid token' });
        }

        // Load bot
        let botData;
        try {
            const botStr = await db.get(`user:${botName}`);
            botData = typeof botStr === 'string' ? JSON.parse(botStr) : botStr;
        } catch (e) {
            botData = { username: botName, elo: 800, wins: 0, losses: 0, isBot: true };
        }

        const score = (winner === 'player') ? 1 : 0;
        const playerEloChange = calculateEloMatchup(playerData.elo || 1200, botData.elo || 800, score);
        const botEloChange = calculateEloMatchup(botData.elo || 800, botData.elo || 1200, 1 - score);

        playerData.elo = playerEloChange.newRating;
        if (score === 1) playerData.wins = (playerData.wins || 0) + 1;
        else playerData.losses = (playerData.losses || 0) + 1;

        botData.elo = botEloChange.newRating;
        if (score === 0) botData.wins = (botData.wins || 0) + 1;
        else botData.losses = (botData.losses || 0) + 1;

        await db.put(`user:${username}`, playerData);
        await db.put(`user:${botName}`, botData);

        console.log(`[ELO] ${username} vs ${botName}. Winner: ${winner}. New Elos: ${playerData.elo} / ${botData.elo}`);

        res.json({
            success: true,
            newElo: playerData.elo,
            diff: playerEloChange.diff,
            botElo: botData.elo
        });
    } catch (err) {
        if (err.code === 'LEVEL_NOT_FOUND') {
            res.status(404).json({ success: false, error: 'Player not found' });
        } else {
            console.error('AI win/loss error:', err);
            res.status(500).json({ success: false, error: 'Failed to record game result' });
        }
    }
});

app.get('/api/admin/players', verifyAdminToken, async (req, res) => {
    try {
        const allPlayers = [];
        const allKeys = [];
        
        for await (const [key, value] of db.iterator()) {
            allKeys.push({ key, value });
            if (key.startsWith('user:')) {
                const username = key.substring(5);
                const profile = typeof value === 'string' ? JSON.parse(value) : value;
                
                allPlayers.push({
                    username,
                    elo: profile.elo || 1200,
                    wins: profile.wins || 0,
                    losses: profile.losses || 0
                });
            }
        }
        
        console.log('[ADMIN] All DB keys:', allKeys.length);
        console.log('[ADMIN] Player keys:', allPlayers.length);
        
        allPlayers.sort((a, b) => a.username.localeCompare(b.username));
        
        res.json({
            success: true,
            players: allPlayers
        });
    } catch (err) {
        console.error('Admin players error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch players' });
    }
});

app.post('/api/admin/player', verifyAdminToken, rateLimit({ max: 30, windowMs: 60000, message: 'Too many player creation requests' }), async (req, res) => {
    try {
        const { username, elo, wins, losses, force } = req.body;
        
        console.log('[ADMIN] Create player request:', { username, elo, wins, losses, force });
        
        if (!username) {
            return res.status(400).json({ success: false, error: 'Username is required' });
        }
        
        const key = `user:${username}`;
        console.log('[ADMIN] Checking key:', key);
        
        if (!force) {
            try {
                const existing = await db.get(key);
                console.log('[ADMIN] db.get result:', existing, 'Type:', typeof existing);
                
                if (existing !== undefined && existing !== null) {
                    console.log('[ADMIN] Player already exists:', username, 'Value:', existing);
                    return res.status(400).json({ 
                        success: false, 
                        error: `Player "${username}" already exists. Use edit instead or delete first.` 
                    });
                }
                
                console.log('[ADMIN] Player value is undefined/null, treating as not found');
            } catch (err) {
                console.log('[ADMIN] Error checking player:', err.code, err.message);
                if (err.code !== 'LEVEL_NOT_FOUND') {
                    console.error('[ADMIN] Unexpected error checking player:', err);
                    throw err;
                }
            }
            
            console.log('[ADMIN] Player does not exist, creating:', username);
        }
        
        const profile = {
            elo: elo || 1200,
            wins: wins || 0,
            losses: losses || 0
        };
        
        console.log('[ADMIN] Writing to key:', key, 'Value:', profile);
        await db.put(key, profile);
        console.log('[ADMIN] Player created successfully:', username);
        
        const verify = await db.get(key);
        console.log('[ADMIN] Verification read:', verify);
        
        res.json({
            success: true,
            player: { username, ...profile }
        });
    } catch (err) {
        console.error('[ADMIN] Create player error:', err);
        res.status(500).json({ success: false, error: 'Failed to create player: ' + err.message });
    }
});

app.put('/api/admin/player/:username', verifyAdminToken, rateLimit({ max: 30, windowMs: 60000, message: 'Too many update requests' }), async (req, res) => {
    try {
        const username = req.params.username;
        const { elo, wins, losses } = req.body;
        
        const profile = await db.get(`user:${username}`);
        const data = typeof profile === 'string' ? JSON.parse(profile) : profile;
        
        data.elo = elo !== undefined ? elo : data.elo;
        data.wins = wins !== undefined ? wins : data.wins;
        data.losses = losses !== undefined ? losses : data.losses;
        
        await db.put(`user:${username}`, data);
        
        res.json({
            success: true,
            player: { username, ...data }
        });
    } catch (err) {
        if (err.code === 'LEVEL_NOT_FOUND') {
            res.status(404).json({ success: false, error: 'Player not found' });
        } else {
            console.error('Update player error:', err);
            res.status(500).json({ success: false, error: 'Failed to update player' });
        }
    }
});

app.delete('/api/admin/player/:username', verifyAdminToken, rateLimit({ max: 30, windowMs: 60000, message: 'Too many delete requests' }), async (req, res) => {
    try {
        const username = req.params.username;
        
        await db.get(`user:${username}`);
        await db.del(`user:${username}`);
        
        res.json({
            success: true,
            message: 'Player deleted successfully'
        });
    } catch (err) {
        if (err.code === 'LEVEL_NOT_FOUND') {
            res.status(404).json({ success: false, error: 'Player not found' });
        } else {
            console.error('Delete player error:', err);
            res.status(500).json({ success: false, error: 'Failed to delete player' });
        }
    }
});

app.delete('/api/admin/clear-all', verifyAdminToken, rateLimit({ max: 5, windowMs: 300000, message: 'Clear all can only be used twice per 5 minutes' }), async (req, res) => {
    try {
        console.log('[ADMIN] Clearing all player data...');
        
        const keysToDelete = [];
        for await (const [key] of db.iterator()) {
            console.log('[ADMIN] Found key:', key, 'Type:', typeof key);
            if (key.startsWith('user:')) {
                keysToDelete.push(key);
            }
        }
        
        for (const key of keysToDelete) {
            await db.del(key);
        }
        
        console.log('[ADMIN] Deleted', keysToDelete.length, 'players');
        
        res.json({
            success: true,
            message: `Deleted ${keysToDelete.length} players`,
            count: keysToDelete.length
        });
    } catch (err) {
        console.error('[ADMIN] Clear all error:', err);
        res.status(500).json({ success: false, error: 'Failed to clear data' });
    }
});

app.get('/api/admin/debug-keys', verifyAdminToken, async (req, res) => {
    try {
        const allKeys = [];
        
        for await (const [key, value] of db.iterator()) {
            allKeys.push({
                key,
                keyType: typeof key,
                value,
                valueType: typeof value
            });
        }
        
        res.json({
            success: true,
            keys: allKeys,
            count: allKeys.length
        });
    } catch (err) {
        console.error('[ADMIN] Debug keys error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch keys' });
    }
});

app.use(express.static(path.join(__dirname, '../')));

app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, '../profile.html'));
});

app.get('/leaderboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../leaderboard.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../admin.html'));
});

// Tournament endpoints (admin-only creation)
app.post('/api/tournament/create', verifyAdminToken, rateLimit({ max: 30, windowMs: 60000 }), (req, res) => {
    try {
        const { name, rounds, timeControl, scheduledStart, description } = req.body;
        const tournament = tournamentManager.createTournament({ 
            name, 
            rounds, 
            timeControl, 
            scheduledStart,
            description 
        });
        res.json({ success: true, tournament });
    } catch (err) {
        console.error('Create tournament error:', err);
        res.status(500).json({ success: false, error: 'Failed to create tournament' });
    }
});

app.post('/api/tournament/:id/register', rateLimit({ max: 50, windowMs: 60000 }), async (req, res) => {
    try {
        const { username, deck } = req.body;
        const tournamentId = req.params.id;
        
        // Get player ELO
        let elo = 400;
        try {
            const profile = await db.get(`user:${username}`);
            const data = typeof profile === 'string' ? JSON.parse(profile) : profile;
            elo = data.elo || 400;
        } catch (err) {
            // Player doesn't exist yet, use default
        }

        const result = tournamentManager.registerPlayer(tournamentId, username, elo, deck);
        res.json(result);
    } catch (err) {
        console.error('Register player error:', err);
        res.status(500).json({ success: false, error: 'Failed to register' });
    }
});

app.post('/api/tournament/:id/unregister', rateLimit({ max: 50, windowMs: 60000 }), (req, res) => {
    try {
        const { username } = req.body;
        const tournamentId = req.params.id;
        const result = tournamentManager.unregisterPlayer(tournamentId, username);
        res.json(result);
    } catch (err) {
        console.error('Unregister player error:', err);
        res.status(500).json({ success: false, error: 'Failed to unregister' });
    }
});

app.post('/api/tournament/:id/start', verifyAdminToken, rateLimit({ max: 5, windowMs: 60000 }), (req, res) => {
    try {
        const tournamentId = req.params.id;
        const result = tournamentManager.startTournament(tournamentId);
        res.json(result);
    } catch (err) {
        console.error('Start tournament error:', err);
        res.status(500).json({ success: false, error: 'Failed to start tournament' });
    }
});

app.post('/api/tournament/:id/advance', verifyAdminToken, rateLimit({ max: 10, windowMs: 60000 }), (req, res) => {
    try {
        const tournamentId = req.params.id;
        const result = tournamentManager.advanceRound(tournamentId);
        res.json(result);
    } catch (err) {
        console.error('Advance round error:', err);
        res.status(500).json({ success: false, error: 'Failed to advance round' });
    }
});

app.delete('/api/tournament/:id', verifyAdminToken, rateLimit({ max: 10, windowMs: 60000 }), (req, res) => {
    try {
        const tournamentId = req.params.id;
        const tournament = tournamentManager.getTournament(tournamentId);
        
        if (!tournament) {
            return res.status(404).json({ success: false, error: 'Tournament not found' });
        }
        
        tournamentManager.tournaments.delete(tournamentId);
        tournamentManager.activeTournaments.delete(tournamentId);
        
        res.json({ success: true, message: 'Tournament deleted' });
    } catch (err) {
        console.error('Delete tournament error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete tournament' });
    }
});

app.get('/api/tournament/:id', rateLimit({ max: 100, windowMs: 60000 }), (req, res) => {
    try {
        const tournamentId = req.params.id;
        const tournament = tournamentManager.getTournament(tournamentId);
        
        if (!tournament) {
            return res.status(404).json({ success: false, error: 'Tournament not found' });
        }

        const standings = tournamentManager.getStandings(tournamentId);
        const pairings = tournamentManager.getCurrentPairings(tournamentId);

        res.json({
            success: true,
            tournament: {
                id: tournament.id,
                name: tournament.name,
                status: tournament.status,
                rounds: tournament.rounds,
                currentRound: tournament.currentRound,
                participants: tournament.participants.length,
                createdAt: tournament.createdAt,
                scheduledStart: tournament.scheduledStart,
                startedAt: tournament.startedAt,
                completedAt: tournament.completedAt,
                description: tournament.description
            },
            standings,
            pairings
        });
    } catch (err) {
        console.error('Get tournament error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch tournament' });
    }
});

app.get('/api/tournaments', rateLimit({ max: 100, windowMs: 60000 }), (req, res) => {
    try {
        const tournaments = tournamentManager.getAllTournaments();
        res.json({ success: true, tournaments });
    } catch (err) {
        console.error('Get tournaments error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch tournaments' });
    }
});

app.get('/tournament', (req, res) => {
    res.sendFile(path.join(__dirname, '../tournament.html'));
});

const tournamentManager = new TournamentManager(db);
const roomManager = new RoomManager(wss, db, tournamentManager);

wss.on('connection', (ws) => {
    // console.log('new connection');

    // Assign a unique ID to the socket to mimic socket.io
    ws.id = Math.random().toString(36).substring(7);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const { event, payload } = data;

            switch (event) {
                case 'join_matchmaking':
                    roomManager.addToMatchmaking(ws, payload);
                    break;
                case 'join_tournament_match':
                    roomManager.joinTournamentMatch(ws, payload);
                    break;
                case 'auth':
                    roomManager.handleAuth(ws, payload);
                    break;
                case 'create_custom_room':
                    roomManager.createCustomRoom(ws, payload);
                    break;
                case 'join_custom_room':
                    roomManager.joinCustomRoom(ws, payload);
                    break;
                case 'spectate_room':
                    roomManager.spectateRoom(ws, payload);
                    break;
                case 'get_custom_rooms':
                    ws.send(JSON.stringify({ event: 'custom_rooms_list', payload: roomManager.getCustomRooms() }));
                    break;
                case 'game_action':
                    roomManager.handleAction(ws, payload);
                    break;
                case 'forfeit':
                    roomManager.handleForfeit(ws);
                    break;
            }
        } catch (err) {
            console.error('WS Message error:', err);
        }
    });

    ws.on('close', () => {
        roomManager.handleDisconnect(ws);
    });
});

async function initBotUser() {
    const botName = '[Bot] Chegg AI';
    try {
        const userData = await db.get(`user:${botName}`);
        // If user exists but has no token or wrong token, fix it
        if (!userData.token || (userData.isBot && userData.token !== 'bot-internal')) {
            userData.token = 'bot-internal';
            userData.isBot = true;
            await db.put(`user:${botName}`, userData);
            console.log(`[BOT] Updated bot user token on startup: ${botName}`);
        }
    } catch (err) {
        if (err.code === 'LEVEL_NOT_FOUND') {
            await db.put(`user:${botName}`, {
                username: botName,
                token: 'bot-internal',
                elo: 800,
                wins: 0,
                losses: 0,
                isBot: true,
                created: Date.now()
            });
            console.log(`[BOT] Created bot user: ${botName}`);
        }
    }
}

httpServer.listen(PORT, async () => {
    console.log(`[CHEGG SERVER] running at http://localhost:${PORT}`);
    console.log(`[ADMIN] Password: ${ADMIN_PASSWORD}`);
    console.log(`[ADMIN] Access panel at http://localhost:${PORT}/admin.html`);
    await initBotUser();
});
