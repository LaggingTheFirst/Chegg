import { Board } from '../../js/engine/Board.js';
import { TurnManager } from '../../js/engine/TurnManager.js';
import { ManaSystem } from '../../js/engine/ManaSystem.js';
import { SearchEngine } from '../../js/engine/SearchEngine.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ServerAI {
    static DIFFICULTY_PRESETS = {
        cautious: { searchTime: 1000, maxDepth: 4, playstyle: 'defensive', quiescenceDepth: 2 },
        balanced: { searchTime: 2000, maxDepth: 6, playstyle: 'balanced', quiescenceDepth: 3 },
        aggressive: { searchTime: 4000, maxDepth: 8, playstyle: 'aggressive', quiescenceDepth: 4 }
    };

    constructor(options = {}) {
        this.color = options.color || 'red';
        this.minionLoader = options.minionLoader;
        this.difficulty = options.difficulty || 'balanced';
        this.settings = { ...this.constructor.DIFFICULTY_PRESETS[this.difficulty] };
        
        this.engine = new SearchEngine({
            color: this.color,
            weights: options.weights || {},
            minionLoader: this.minionLoader,
            evalNoise: 0
        });

        if (options.targetElo) {
            this.setElo(options.targetElo);
        }
    }

    setElo(targetElo) {
        if (targetElo >= 1200) { this.difficulty = 'aggressive'; this.engine.evalNoise = 0; }
        else if (targetElo >= 800) { this.difficulty = 'balanced'; this.engine.evalNoise = Math.max(0, (1200 - targetElo) * 0.05); }
        else if (targetElo >= 500) { this.difficulty = 'cautious'; this.settings.maxDepth = 3; this.engine.evalNoise = Math.max(0, (800 - targetElo) * 0.1); }
        else { this.difficulty = 'cautious'; this.settings.maxDepth = 2; this.settings.quiescenceDepth = 1; this.engine.evalNoise = Math.max(0, (500 - targetElo) * 0.15); }
        this.settings = { ...this.constructor.DIFFICULTY_PRESETS[this.difficulty] };
    }

    async decideTurn(gameState) {
        const actions = [];
        
        if (gameState.phase === 'setup') {
            const pos = this.chooseSetupPosition(gameState);
            if (pos) {
                const hand = gameState.players[this.color].hand;
                const villagerIdx = hand.findIndex(c => c.id === 'villager');
                if (villagerIdx !== -1) {
                    actions.push({ type: 'SPAWN', payload: { index: villagerIdx, row: pos.r, col: pos.c } });
                }
            }
            actions.push({ type: 'END_TURN', payload: {} });
            return actions;
        }

        // Search engine state reset
        this.engine.transpositionTable.clear();
        this.engine.historyTable.clear();
        this.engine.killerMoves = Array.from({ length: 64 }, () => [null, null]);

        let actionsTaken = 0;
        const simulatedState = gameState; // Using a copy is handled by the caller (BotPlayer)

        while (actionsTaken < 10 && simulatedState.phase !== 'gameOver') {
            const result = await this.engine.iterativeDeepening(simulatedState, this.settings);
            
            if (!result || !result.move) break;
            
            actions.push(this.moveToAction(result.move));
            
            // Apply move to simulator to find the NEXT best move in the sequence
            simulatedState.applySearchAction(result.move, this.minionLoader);
            actionsTaken++;
        }

        actions.push({ type: 'END_TURN', payload: {} });
        return actions;
    }

    moveToAction(move) {
        if (move.type === 'spawn') return { type: 'SPAWN', payload: { index: move.index, row: move.row, col: move.col } };
        if (move.type === 'move') return { type: 'MOVE', payload: { minionId: move.minionId, row: move.row, col: move.col } };
        if (move.type === 'attack') return { type: 'ATTACK', payload: { minionId: move.minionId, row: move.row, col: move.col } };
        return null;
    }

    chooseSetupPosition(gameState) {
        const spawnRows = Board.getSpawnRows(this.color);
        const bestRow = this.color === 'red' ? Math.max(...spawnRows) : Math.min(...spawnRows);
        const emptyTiles = [];
        for (let c = 0; c < Board.COLS; c++) {
            if (!gameState.getMinionAt(bestRow, c)) emptyTiles.push({ r: bestRow, c });
        }
        return emptyTiles.length > 0 ? emptyTiles[Math.floor(emptyTiles.length / 2)] : { r: bestRow, c: 3 };
    }
}
