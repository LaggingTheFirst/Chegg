import { Room } from './Room.js';
import { BotPlayer } from './ai/BotPlayer.js';

const QUEUE_TIMEOUT_MS = 15000;
const QUEUE_CHECK_INTERVAL_MS = 3000;

export class RoomManager {
    constructor(wss, db, tournamentManager = null) {
        this.wss = wss;
        this.db = db;
        this.tournamentManager = tournamentManager;
        this.rooms = new Map();
        this.playersInRooms = new Map();
        this.matchmakingQueue = [];
        this.customRooms = new Map();

        this.queueWatchdog = setInterval(() => this.checkQueueTimeouts(), QUEUE_CHECK_INTERVAL_MS);
    }

    addToMatchmaking(socket, data) {
        if (this.abortTraining) this.abortTraining();
        this.matchmakingQueue.push({ socket, deck: data.deck, joinedAt: Date.now() });

        if (this.matchmakingQueue.length >= 2) {
            const p1 = this.matchmakingQueue.shift();
            const p2 = this.matchmakingQueue.shift();

            const roomId = `match_${Date.now()}`;
            const room = new Room(roomId, this.wss, this.db, {
                saveGame: true,
                isRanked: true
            });

            this.rooms.set(roomId, room);
            room.addPlayer(p1.socket, 'blue', p1.deck);
            room.addPlayer(p2.socket, 'red', p2.deck);

            this.playersInRooms.set(p1.socket.id, roomId);
            this.playersInRooms.set(p2.socket.id, roomId);

            // Notify both players of the room ID so they can share spectate links
            const matchInfo = { roomId };
            p1.socket.send(JSON.stringify({ event: 'match_started', payload: matchInfo }));
            p2.socket.send(JSON.stringify({ event: 'match_started', payload: matchInfo }));

            room.start();
        }
    }

    checkQueueTimeouts() {
        // No-op: players wait for real opponents only.
        // Bot matches are only spawned via the client-side "Play vs AI" button.
    }

    async spawnBotMatch(queueEntry) {
        const { socket, deck } = queueEntry;
        const playerElo = socket.elo || 400;
        const playerUsername = socket.username || 'Unknown';

        console.log(`[BOT] Spawning bot player to match against ${playerUsername} (${playerElo})`);

        // Create a bot that connects as a real WebSocket client
        const bot = new BotPlayer({
            username: '[Bot] Chegg AI',
            targetElo: playerElo,
            serverUrl: 'ws://localhost:1109'
        });

        try {
            await this.ensureBotUser(bot.username);
        } catch (e) {
            console.error('[BOT] Failed to ensure bot user:', e);
        }

        // Connect the bot
        try {
            await bot.connect();
            console.log(`[BOT] Bot connected and authenticated`);
            
            // Bot joins matchmaking with the human player
            bot.joinMatchmaking(bot.getDeck());
            
            console.log(`[BOT] Bot joined matchmaking queue`);
        } catch (e) {
            console.error('[BOT] Failed to connect bot:', e);
            // If bot fails, put human back in queue
            this.matchmakingQueue.push(queueEntry);
        }
    }

    async spawnBotVsBotMatch(bot1Username, bot1Elo, bot2Username, bot2Elo) {
        const bot1 = new BotClient({
            username: bot1Username,
            elo: bot1Elo,
            color: 'blue',
            targetElo: bot1Elo,
            actionDelay: 400
        });

        const bot2 = new BotClient({
            username: bot2Username,
            elo: bot2Elo,
            color: 'red',
            targetElo: bot2Elo,
            actionDelay: 400
        });

        try {
            await this.ensureBotUser(bot1Username);
            await this.ensureBotUser(bot2Username);
        } catch (e) {
            console.error('[BOT] Failed to ensure bot users:', e);
        }

        const roomId = `bot_vs_bot_${Date.now()}`;
        const room = new Room(roomId, this.wss, this.db, {
            saveGame: true,
            isRanked: true
        });

        this.rooms.set(roomId, room);

        room.addPlayer(bot1.socket, 'blue', bot1.getDeck());
        room.addPlayer(bot2.socket, 'red', bot2.getDeck());

        this.playersInRooms.set(bot1.socket.id, roomId);
        this.playersInRooms.set(bot2.socket.id, roomId);

        bot1.attachToRoom(room);
        bot2.attachToRoom(room);

        console.log(`[BOT] Spawned bot vs bot match: ${bot1Username} (${bot1Elo}) vs ${bot2Username} (${bot2Elo}) in ${roomId}`);

        room.start();

        return roomId;
    }

    async ensureBotUser(username) {
        try {
            const userData = await this.db.get(`user:${username}`);
            // If user exists but has no token or wrong token, fix it
            if (!userData.token || (userData.isBot && userData.token !== 'bot-internal')) {
                userData.token = 'bot-internal';
                userData.isBot = true;
                await this.db.put(`user:${username}`, userData);
                console.log(`[BOT] Updated bot user token: ${username}`);
            }
        } catch (err) {
            if (err.code === 'LEVEL_NOT_FOUND') {
                await this.db.put(`user:${username}`, {
                    username,
                    token: 'bot-internal',
                    elo: 800,
                    wins: 0,
                    losses: 0,
                    isBot: true,
                    created: Date.now()
                });
                console.log(`[BOT] Created bot user: ${username}`);
            }
        }
    }

    createCustomRoom(socket, data) {
        const roomId = data.roomId || `room_${Math.random().toString(36).substring(7)}`;
        if (this.rooms.has(roomId)) {
            socket.send(JSON.stringify({ event: 'error', payload: { message: 'Room already exists' } }));
            return;
        }

        const room = new Room(roomId, this.wss, this.db, {
            name: data.name || roomId,
            timer: data.timer || 60,
            saveGame: data.saveGame !== false,
            isPrivate: data.isPrivate || false,
            isRanked: data.isRanked || false
        });

        this.rooms.set(roomId, room);
        if (!data.isPrivate) {
            this.customRooms.set(roomId, room);
        }

        room.addPlayer(socket, 'blue', data.deck);
        this.playersInRooms.set(socket.id, roomId);

        socket.send(JSON.stringify({ event: 'room_created', payload: { roomId } }));
    }

    async handleAuth(socket, data) {
        const { username, token } = data;
        if (!username || !token) {
            socket.send(JSON.stringify({ event: 'auth_failure', payload: { message: 'Missing credentials' } }));
            return;
        }

        try {
            let userData = null;
            try {
                userData = await this.db.get(`user:${username}`);
                if (userData && typeof userData === 'string') {
                    userData = JSON.parse(userData);
                }
            } catch (err) {
                console.log(`[AUTH] Creating new profile for ${username}`);
            }

            if (!userData) {
                userData = {
                    username,
                    token,
                    elo: 400,
                    created: Date.now()
                };
                await this.db.put(`user:${username}`, userData);
            }

            if (userData.token !== token) {
                console.warn(`[AUTH] Identity mismatch for ${username}. Expected: ${userData.token}, Got: ${token}`);
                socket.send(JSON.stringify({ event: 'auth_failure', payload: { message: 'Identity mismatch. Token incorrect.' } }));
                return;
            }

            socket.username = username;
            socket.elo = userData.elo;
            socket.authenticated = true;
            socket.send(JSON.stringify({ event: 'auth_success', payload: { username, elo: userData.elo } }));
            console.log(`[AUTH] User ${username} authenticated`);

        } catch (err) {
            console.error('Auth error:', err);
            socket.send(JSON.stringify({ event: 'auth_failure', payload: { message: 'Server error during auth' } }));
        }
    }

    joinCustomRoom(socket, data) {
        const room = this.rooms.get(data.roomId);
        if (!room) {
            socket.send(JSON.stringify({ event: 'error', payload: { message: 'Room not found' } }));
            return;
        }

        if (room.isFull()) {
            socket.send(JSON.stringify({ event: 'error', payload: { message: 'Room is full' } }));
            return;
        }

        room.addPlayer(socket, 'red', data.deck);
        this.playersInRooms.set(socket.id, data.roomId);

        room.start();
    }

    spectateRoom(socket, data) {
        const room = this.rooms.get(data.roomId);
        if (!room) {
            socket.send(JSON.stringify({ event: 'error', payload: { message: 'Room not found' } }));
            return;
        }

        room.addSpectator(socket);
        this.playersInRooms.set(socket.id, data.roomId);
    }

    getCustomRooms() {
        const list = [];
        for (const [id, room] of this.customRooms) {
            list.push({
                id,
                name: room.config.name,
                players: room.players.length,
                timer: room.config.timer,
                status: room.isFull() ? 'full' : 'waiting'
            });
        }
        return list;
    }

    handleAction(socket, data) {
        const roomId = this.playersInRooms.get(socket.id);
        const room = this.rooms.get(roomId);
        if (room) {
            room.processAction(socket, data);
        }
    }

    handleForfeit(socket) {
        const roomId = this.playersInRooms.get(socket.id);
        const room = this.rooms.get(roomId);
        if (room) {
            room.forfeit(socket);
        }
    }

    handleDisconnect(socket) {
        this.matchmakingQueue = this.matchmakingQueue.filter(p => p.socket.id !== socket.id);

        const roomId = this.playersInRooms.get(socket.id);
        const room = this.rooms.get(roomId);
        if (room) {
            room.handlePlayerDisconnect(socket);
            if (room.isEmpty()) {
                this.rooms.delete(roomId);
                this.customRooms.delete(roomId);
            }
        }
        this.playersInRooms.delete(socket.id);
    }

    joinTournamentMatch(socket, data) {
        const { tournamentId, username, deck } = data;

        if (!this.tournamentManager) {
            socket.send(JSON.stringify({ event: 'error', payload: { message: 'Tournaments not available' } }));
            return;
        }

        const tournament = this.tournamentManager.getTournament(tournamentId);
        if (!tournament) {
            socket.send(JSON.stringify({ event: 'error', payload: { message: 'Tournament not found' } }));
            return;
        }

        if (tournament.status !== 'active') {
            socket.send(JSON.stringify({ event: 'error', payload: { message: 'Tournament not active' } }));
            return;
        }

        const pairings = this.tournamentManager.getCurrentPairings(tournamentId);
        const myMatch = pairings.find(p => p.player1 === username || p.player2 === username);

        if (!myMatch) {
            socket.send(JSON.stringify({ event: 'error', payload: { message: 'No match found for you this round' } }));
            return;
        }

        if (myMatch.completed) {
            socket.send(JSON.stringify({ event: 'error', payload: { message: 'Match already completed' } }));
            return;
        }

        if (myMatch.player2 === null) {
            socket.send(JSON.stringify({ event: 'error', payload: { message: 'You have a bye this round' } }));
            return;
        }

        let roomId = myMatch.roomId;
        let room = roomId ? this.rooms.get(roomId) : null;

        if (!room) {
            roomId = `tournament_${tournamentId}_r${tournament.currentRound}_${myMatch.player1}_vs_${myMatch.player2}`;

            room = new Room(roomId, this.wss, this.db, {
                name: `Tournament Match: ${myMatch.player1} vs ${myMatch.player2}`,
                matchTime: tournament.timeControl,
                saveGame: true,
                isRanked: false,
                tournamentId: tournamentId,
                onMatchComplete: (winner) => {
                    const winnerUsername = winner === 'blue' ? myMatch.player1 : myMatch.player2;
                    this.tournamentManager.recordMatchResult(
                        tournamentId,
                        myMatch.player1,
                        myMatch.player2,
                        winnerUsername
                    );
                }
            });

            this.rooms.set(roomId, room);
            this.tournamentManager.setMatchRoom(tournamentId, myMatch.player1, myMatch.player2, roomId);

            const color = username === myMatch.player1 ? 'blue' : 'red';
            room.addPlayer(socket, color, deck);
            this.playersInRooms.set(socket.id, roomId);

            console.log(`[TOURNAMENT] Created room ${roomId} for ${username}`);
        } else {
            const color = username === myMatch.player1 ? 'blue' : 'red';

            if (room.players.some(p => p.socket.id === socket.id)) {
                socket.send(JSON.stringify({ event: 'error', payload: { message: 'Already in this match' } }));
                return;
            }

            room.addPlayer(socket, color, deck);
            this.playersInRooms.set(socket.id, roomId);

            console.log(`[TOURNAMENT] ${username} joined room ${roomId}`);

            if (room.isFull()) {
                room.start();
            }
        }
    }

    destroy() {
        if (this.queueWatchdog) {
            clearInterval(this.queueWatchdog);
            this.queueWatchdog = null;
        }
    }
}
