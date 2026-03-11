import { createServer } from 'http';
import crypto from 'crypto';
import { RoomManager } from './RoomManager.js';

// LAN-only: dependency-free server (no node_modules). This avoids failures when
// installed packages have invalid/corrupted package.json files.
const PORT = process.env.PORT || 1109;
const roomManager = new RoomManager(null, null);

function wsAcceptKey(secWebSocketKey) {
    return crypto
        .createHash('sha1')
        .update(`${secWebSocketKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, 'utf8')
        .digest('base64');
}

function encodeFrame(opcode, payloadBuffer) {
    const len = payloadBuffer.length;

    if (len < 126) {
        const header = Buffer.alloc(2);
        header[0] = 0x80 | (opcode & 0x0f);
        header[1] = len;
        return Buffer.concat([header, payloadBuffer]);
    }

    if (len < 65536) {
        const header = Buffer.alloc(4);
        header[0] = 0x80 | (opcode & 0x0f);
        header[1] = 126;
        header.writeUInt16BE(len, 2);
        return Buffer.concat([header, payloadBuffer]);
    }

    // 64-bit length; only supports up to 2^32-1 safely here.
    const header = Buffer.alloc(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
    return Buffer.concat([header, payloadBuffer]);
}

function tryDecodeFrames(state, onFrame) {
    while (state.buffer.length >= 2) {
        const b0 = state.buffer[0];
        const b1 = state.buffer[1];
        const fin = (b0 & 0x80) !== 0;
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let payloadLen = b1 & 0x7f;
        let offset = 2;

        if (!fin) {
            // Fragmentation not supported (not needed for our small JSON frames).
            state.socket.destroy();
            return;
        }

        if (payloadLen === 126) {
            if (state.buffer.length < offset + 2) return;
            payloadLen = state.buffer.readUInt16BE(offset);
            offset += 2;
        } else if (payloadLen === 127) {
            if (state.buffer.length < offset + 8) return;
            const hi = state.buffer.readUInt32BE(offset);
            const lo = state.buffer.readUInt32BE(offset + 4);
            offset += 8;
            if (hi !== 0) {
                state.socket.destroy();
                return;
            }
            payloadLen = lo;
        }

        let maskKey = null;
        if (masked) {
            if (state.buffer.length < offset + 4) return;
            maskKey = state.buffer.subarray(offset, offset + 4);
            offset += 4;
        }

        if (state.buffer.length < offset + payloadLen) return;

        let payload = state.buffer.subarray(offset, offset + payloadLen);
        state.buffer = state.buffer.subarray(offset + payloadLen);

        if (masked && maskKey) {
            const unmasked = Buffer.alloc(payload.length);
            for (let i = 0; i < payload.length; i++) {
                unmasked[i] = payload[i] ^ maskKey[i % 4];
            }
            payload = unmasked;
        }

        onFrame(opcode, payload);
    }
}

const httpServer = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Chegg LAN server running.\n');
});

httpServer.on('upgrade', (req, socket) => {
    const upgrade = (req.headers.upgrade || '').toString().toLowerCase();
    if (upgrade !== 'websocket') {
        socket.destroy();
        return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key) {
        socket.destroy();
        return;
    }

    const accept = wsAcceptKey(key.toString());
    socket.write(
        [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${accept}`,
            '\r\n'
        ].join('\r\n')
    );

    const ws = {
        id: Math.random().toString(36).substring(7),
        readyState: 1,
        send: (text) => {
            const payload = Buffer.from(text, 'utf8');
            socket.write(encodeFrame(0x1, payload));
        }
    };

    const safeSend = (event, payload) => ws.send(JSON.stringify({ event, payload }));
    const state = { socket, buffer: Buffer.alloc(0) };

    const handleMessage = (raw) => {
        let data = null;
        try {
            data = JSON.parse(raw);
        } catch {
            return;
        }
        const { event, payload } = data;
        switch (event) {
            case 'create_custom_room':
                roomManager.createCustomRoom(ws, payload);
                break;
            case 'join_custom_room':
                roomManager.joinCustomRoom(ws, payload);
                break;
            case 'get_custom_rooms':
                safeSend('custom_rooms_list', roomManager.getCustomRooms());
                break;
            case 'game_action':
                roomManager.handleAction(ws, payload);
                break;
            case 'forfeit':
                roomManager.handleForfeit(ws);
                break;
        }
    };

    socket.on('data', (chunk) => {
        state.buffer = Buffer.concat([state.buffer, chunk]);
        tryDecodeFrames(state, (opcode, payload) => {
            if (opcode === 0x8) {
                socket.end(encodeFrame(0x8, Buffer.alloc(0)));
                return;
            }
            if (opcode === 0x9) {
                socket.write(encodeFrame(0xA, payload));
                return;
            }
            if (opcode !== 0x1) return;
            handleMessage(payload.toString('utf8'));
        });
    });

    socket.on('close', () => {
        ws.readyState = 3;
        roomManager.handleDisconnect(ws);
    });

    socket.on('error', () => {
        ws.readyState = 3;
        roomManager.handleDisconnect(ws);
    });
});

httpServer.listen(PORT, () => {
    console.log(`[CHEGG LAN SERVER] listening on ws://0.0.0.0:${PORT}`);
});

