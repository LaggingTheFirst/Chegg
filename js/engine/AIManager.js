import { Board } from './Board.js';
import { TurnManager } from './TurnManager.js';
import { ManaSystem } from './ManaSystem.js';
import { SearchEngine } from './SearchEngine.js';

const DEFAULT_WEIGHTS = {
    material: 10, pieceCount: 5, villagerSafety: 8, villagerExposure: 5,
    villagerCorner: 2, kingShelter: 3, villagerThreat: 40, nearVillagerThreat: 15,
    advancement: 0.4, centerControl: 0.5, spawnPressure: 3, enemyInSpawn: 3,
    offensivePressure: 2.5, enemyProximity: 3, distToEnemyVillager: 2,
    enemyDistToVillager: 3, mobility: 0.15, boardControl: 0.1, manaEfficiency: 1.5,
    manaReserve: 0.5, cardAdvantage: 4, pieceCoordination: 1.5, isolatedPiece: 1.5,
    defendedPiece: 1, hangingPiece: 2, forkBonus: 15, rangedAdvantage: 1.5,
    catMana: 5, creeperProximity: 4, skeletonLane: 3, blazeAttack: 2,
    phantomMobility: 1.5, endermanTeleport: 2, pieceSynergy: 1.5, clusterBonus: 0.8,
    tempoBonus: 1, endgameWeight: 1, endgameKingHunt: 5, passedPiece: 1.5,
    trappedPiece: 2, laneControl: 1
};

export class AIManager {
    static DIFFICULTY_PRESETS = {
        cautious: { searchTime: 1000, maxDepth: 4, playstyle: 'defensive', quiescenceDepth: 2 },
        balanced: { searchTime: 2000, maxDepth: 6, playstyle: 'balanced', quiescenceDepth: 3 },
        aggressive: { searchTime: 4000, maxDepth: 8, playstyle: 'aggressive', quiescenceDepth: 4 }
    };

    constructor(game, options = {}) {
        this.game = game;
        this.color = 'red';
        this.opponentColor = 'blue';
        this.minionLoader = game.minionLoader;
        this.weights = { ...DEFAULT_WEIGHTS, ...(options.weights || {}) };
        
        this.engine = new SearchEngine({
            color: this.color,
            weights: this.weights,
            minionLoader: this.minionLoader,
            evalNoise: 0
        });

        this.setDifficulty(options.difficulty || 'balanced');
    }

    static get DEFAULT_WEIGHTS() { return { ...DEFAULT_WEIGHTS }; }

    setWeights(weights) {
        this.weights = { ...DEFAULT_WEIGHTS, ...weights };
        this.engine.weights = this.weights;
        this.engine.weightKeys = Object.keys(this.weights);
    }

    setDifficulty(level) {
        const key = this.constructor.DIFFICULTY_PRESETS[level] ? level : 'balanced';
        this.difficulty = key;
        this.settings = { ...this.constructor.DIFFICULTY_PRESETS[key] };
    }

    setElo(targetElo) {
        if (targetElo >= 1200) { this.setDifficulty('aggressive'); this.engine.evalNoise = 0; }
        else if (targetElo >= 800) { this.setDifficulty('balanced'); this.engine.evalNoise = Math.max(0, (1200 - targetElo) * 0.05); }
        else if (targetElo >= 500) { this.setDifficulty('cautious'); this.settings.maxDepth = 3; this.engine.evalNoise = Math.max(0, (800 - targetElo) * 0.1); }
        else { this.setDifficulty('cautious'); this.settings.maxDepth = 2; this.settings.quiescenceDepth = 1; this.engine.evalNoise = Math.max(0, (500 - targetElo) * 0.15); }
    }

    async performTurn() {
        if (this.game.gameState.currentPlayer !== this.color) return;
        await this.delay(800);

        if (this.game.gameState.phase === 'setup') {
            await this.performSetup();
            this.game.endTurn();
            return;
        }

        this.engine.transpositionTable.clear();
        this.engine.historyTable.clear();
        this.engine.killerMoves = Array.from({ length: 64 }, () => [null, null]);

        let actionsTaken = 0;
        while (actionsTaken < 10 && this.game.gameState.phase !== 'gameOver') {
            const result = await this.engine.iterativeDeepening(this.game.gameState, this.settings);
            
            if (!result || !result.move) break;
            
            const success = await this.executeAction(result.move);
            if (!success) break;
            
            actionsTaken++;
            await this.delay(600);
            
            if (this.game.gameState.phase === 'gameOver') break;
        }

        if (this.game.gameState.phase !== 'gameOver') {
            await this.delay(500);
            this.game.endTurn();
        }
    }




    async performSetup() {
        const spawnZone = this.getSpawnTiles(this.color);
        const pos = this.getBestSetupPosition(spawnZone);
        const hand = this.game.gameState.players[this.color].hand;
        const vi = hand.findIndex(c => c.id === 'villager');
        if (vi !== -1) {
            this.game.performSpawn(vi, pos.r, pos.c);
            await this.delay(500);
        }
    }

    async executeAction(move) {
        if (move.type === 'spawn') return this.game.performSpawn(move.index, move.row, move.col);
        const minion = this.game.gameState.minionRegistry.get(move.minionId);
        if (!minion) return false;
        
        if (move.type === 'move') return this.game.performMove(minion, move.row, move.col);
        if (move.type === 'attack') return this.game.performAttack(minion, move.row, move.col);
        return false;
    }

    getSpawnTiles(color) {
        const tiles = [];
        for (const r of Board.getSpawnRows(color)) {
            for (let c = 0; c < Board.COLS; c++) tiles.push({ r, c });
        }
        return tiles;
    }

    getBestSetupPosition(spawnZone) {
        let best = null, bestScore = -Infinity;
        const enemyBaseRow = this.color === 'red' ? 0 : Board.ROWS - 1;
        for (const pos of spawnZone) {
            const score = Math.abs(pos.r - enemyBaseRow) - Math.abs(pos.c - 4) * 0.25;
            if (score > bestScore) { bestScore = score; best = pos; }
        }
        return best || spawnZone[0];
    }

    delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
}

export default AIManager;
