import { LanDiscovery } from './LanDiscovery.js';
import { LanEvents, LanServerEvents } from './LanProtocol.js';

export class LanClient {
    constructor(game) {
        this.game = game;
        this.socket = null;
        this.color = null;
        this.pendingCallbacks = new Map();
        this.serverUrl = LanDiscovery.getSavedServerUrl();
    }

    connect(url = this.serverUrl) {
        if (url) {
            this.serverUrl = url;
            LanDiscovery.setSavedServerUrl(url);
        }

        if (this.socket && this.socket.readyState <= 1) return;

        this.socket = new WebSocket(this.serverUrl);

        this.socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (err) {
                console.error('WS Parse error:', err);
            }
        };

        this.socket.onopen = () => {
            console.log('LAN WS Connected:', this.serverUrl);
        };

        this.socket.onerror = (err) => {
            console.error('WS Error:', err);
            this.game.showError('LAN connection error.');
        };

        this.socket.onclose = () => {
            this.game.showError('Disconnected from LAN host.');
        };
    }

    handleMessage(data) {
        const { event, payload } = data;

        switch (event) {
            case LanServerEvents.PLAYER_ASSIGNED:
                this.color = payload.color;
                break;
            case LanServerEvents.STATE_UPDATE:
                this.game.onServerStateUpdate(JSON.parse(payload.state));
                break;
            case LanServerEvents.GAME_EVENT: {
                const { eventName, data: detail } = payload;
                document.dispatchEvent(new CustomEvent(`chegg:${eventName}`, { detail }));
                break;
            }
            case LanServerEvents.TIMER_TICK:
                this.game.updateTimer(payload);
                break;
            case LanServerEvents.ERROR:
                this.game.showError(payload.message);
                break;
            case LanServerEvents.ROOMS_LIST:
                if (this.pendingCallbacks.has(LanServerEvents.ROOMS_LIST)) {
                    this.pendingCallbacks.get(LanServerEvents.ROOMS_LIST)(payload);
                    this.pendingCallbacks.delete(LanServerEvents.ROOMS_LIST);
                }
                break;
            case LanServerEvents.ROOM_CREATED:
                console.log('LAN room created:', payload.roomId);
                break;
        }
    }

    send(event, payload = {}) {
        if (!this.socket || this.socket.readyState !== 1) {
            this.connect();
            const check = setInterval(() => {
                if (this.socket && this.socket.readyState === 1) {
                    clearInterval(check);
                    this.socket.send(JSON.stringify({ event, payload }));
                }
            }, 100);
            return;
        }
        this.socket.send(JSON.stringify({ event, payload }));
    }

    createRoom(name, timer, deck, saveGame = true) {
        this.send(LanEvents.CREATE_ROOM, { name, timer, deck, saveGame });
    }

    joinRoom(roomId, deck) {
        this.send(LanEvents.JOIN_ROOM, { roomId, deck });
    }

    getRooms(callback) {
        this.pendingCallbacks.set(LanServerEvents.ROOMS_LIST, callback);
        this.send(LanEvents.LIST_ROOMS);
    }

    sendAction(type, payload) {
        this.send(LanEvents.GAME_ACTION, { type, payload });
    }

    forfeit() {
        this.send(LanEvents.FORFEIT);
    }
}
