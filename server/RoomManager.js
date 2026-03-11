import { Room } from './Room.js';

// LAN-only room registry. No matchmaking/auth/spectators.
export class RoomManager {
    constructor(wss, db) {
        this.wss = wss; // WebSocketServer
        this.db = db;
        this.rooms = new Map(); // roomId -> Room
        this.playersInRooms = new Map(); // wsId -> roomId
        this.customRooms = new Map(); // roomId -> Room (subset of rooms)
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
            saveGame: data.saveGame !== false
        });

        this.rooms.set(roomId, room);
        this.customRooms.set(roomId, room);

        room.addPlayer(socket, 'blue', data.deck);
        this.playersInRooms.set(socket.id, roomId);

        socket.send(JSON.stringify({ event: 'room_created', payload: { roomId } }));
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

