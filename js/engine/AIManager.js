import { Board } from './Board.js';
import { TurnManager } from './TurnManager.js';
import { ManaSystem } from './ManaSystem.js';

export class AIManager {
    static DIFFICULTY_PRESETS = {
        cautious: { searchDepth: 1, playstyleBonus: 'defensive' },
        balanced: { searchDepth: 1, playstyleBonus: 'balanced' },
        aggressive: { searchDepth: 1, playstyleBonus: 'aggressive' }
    };

    constructor(game, options = {}) {
        this.game = game;
        this.color = 'red';
        this.opponentColor = 'blue';
        this.minionLoader = game.minionLoader;
        this.abilitySystem = game.abilitySystem;
        this.setDifficulty(options.difficulty || 'balanced');
    }

    setDifficulty(level) {
        const key = this.constructor.DIFFICULTY_PRESETS[level] ? level : 'balanced';
        this.difficulty = key;
        this.settings = this.constructor.DIFFICULTY_PRESETS[key];
    }

    async performTurn() {
        if (this.game.gameState.currentPlayer !== this.color) return;

        // give a second to react
        await this.delay(800);

        // check if we are still in setup mode
        if (this.game.gameState.phase === 'setup') {
            await this.performSetup();
            this.game.endTurn();
            return;
        }

        // Action Loop (Greedy Search)
        let actionsTaken = 0;
        const MAX_ACTIONS_PER_TURN = 8; // prevent infinite loops
        
        while (actionsTaken < MAX_ACTIONS_PER_TURN) {
            const bestMove = this.getBestNextAction();
            if (!bestMove) break; // End turn if no move improves score

            const success = await this.executeAction(bestMove);
            if (!success) break;

            actionsTaken++;
            await this.delay(600);
        }

        // wrap it up
        await this.delay(500);
        this.game.endTurn();
    }

    async performSetup() {
        // pick the safest king tile in spawn zone
        const spawnZone = this.getSpawnTiles(this.color);
        const pos = this.getBestSetupPosition(spawnZone);

        // find the king in our pocket
        const hand = this.game.gameState.players[this.color].hand;
        const villagerIndex = hand.findIndex(c => c.id === 'villager');

        if (villagerIndex !== -1) {
            this.game.performSpawn(villagerIndex, pos.r, pos.c);
            await this.delay(500);
        }
    }

    getBestNextAction() {
        // Generate pseudo-legal moves
        const moves = this.generateAllMoves(this.game.gameState, this.color);
        if (moves.length === 0) return null;

        // Evaluate current state score
        const currentScore = this.evaluateState(this.game.gameState, this.color);
        
        let bestMove = null;
        // Require at least a small improvement to make a move (or allow equal if it's progression)
        let bestScore = currentScore + 0.1; 

        for (const move of moves) {
            // Predict future state
            const clone = this.game.gameState.clone(this.minionLoader);
            this.applySimulatedMove(clone, move, this.color);
            
            // Score the board
            const score = this.evaluateState(clone, this.color);
            
            if (score > bestScore) {
                bestScore = score;
                bestMove = move;
            }
        }

        return bestMove;
    }

    generateAllMoves(state, forColor) {
        const moves = [];
        const player = state.players[forColor];
        const myMinions = state.getPlayerMinions(forColor);
        const tm = new TurnManager(state);

        // 1. Spawns
        const affordableHandCards = player.hand.map((c, idx) => ({card: c, idx})).filter(item => ManaSystem.canAfford(player, item.card.cost));
        const spawnTiles = this.getSpawnTiles(forColor).filter(t => !state.getMinionAt(t.r, t.c));
        
        for (const item of affordableHandCards) {
            for (const tile of spawnTiles) {
                // Don't spawn villager randomly if it's phase 'playing'
                if (item.card.id === 'villager' && state.phase !== 'setup') continue;
                moves.push({ type: 'spawn', index: item.idx, row: tile.r, col: tile.c, cost: item.card.cost });
            }
        }

        // 2. Moves and Attacks
        for (const minion of myMinions) {
            if (tm.canMinionMove(minion)) {
                const instance = state.rehydrateMinion(minion, this.minionLoader);
                const validMoves = instance.getValidMoves(state);
                for (const m of validMoves) {
                    moves.push({ type: 'move', minionId: minion.instanceId, row: m.row, col: m.col });
                }
            }
            if (tm.canMinionAttack(minion)) {
                const instance = state.rehydrateMinion(minion, this.minionLoader);
                const validAttacks = instance.getValidAttacks(state);
                for (const a of validAttacks) {
                    moves.push({ type: 'attack', minionId: minion.instanceId, row: a.row, col: a.col });
                }
            }
        }

        return moves;
    }

    applySimulatedMove(state, move, forColor) {
        const tm = new TurnManager(state);
        
        if (move.type === 'spawn') {
            const player = state.players[forColor];
            const card = player.hand[move.index];
            const minion = this.minionLoader.createSpecializedMinion(card.id, forColor);
            state.placeMinion(minion, move.row, move.col);
            ManaSystem.spendMana(player, card.cost || 0);
            player.hand.splice(move.index, 1);
        } else if (move.type === 'move') {
            const minion = state.minionRegistry.get(move.minionId);
            if (!minion) return;
            const moveCost = ManaSystem.getMoveCost(minion);
            state.moveMinion(minion, move.row, move.col);
            ManaSystem.spendMana(state.players[forColor], moveCost);
            tm.recordAction(minion, 'move');
        } else if (move.type === 'attack') {
            const minion = state.minionRegistry.get(move.minionId);
            if (!minion) return;
            const targetMinion = state.getMinionAt(move.row, move.col);
            
            const attackCost = ManaSystem.getAttackCost(minion);
            ManaSystem.spendMana(state.players[forColor], attackCost);
            tm.recordAction(minion, 'attack');
            
            // Simple combat resolution simulation
            if (targetMinion) {
                state.removeMinion(targetMinion);
            }
            
            // Some units like skeleton_king dash on attack, simulate move
            if (minion.id !== 'skeleton' && targetMinion) {
                state.moveMinion(minion, move.row, move.col);
            }
        }
    }

    async executeAction(move) {
        if (move.type === 'spawn') {
            return this.game.performSpawn(move.index, move.row, move.col);
        } else if (move.type === 'move') {
            const minion = this.game.gameState.minionRegistry.get(move.minionId);
            if (!minion) return false;
            return this.game.performMove(minion, move.row, move.col);
        } else if (move.type === 'attack') {
            const minion = this.game.gameState.minionRegistry.get(move.minionId);
            if (!minion) return false;
            return this.game.performAttack(minion, move.row, move.col);
        }
        return false;
    }

    evaluateState(state, color) {
        let score = 0;
        const opponentColor = color === 'red' ? 'blue' : 'red';
        
        // Immediate Win/Loss Condition
        if (state.phase === 'gameOver') {
            if (state.winner === color) return Infinity; // We won
            if (state.winner === opponentColor) return -Infinity; // We lost
        }

        const myVillager = state.players[color].villager;
        const opVillager = state.players[opponentColor].villager;
        
        const style = this.settings.playstyleBonus;

        // Base Evaluation: Material Advantage & Central Control
        for (const [id, minion] of state.minionRegistry) {
            let value = minion.cost || 1;
            if (minion.id === 'villager') value = 1000;

            const isMine = minion.owner === color;
            const multiplier = isMine ? 1 : -1;
            
            // Add material value
            score += (value * 10) * multiplier;

            // Positioning bonuses
            if (minion.position) {
                // Control center
                const centerBias = Math.abs(minion.position.col - Math.floor(Board.COLS / 2));
                score -= (centerBias * 0.5) * multiplier;

                if (isMine && minion.id !== 'villager') {
                    if (opVillager && opVillager.position) {
                        const distToOp = Board.getDistance(minion.position.row, minion.position.col, opVillager.position.row, opVillager.position.col);
                        // Aggressive: HUGE push to swarm enemy king
                        // Cautious: Light push
                        // Balanced: Medium push
                        const opDistMult = style === 'aggressive' ? 3.0 : (style === 'defensive' ? 0.5 : 1.5);
                        score -= (distToOp * opDistMult);
                    }
                    
                    if (myVillager && myVillager.position) {
                        const distToMine = Board.getDistance(minion.position.row, minion.position.col, myVillager.position.row, myVillager.position.col);
                        // Aggressive: Ignores defending own king
                        // Cautious: Hugely prizes staying near own king
                        if (style === 'defensive' && distToMine <= 3) score += 6;
                        else if (style === 'balanced' && distToMine <= 2) score += 3;
                    }
                } else if (!isMine && myVillager && myVillager.position) {
                    // Enemy pieces getting close to our king
                    const distToMine = Board.getDistance(minion.position.row, minion.position.col, myVillager.position.row, myVillager.position.col);
                    const defendMult = style === 'defensive' ? 4.0 : (style === 'aggressive' ? 1.0 : 2.0);
                    score += (distToMine * defendMult); // Opponent further is better
                }
            }
        }

        // Global Playstyle modifiers
        if (style === 'aggressive') {
            // Highly penalize unspent mana to force spawning and overwhelming combat
            score -= state.players[color].mana * 3;
        } else if (style === 'defensive') {
            // Cautious slightly rewards hoarding some mana in reserve instead of blindly throwing units
            score += Math.min(state.players[color].mana, 3) * 1; 
        }

        return score;
    }

    getSpawnTiles(color) {
        const tiles = [];
        for (const r of Board.getSpawnRows(color)) {
            for (let c = 0; c < Board.COLS; c++) {
                tiles.push({ r, c });
            }
        }
        return tiles;
    }

    getBestSetupPosition(spawnZone) {
        let best = null;
        let bestScore = Infinity;
        const enemyBaseRow = this.color === 'red' ? 0 : Board.ROWS - 1;

        for (const pos of spawnZone) {
            const distFromEnemyBase = Math.abs(pos.r - enemyBaseRow);
            const edgeBias = Math.abs(pos.c - Math.floor(Board.COLS / 2));
            const score = -distFromEnemyBase - edgeBias * 0.25;

            if (score < bestScore) {
                bestScore = score;
                best = pos;
            }
        }
        return best || spawnZone[Math.floor(Math.random() * spawnZone.length)];
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export default AIManager;
