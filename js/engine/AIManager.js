import { Board } from './Board.js';
import { TurnManager } from './TurnManager.js';
import { ManaSystem } from './ManaSystem.js';

export class AIManager {
    static DIFFICULTY_PRESETS = {
        cautious: { searchDepth: 2, playstyleBonus: 'defensive', quiescenceDepth: 2 },
        balanced: { searchDepth: 3, playstyleBonus: 'balanced', quiescenceDepth: 3 },
        aggressive: { searchDepth: 3, playstyleBonus: 'aggressive', quiescenceDepth: 2 }
    };

    constructor(game, options = {}) {
        this.game = game;
        this.color = 'red';
        this.opponentColor = 'blue';
        this.minionLoader = game.minionLoader;
        this.abilitySystem = game.abilitySystem;
        this.transpositionTable = new Map();
        this.setDifficulty(options.difficulty || 'balanced');
    }

    setDifficulty(level) {
        const key = this.constructor.DIFFICULTY_PRESETS[level] ? level : 'balanced';
        this.difficulty = key;
        this.settings = this.constructor.DIFFICULTY_PRESETS[key];
    }

    clearTranspositionTable() {
        this.transpositionTable.clear();
    }

    getStateHash(state) {
        const parts = [];
        parts.push(state.currentPlayer);
        parts.push(state.turnNumber);
        parts.push(state.players.blue.mana);
        parts.push(state.players.red.mana);
        
        const minions = Array.from(state.minionRegistry.values())
            .sort((a, b) => a.instanceId - b.instanceId);
        
        for (const m of minions) {
            if (m.position) {
                parts.push(`${m.id}:${m.owner}:${m.position.row},${m.position.col}:${m.hasMoved}:${m.hasAttacked}`);
            }
        }
        
        return parts.join('|');
    }

    async performTurn() {
        if (this.game.gameState.currentPlayer !== this.color) return;

        await this.delay(800);

        if (this.game.gameState.phase === 'setup') {
            await this.performSetup();
            this.game.endTurn();
            return;
        }

        this.clearTranspositionTable();

        const threats = this.detectThreats(this.game.gameState);
        if (threats.critical) {
            const defensiveMove = this.findDefensiveMove(this.game.gameState, threats);
            if (defensiveMove) {
                await this.executeAction(defensiveMove);
                await this.delay(600);
            }
        }

        let actionsTaken = 0;
        const MAX_ACTIONS_PER_TURN = 10;
        
        while (actionsTaken < MAX_ACTIONS_PER_TURN) {
            const clonedState = this.game.gameState.clone(this.minionLoader);
            
            const result = this.minimax(
                clonedState,
                this.settings.searchDepth,
                -Infinity,
                Infinity,
                true,
                0
            );

            if (!result || !result.move) break;

            const success = await this.executeAction(result.move);
            if (!success) break;

            actionsTaken++;
            await this.delay(600);
        }

        await this.delay(500);
        this.game.endTurn();
    }

    async performSetup() {
        const spawnZone = this.getSpawnTiles(this.color);
        const pos = this.getBestSetupPosition(spawnZone);

        const hand = this.game.gameState.players[this.color].hand;
        const villagerIndex = hand.findIndex(c => c.id === 'villager');

        if (villagerIndex !== -1) {
            this.game.performSpawn(villagerIndex, pos.r, pos.c);
            await this.delay(500);
        }
    }

    minimax(state, depth, alpha, beta, maximizingPlayer, plyFromRoot) {
        const stateHash = this.getStateHash(state);
        const ttEntry = this.transpositionTable.get(stateHash);
        
        if (ttEntry && ttEntry.depth >= depth) {
            return ttEntry;
        }

        if (depth === 0 || state.phase === 'gameOver') {
            const score = this.quiescence(state, alpha, beta, this.settings.quiescenceDepth, maximizingPlayer);
            return { score, move: null };
        }

        const color = maximizingPlayer ? this.color : this.opponentColor;
        const moves = this.generateAllMoves(state, color);
        this.orderMoves(moves, state, color);

        if (moves.length === 0) {
            const score = this.evaluateState(state, this.color);
            return { score, move: null };
        }

        let bestMove = null;

        if (maximizingPlayer) {
            let maxEval = -Infinity;
            
            for (const move of moves) {
                const clone = state.clone(this.minionLoader);
                this.applySimulatedMove(clone, move, color);
                
                const result = this.minimax(clone, depth - 1, alpha, beta, false, plyFromRoot + 1);
                
                if (result.score > maxEval) {
                    maxEval = result.score;
                    bestMove = move;
                }
                
                alpha = Math.max(alpha, result.score);
                if (beta <= alpha) break;
            }
            
            const result = { score: maxEval, move: bestMove, depth };
            this.transpositionTable.set(stateHash, result);
            return result;
        } else {
            let minEval = Infinity;
            
            for (const move of moves) {
                const clone = state.clone(this.minionLoader);
                this.applySimulatedMove(clone, move, color);
                
                const result = this.minimax(clone, depth - 1, alpha, beta, true, plyFromRoot + 1);
                
                if (result.score < minEval) {
                    minEval = result.score;
                    bestMove = move;
                }
                
                beta = Math.min(beta, result.score);
                if (beta <= alpha) break;
            }
            
            const result = { score: minEval, move: bestMove, depth };
            this.transpositionTable.set(stateHash, result);
            return result;
        }
    }

    quiescence(state, alpha, beta, depth, maximizingPlayer) {
        const standPat = this.evaluateState(state, this.color);
        
        if (depth === 0) return standPat;
        
        if (maximizingPlayer) {
            if (standPat >= beta) return beta;
            if (alpha < standPat) alpha = standPat;
        } else {
            if (standPat <= alpha) return alpha;
            if (beta > standPat) beta = standPat;
        }

        const color = maximizingPlayer ? this.color : this.opponentColor;
        const captures = this.generateCaptureMoves(state, color);
        
        if (captures.length === 0) return standPat;

        for (const move of captures) {
            const clone = state.clone(this.minionLoader);
            this.applySimulatedMove(clone, move, color);
            
            const score = this.quiescence(clone, alpha, beta, depth - 1, !maximizingPlayer);
            
            if (maximizingPlayer) {
                if (score >= beta) return beta;
                if (score > alpha) alpha = score;
            } else {
                if (score <= alpha) return alpha;
                if (score < beta) beta = score;
            }
        }
        
        return maximizingPlayer ? alpha : beta;
    }

    generateCaptureMoves(state, forColor) {
        const captures = [];
        const myMinions = state.getPlayerMinions(forColor);
        const tm = new TurnManager(state);

        for (const minion of myMinions) {
            if (tm.canMinionAttack(minion)) {
                const instance = state.rehydrateMinion(minion, this.minionLoader);
                const validAttacks = instance.getValidAttacks(state);
                for (const a of validAttacks) {
                    captures.push({ type: 'attack', minionId: minion.instanceId, row: a.row, col: a.col });
                }
            }
        }

        return captures;
    }

    orderMoves(moves, state, color) {
        const opponentColor = color === 'red' ? 'blue' : 'red';
        const opVillager = state.players[opponentColor].villager;
        
        moves.sort((a, b) => {
            let scoreA = 0;
            let scoreB = 0;

            if (a.type === 'attack') scoreA += 1000;
            if (b.type === 'attack') scoreB += 1000;

            if (a.type === 'attack' && opVillager && opVillager.position) {
                const targetA = state.getMinionAt(a.row, a.col);
                if (targetA && targetA.id === 'villager') scoreA += 10000;
            }
            if (b.type === 'attack' && opVillager && opVillager.position) {
                const targetB = state.getMinionAt(b.row, b.col);
                if (targetB && targetB.id === 'villager') scoreB += 10000;
            }

            if (a.type === 'spawn') scoreA += 500;
            if (b.type === 'spawn') scoreB += 500;

            if (a.type === 'move') scoreA += 100;
            if (b.type === 'move') scoreB += 100;

            return scoreB - scoreA;
        });
    }

    detectThreats(state) {
        const myVillager = state.players[this.color].villager;
        const opponentMinions = state.getPlayerMinions(this.opponentColor);
        
        const threats = {
            critical: false,
            attackers: [],
            potentialAttackers: []
        };

        if (!myVillager || !myVillager.position) return threats;

        for (const minion of opponentMinions) {
            const instance = state.rehydrateMinion(minion, this.minionLoader);
            const attacks = instance.getValidAttacks(state);
            
            for (const attack of attacks) {
                if (attack.row === myVillager.position.row && attack.col === myVillager.position.col) {
                    threats.critical = true;
                    threats.attackers.push(minion);
                }
            }

            const moves = instance.getValidMoves(state);
            for (const move of moves) {
                const dist = Board.getDistance(move.row, move.col, myVillager.position.row, myVillager.position.col);
                if (dist <= 2) {
                    threats.potentialAttackers.push({ minion, distance: dist });
                }
            }
        }

        return threats;
    }

    findDefensiveMove(state, threats) {
        const myVillager = state.players[this.color].villager;
        if (!myVillager || !myVillager.position) return null;

        const myMinions = state.getPlayerMinions(this.color);
        const tm = new TurnManager(state);

        for (const attacker of threats.attackers) {
            for (const defender of myMinions) {
                if (defender.instanceId === myVillager.instanceId) continue;
                
                if (tm.canMinionAttack(defender)) {
                    const instance = state.rehydrateMinion(defender, this.minionLoader);
                    const attacks = instance.getValidAttacks(state);
                    
                    for (const attack of attacks) {
                        if (attack.row === attacker.position.row && attack.col === attacker.position.col) {
                            return { type: 'attack', minionId: defender.instanceId, row: attack.row, col: attack.col };
                        }
                    }
                }
            }
        }

        if (tm.canMinionMove(myVillager)) {
            const instance = state.rehydrateMinion(myVillager, this.minionLoader);
            const moves = instance.getValidMoves(state);
            
            for (const move of moves) {
                let safe = true;
                for (const attacker of threats.attackers) {
                    const attackerInstance = state.rehydrateMinion(attacker, this.minionLoader);
                    const potentialAttacks = attackerInstance.getValidAttacks(state);
                    
                    for (const attack of potentialAttacks) {
                        if (attack.row === move.row && attack.col === move.col) {
                            safe = false;
                            break;
                        }
                    }
                    if (!safe) break;
                }
                
                if (safe) {
                    return { type: 'move', minionId: myVillager.instanceId, row: move.row, col: move.col };
                }
            }
        }

        return null;
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
