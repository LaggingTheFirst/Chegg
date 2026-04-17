import { ServerAI } from './ServerAI.js';
import { DeckManager } from '../../js/engine/DeckManager.js';
import { MinionLoader } from '../../js/minions/MinionLoader.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class BotClient {
    constructor(options = {}) {
        this.minionLoader = new MinionLoader();
        this.username = options.username || '[Bot] Chegg AI';
        this.elo = options.elo || 800;
        this.color = options.color || 'red';
        this.isThinking = false; // Prevent multiple simultaneous turns
        this.pendingActions = []; // Track pending timeouts

        const weightsPath = path.join(__dirname, 'weights.json');
        let weights = {};
        try {
            weights = JSON.parse(fs.readFileSync(weightsPath, 'utf-8'));
        } catch (e) {
            // fall back to defaults
        }

        this.ai = new ServerAI({
            color: this.color,
            weights: { ...weights, ...(options.weights || {}) },
            minionLoader: this.minionLoader,
            difficulty: options.difficulty || 'balanced'
        });

        if (options.targetElo !== undefined) {
            this.ai.setElo(options.targetElo);
        }

        this.room = null;
        this.socket = this.createFakeSocket();
        this.actionDelay = options.actionDelay ?? 500;
    }

    createFakeSocket() {
        const self = this;
        return {
            id: `bot_${Math.random().toString(36).substring(7)}_${Date.now()}`,
            username: this.username,
            elo: this.elo,
            authenticated: true,
            readyState: 1,
            send(data) {
                try {
                    const parsed = JSON.parse(data);
                    self.handleServerMessage(parsed);
                } catch (e) {
                    // ignore
                }
            },
            close() {
                this.readyState = 3;
            }
        };
    }

    getDeck() {
        return DeckManager.createDefaultDeck(this.minionLoader);
    }

    handleServerMessage(msg) {
        const { event, payload } = msg;

        if (event === 'state_update') {
            const state = typeof payload.state === 'string' ? JSON.parse(payload.state) : payload.state;
            console.log(`[BOT ${this.username}] Received state update - Current player: ${state.currentPlayer}, My color: ${this.color}, Phase: ${state.phase}, IsThinking: ${this.isThinking}`);
            if (state.currentPlayer === this.color && state.phase !== 'gameOver' && !this.isThinking) {
                console.log(`[BOT ${this.username}] It's my turn! Scheduling actions...`);
                this.scheduleActions(state);
            }
        }
    }

    scheduleActions(stateData) {
        if (!this.room) {
            console.log(`[BOT ${this.username}] Cannot schedule actions - no room attached`);
            return;
        }
        if (this.isThinking) {
            console.log(`[BOT ${this.username}] Already thinking, ignoring duplicate state update`);
            return;
        }
        
        // Cancel any pending actions from previous turn
        this.cancelPendingActions();
        
        this.isThinking = true;
        console.log(`[BOT ${this.username}] Executing turn immediately`);
        // Execute immediately - no delay needed
        this.playTurn();
    }
    
    cancelPendingActions() {
        console.log(`[BOT ${this.username}] Cancelling ${this.pendingActions.length} pending actions`);
        for (const timeout of this.pendingActions) {
            clearTimeout(timeout);
        }
        this.pendingActions = [];
    }

    playTurn() {
        if (!this.room) {
            console.log(`[BOT ${this.username}] Cannot play turn - no room attached`);
            this.isThinking = false;
            return;
        }
        const gameState = this.room.gameState;
        if (gameState.currentPlayer !== this.color) {
            console.log(`[BOT ${this.username}] Not my turn anymore (current: ${gameState.currentPlayer})`);
            this.isThinking = false;
            return;
        }
        if (gameState.phase === 'gameOver') {
            console.log(`[BOT ${this.username}] Game is over`);
            this.isThinking = false;
            return;
        }

        console.log(`[BOT ${this.username}] Playing turn...`);
        console.log(`[BOT ${this.username}] Current player in gameState: ${gameState.currentPlayer}`);
        console.log(`[BOT ${this.username}] My color: ${this.color}`);
        console.log(`[BOT ${this.username}] My hand size: ${gameState.players[this.color].hand.length}`);
        const actions = this.ai.decideTurn(gameState);
        console.log(`[BOT ${this.username}] Generated ${actions.length} actions:`, actions.map(a => a.type));

        // Execute all actions synchronously
        for (const action of actions) {
            if (!this.room) break;
            if (this.room.gameState.phase === 'gameOver') break;
            if (this.room.gameState.currentPlayer !== this.color) {
                console.log(`[BOT ${this.username}] Turn changed mid-execution, stopping`);
                break;
            }
            console.log(`[BOT ${this.username}] Executing action:`, action.type, action.payload);
            this.room.processAction(this.socket, action);
        }
        
        console.log(`[BOT ${this.username}] Finished turn, resetting isThinking`);
        this.isThinking = false;
        this.pendingActions = [];
    }

    attachToRoom(room) {
        this.room = room;
    }

    detach() {
        this.room = null;
    }
}

export default BotClient;
