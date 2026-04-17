import { ServerAI } from './ServerAI.js';
import { DeckManager } from '../../js/engine/DeckManager.js';
import { MinionLoader } from '../../js/minions/MinionLoader.js';
import { GameState } from '../../js/engine/GameState.js';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * BotPlayer connects to the server as a real WebSocket client
 * and plays the game through normal network messages
 */
export class BotPlayer {
    constructor(options = {}) {
        this.minionLoader = new MinionLoader();
        this.username = options.username || '[Bot] Chegg AI';
        this.targetElo = options.targetElo || 800;
        this.serverUrl = options.serverUrl || 'ws://localhost:1109';
        
        const weightsPath = path.join(__dirname, 'weights.json');
        let weights = {};
        try {
            weights = JSON.parse(fs.readFileSync(weightsPath, 'utf-8'));
        } catch (e) {
            console.warn('[BOT] No weights file found, using defaults');
        }

        this.ai = new ServerAI({
            color: null, // Will be assigned by server
            weights: { ...weights, ...(options.weights || {}) },
            minionLoader: this.minionLoader,
            difficulty: options.difficulty || 'balanced'
        });

        if (options.targetElo !== undefined) {
            this.ai.setElo(options.targetElo);
        }

        this.ws = null;
        this.gameState = null;
        this.myColor = null;
        this.isThinking = false;
        this.roomId = null;
    }

    connect() {
        return new Promise((resolve, reject) => {
            console.log(`[BOT ${this.username}] Connecting to ${this.serverUrl}`);
            this.ws = new WebSocket(this.serverUrl);

            this.ws.on('open', () => {
                console.log(`[BOT ${this.username}] Connected`);
                this.authenticate();
            });

            this.ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    this.handleMessage(msg);
                } catch (e) {
                    console.error(`[BOT ${this.username}] Parse error:`, e);
                }
            });

            this.ws.on('error', (err) => {
                console.error(`[BOT ${this.username}] WebSocket error:`, err);
                reject(err);
            });

            this.ws.on('close', () => {
                console.log(`[BOT ${this.username}] Disconnected`);
            });

            // Resolve when authenticated
            this.once('authenticated', resolve);
        });
    }

    authenticate() {
        this.send('auth', {
            username: this.username,
            token: 'bot-internal'
        });
    }

    handleMessage(msg) {
        const { event, payload } = msg;

        switch (event) {
            case 'auth_success':
                console.log(`[BOT ${this.username}] Authenticated with ELO ${payload.elo}`);
                this.emit('authenticated');
                break;

            case 'auth_failure':
                console.error(`[BOT ${this.username}] Auth failed:`, payload.message);
                break;

            case 'player_assigned':
                this.myColor = payload.color;
                this.ai.color = this.myColor;
                console.log(`[BOT ${this.username}] Assigned color: ${this.myColor}`);
                break;

            case 'state_update':
                this.handleStateUpdate(payload);
                break;

            case 'game_event':
                // Handle game events if needed
                break;

            case 'error':
                console.error(`[BOT ${this.username}] Server error:`, payload.message);
                break;
        }
    }

    handleStateUpdate(payload) {
        const state = typeof payload.state === 'string' ? JSON.parse(payload.state) : payload.state;
        this.gameState = GameState.fromJSON(state, this.minionLoader);

        console.log(`[BOT ${this.username}] State update - Current: ${state.currentPlayer}, My color: ${this.myColor}, Phase: ${state.phase}`);

        // If it's my turn and I'm not already thinking, play
        if (state.currentPlayer === this.myColor && 
            state.phase !== 'gameOver' && 
            !this.isThinking) {
            this.playTurn();
        }
    }

    async playTurn() {
        if (this.isThinking) {
            console.log(`[BOT ${this.username}] Already thinking, skipping`);
            return;
        }

        this.isThinking = true;
        console.log(`[BOT ${this.username}] My turn! Deciding actions...`);

        try {
            const actions = await this.ai.decideTurn(this.gameState);
            console.log(`[BOT ${this.username}] Generated ${actions.length} actions:`, actions.map(a => a.type));

            // Send actions one by one with small delays for visual effect
            this.executeActionsSequentially(actions, 0);
        } catch (e) {
            console.error(`[BOT ${this.username}] Error deciding turn:`, e);
            // If error, just end turn
            this.sendAction('END_TURN', {});
            this.isThinking = false;
        }
    }

    executeActionsSequentially(actions, index) {
        if (index >= actions.length) {
            this.isThinking = false;
            console.log(`[BOT ${this.username}] Finished turn`);
            return;
        }

        const action = actions[index];
        console.log(`[BOT ${this.username}] Sending action ${index + 1}/${actions.length}:`, action.type);
        
        this.sendAction(action.type, action.payload);

        // Small delay between actions for visual effect (optional)
        setTimeout(() => {
            this.executeActionsSequentially(actions, index + 1);
        }, 300);
    }

    sendAction(type, payload) {
        this.send('game_action', { type, payload });
    }

    send(event, payload) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ event, payload }));
        }
    }

    joinMatchmaking(deck) {
        console.log(`[BOT ${this.username}] Joining matchmaking`);
        this.send('join_matchmaking', { deck });
    }

    getDeck() {
        return DeckManager.createDefaultDeck(this.minionLoader);
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }

    // Simple event emitter
    once(event, callback) {
        this._events = this._events || {};
        this._events[event] = callback;
    }

    emit(event, data) {
        this._events = this._events || {};
        if (this._events[event]) {
            this._events[event](data);
            delete this._events[event];
        }
    }
}

export default BotPlayer;
