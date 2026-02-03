import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { Level } from 'level';
import { RoomManager } from './RoomManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const PORT = process.env.PORT || 1109;

// LevelDB setup
const db = new Level('./db/chegg-games', { valueEncoding: 'json' });

// serve static files from root
app.use(express.static(path.join(__dirname, '../')));

const roomManager = new RoomManager(wss, db);

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

httpServer.listen(PORT, () => {
    console.log(`[CHEGG SERVER] running at http://localhost:${PORT}`);
});
