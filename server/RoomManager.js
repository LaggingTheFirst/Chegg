import { Room } from './Room.js';

export class RoomManager {
    constructor(wss, db) {
        this.wss = wss; // WebSocketServer
        this.db = db;
        this.rooms = new Map(); // roomId -> Room
        this.playersInRooms = new Map(); // wsId -> roomId
        this.matchmakingQueue = [];
        this.customRooms = new Map(); // roomId -> Room (subset of rooms)
    }

    addToMatchmaking(socket, data) {
        // basic matching for now
        this.matchmakingQueue.push({ socket, deck: data.deck });

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

            room.start();
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
            saveGame: data.saveGame !== false // allowed to disable
        });

        this.rooms.set(roomId, room);
        this.customRooms.set(roomId, room);

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
                // LevelDB throws if key not found
                console.log(`[AUTH] Creating new profile for ${username}`);
            }

            if (!userData) {
                // New user!
                userData = {
                    username,
                    token,
                    elo: 1200,
                    created: Date.now()
                };
                await this.db.put(`user:${username}`, JSON.stringify(userData));
            }

            if (userData.token !== token) {
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
            // Basic security: rooms check player ID
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
        // remove from matchmaking if they were in it
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
}
