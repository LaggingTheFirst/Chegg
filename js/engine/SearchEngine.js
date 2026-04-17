import { Board } from './Board.js';
import { TurnManager } from './TurnManager.js';
import { ManaSystem } from './ManaSystem.js';

const MATE_SCORE = 1000000000;

export class SearchEngine {
    constructor(options = {}) {
        this.weights = options.weights || {};
        this.weightKeys = Object.keys(this.weights);
        this.minionLoader = options.minionLoader;
        this.evalNoise = options.evalNoise || 0;
        this.transpositionTable = new Map();
        this.killerMoves = Array.from({ length: 64 }, () => [null, null]);
        this.historyTable = new Map();
        
        this.startTime = 0;
        this.timeLimit = 0;
        this.nodesEvaluated = 0;
        this.abortSearch = false;
        
        this.color = options.color;
        this.opponentColor = options.color === 'red' ? 'blue' : 'red';
    }

    getStateHash(state) {
        let hash = `${state.currentPlayer}${state.players.blue.mana}${state.players.red.mana}`;
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 8; c++) {
                const b = state.board[r][c].minion;
                if (b) hash += `${b.id[0]}${b.owner[0]}${b.hasMoved ? 'm' : ''}${b.hasAttacked ? 'a' : ''}${b.hp}`;
                else hash += '.';
            }
        }
        return hash;
    }

    async iterativeDeepening(state, settings) {
        this.startTime = Date.now();
        this.timeLimit = settings.searchTime || 2000;
        this.abortSearch = false;
        this.nodesEvaluated = 0;

        let bestResult = null;
        let currentDepthScore = this.evaluateState(state, this.color);

        for (let depth = 1; depth <= (settings.maxDepth || 8); depth++) {
            const result = this.minimax(state, depth, -MATE_SCORE - 100, MATE_SCORE + 100, true, 0, currentDepthScore, settings);
            
            if (this.abortSearch && depth > 1) break;
            
            bestResult = result;
            console.log(`[SearchEngine] Depth ${depth} completed. Score: ${result.score}, Nodes: ${this.nodesEvaluated}`);
            
            if (Math.abs(result.score) > MATE_SCORE / 2) break;
            if (Date.now() - this.startTime > this.timeLimit) break;
        }

        return bestResult;
    }

    minimax(state, depth, alpha, beta, maximizing, ply, currentScore, settings) {
        if (this.nodesEvaluated % 1024 === 0) {
            if (Date.now() - this.startTime > this.timeLimit) {
                this.abortSearch = true;
            }
        }
        if (this.abortSearch && depth > 0) return { score: currentScore, move: null };

        this.nodesEvaluated++;

        const hash = this.getStateHash(state);
        const ttEntry = this.transpositionTable.get(hash);
        if (ttEntry && ttEntry.depth >= depth) {
            if (ttEntry.flag === 'EXACT') return ttEntry;
            if (ttEntry.flag === 'LOWER' && ttEntry.score >= beta) return ttEntry;
            if (ttEntry.flag === 'UPPER' && ttEntry.score <= alpha) return ttEntry;
        }

        if (state.phase === 'gameOver') {
             const finalScore = state.winner === this.color ? MATE_SCORE - ply : -MATE_SCORE + ply;
             return { score: finalScore, move: null };
        }

        if (depth === 0) {
            const score = this.quiescence(state, alpha, beta, settings.quiescenceDepth || 3, maximizing, currentScore);
            return { score, move: null };
        }

        // Null Move Pruning
        if (depth >= 3 && !maximizing && Math.abs(currentScore) < MATE_SCORE / 2) {
            const nmScore = this.minimax(state, depth - 3, alpha, beta, true, ply + 1, currentScore, settings).score;
            if (nmScore <= alpha) return { score: alpha, move: null };
        }

        const color = maximizing ? this.color : this.opponentColor;
        const moves = this.generateAllMoves(state, color);
        
        const hashMove = ttEntry ? ttEntry.move : null;
        this.orderMoves(moves, state, color, ply, hashMove);

        if (moves.length === 0) return { score: currentScore, move: null };

        let bestMove = null;
        let alphaOriginal = alpha;

        if (maximizing) {
            let maxEval = -Infinity;
            for (let i = 0; i < moves.length; i++) {
                const move = moves[i];
                const undoInfo = state.applySearchAction(move, this.minionLoader);
                if (!undoInfo) continue;
                
                const scoreDelta = this.getMoveDelta(state, move, true);
                let result = this.minimax(state, depth - 1, alpha, beta, false, ply + 1, currentScore + scoreDelta, settings);
                
                state.undoSearchAction(undoInfo);

                if (result.score > maxEval) {
                    maxEval = result.score;
                    bestMove = move;
                }
                alpha = Math.max(alpha, result.score);
                if (beta <= alpha) {
                    if (move.type !== 'attack' && ply < this.killerMoves.length) {
                        this.killerMoves[ply][1] = this.killerMoves[ply][0];
                        this.killerMoves[ply][0] = move;
                    }
                    const key = this.getMoveKey(move);
                    this.historyTable.set(key, (this.historyTable.get(key) || 0) + depth * depth);
                    break;
                }
            }
            const r = { score: maxEval, move: bestMove, depth, flag: maxEval <= alphaOriginal ? 'UPPER' : (maxEval >= beta ? 'LOWER' : 'EXACT') };
            this.transpositionTable.set(hash, r);
            return r;
        } else {
            let minEval = Infinity;
            for (let i = 0; i < moves.length; i++) {
                const move = moves[i];
                const undoInfo = state.applySearchAction(move, this.minionLoader);
                if (!undoInfo) continue;

                const scoreDelta = this.getMoveDelta(state, move, false);
                let result = this.minimax(state, depth - 1, alpha, beta, true, ply + 1, currentScore + scoreDelta, settings);
                
                state.undoSearchAction(undoInfo);

                if (result.score < minEval) {
                    minEval = result.score;
                    bestMove = move;
                }
                beta = Math.min(beta, result.score);
                if (beta <= alpha) break;
            }
            const r = { score: minEval, move: bestMove, depth, flag: minEval <= alphaOriginal ? 'UPPER' : (minEval >= beta ? 'LOWER' : 'EXACT') };
            this.transpositionTable.set(hash, r);
            return r;
        }
    }

    quiescence(state, alpha, beta, depth, maximizing, currentScore) {
        const standPat = currentScore;
        if (depth === 0 || state.phase === 'gameOver') return standPat;

        if (maximizing) {
            if (standPat >= beta) return beta;
            if (alpha < standPat) alpha = standPat;
        } else {
            if (standPat <= alpha) return alpha;
            if (beta > standPat) beta = standPat;
        }

        const color = maximizing ? this.color : this.opponentColor;
        const captures = this.generateCaptureMoves(state, color);
        if (captures.length === 0) return standPat;

        for (const move of captures) {
            const undoInfo = state.applySearchAction(move, this.minionLoader);
            if (!undoInfo) continue;
            const scoreDelta = this.getMoveDelta(state, move, maximizing);
            const score = this.quiescence(state, alpha, beta, depth - 1, !maximizing, currentScore + scoreDelta);
            state.undoSearchAction(undoInfo);
            
            if (maximizing) {
                if (score >= beta) return beta;
                alpha = Math.max(alpha, score);
            } else {
                if (score <= alpha) return alpha;
                beta = Math.min(beta, score);
            }
        }
        return maximizing ? alpha : beta;
    }

    getMoveDelta(state, move, maximizing) {
        let delta = 0;
        const color = maximizing ? this.color : this.opponentColor;
        const sign = maximizing ? 1 : -1;

        if (move.type === 'spawn') {
            const config = this.minionLoader.getConfig(move.cardId) || move;
            const val = (move.cardId === 'villager' || move.id === 'villager') ? 1000 : (config.cost || 1);
            delta += (this.weights.material || 10) * val;
            delta += (this.weights.pieceCount || 5);
        } else if (move.type === 'move') {
            const minion = state.minionRegistry.get(move.minionId);
            if (minion) {
                const fromRow = minion.position.row;
                const toRow = move.row;
                const adv = (color === 'red' ? (fromRow - toRow) : (toRow - fromRow));
                delta += (this.weights.advancement || 0.4) * adv;
                delta += (this.weights.centerControl || 0.5) * (Math.abs(minion.position.col - 3.5) - Math.abs(move.col - 3.5));
            }
        } else if (move.type === 'attack') {
            const target = state.getMinionAt(move.row, move.col);
            if (target) {
                const val = (target.id === 'villager' ? 10000 : (target.cost || 1));
                delta += (this.weights.material || 10) * val;
            }
        }
        return delta * sign;
    }

    evaluateState(state, color) {
        if (state.phase === 'gameOver') {
            return state.winner === color ? MATE_SCORE : -MATE_SCORE;
        }

        const features = this.extractFeatures(state, color);
        let score = 0;
        for (const key of this.weightKeys) {
            score += (this.weights[key] || 0) * (features[key] || 0);
        }
        
        if (this.evalNoise > 0) {
            score += (Math.random() - 0.5) * this.evalNoise;
        }
        
        return score;
    }

    extractFeatures(state, color) {
        const f = {};
        const op = color === 'red' ? 'blue' : 'red';
        const myV = state.players[color].villager;
        const opV = state.players[op].villager;

        let myMat = 0, opMat = 0, myCount = 0, opCount = 0;
        let myNearOpV = 0, opNearMyV = 0;
        let vInCheck = 0, opVInCheck = 0;

        for (const minion of state.minionRegistry.values()) {
            const isMine = minion.owner === color;
            const val = minion.id === 'villager' ? 1000 : (minion.cost || 1);
            
            if (isMine) {
                myMat += val; myCount++;
                if (opV && opV.position) {
                    const d = Board.getDistance(minion.position.row, minion.position.col, opV.position.row, opV.position.col);
                    if (d <= 3) myNearOpV++;
                    
                    const inst = state.rehydrateMinion(minion, this.minionLoader);
                    for (const atk of inst.getValidAttacks(state)) {
                        if (atk.row === opV.position.row && atk.col === opV.position.col) opVInCheck = 1;
                    }
                }
            } else {
                opMat += val; opCount++;
                if (myV && myV.position) {
                    const d = Board.getDistance(minion.position.row, minion.position.col, myV.position.row, myV.position.col);
                    if (d <= 3) opNearMyV++;
                    
                    const inst = state.rehydrateMinion(minion, this.minionLoader);
                    for (const atk of inst.getValidAttacks(state)) {
                        if (atk.row === myV.position.row && atk.col === myV.position.col) vInCheck = 1;
                    }
                }
            }
        }

        f.material = myMat - opMat;
        f.pieceCount = myCount - opCount;
        f.villagerThreat = opVInCheck ? 500 : 0;
        f.villagerExposure = vInCheck ? -1000 : 0;
        f.nearVillagerThreat = myNearOpV - opNearMyV;
        f.mobility = 0;

        return f;
    }

    orderMoves(moves, state, color, ply, hashMove) {
        for (const move of moves) {
            let score = 0;
            if (hashMove && this.isMoveEqual(move, hashMove)) {
                score = 1000000;
            } else if (move.type === 'attack') {
                const victim = state.getMinionAt(move.row, move.col);
                const attacker = state.minionRegistry.get(move.minionId);
                const victimVal = victim ? (victim.id === 'villager' ? 10000 : (victim.cost || 1)) : 0;
                const attackerVal = attacker ? (attacker.id === 'villager' ? 10000 : (attacker.cost || 1)) : 1;
                score = 500000 + (victimVal * 10) - attackerVal;
            } else if (ply < this.killerMoves.length) {
                if (this.isMoveEqual(move, this.killerMoves[ply][0])) score = 100000;
                else if (this.isMoveEqual(move, this.killerMoves[ply][1])) score = 90000;
            }
            const key = this.getMoveKey(move);
            score += (this.historyTable.get(key) || 0);
            move._score = score;
        }
        moves.sort((a, b) => b._score - a._score);
    }

    isMoveEqual(m1, m2) {
        if (!m1 || !m2) return false;
        return m1.type === m2.type && m1.row === m2.row && m1.col === m2.col && 
               (m1.minionId === m2.minionId || m1.index === m2.index);
    }

    getMoveKey(move) {
        return `${move.type}_${move.minionId || move.index || move.cardId}_${move.row}_${move.col}`;
    }

    generateAllMoves(state, color) {
        const moves = [];
        const player = state.players[color];
        const tm = new TurnManager(state);

        const spawnTiles = this.getSpawnTiles(color);
        for (let i = 0; i < player.hand.length; i++) {
            const card = player.hand[i];
            if (!ManaSystem.canAfford(player, card.cost)) continue;
            if (card.id === 'villager' && state.phase !== 'setup') continue;

            for (const tile of spawnTiles) {
                if (!state.board[tile.r][tile.c].minion) {
                    moves.push({ type: 'spawn', index: i, cardId: card.id, row: tile.r, col: tile.c, cost: card.cost });
                }
            }
        }

        for (const minion of state.minionRegistry.values()) {
            if (minion.owner !== color) continue;
            
            if (tm.canMinionMove(minion)) {
                const inst = state.rehydrateMinion(minion, this.minionLoader);
                for (const m of inst.getValidMoves(state))
                    moves.push({ type: 'move', minionId: minion.instanceId, row: m.row, col: m.col });
            }
            if (tm.canMinionAttack(minion)) {
                const inst = state.rehydrateMinion(minion, this.minionLoader);
                for (const a of inst.getValidAttacks(state))
                    moves.push({ type: 'attack', minionId: minion.instanceId, row: a.row, col: a.col });
            }
        }
        return moves;
    }

    generateCaptureMoves(state, color) {
        const moves = [];
        const tm = new TurnManager(state);
        for (const minion of state.minionRegistry.values()) {
            if (minion.owner === color && tm.canMinionAttack(minion)) {
                const inst = state.rehydrateMinion(minion, this.minionLoader);
                for (const a of inst.getValidAttacks(state))
                    moves.push({ type: 'attack', minionId: minion.instanceId, row: a.row, col: a.col });
            }
        }
        return moves;
    }

    getSpawnTiles(color) {
        const tiles = [];
        for (const r of Board.getSpawnRows(color)) {
            for (let c = 0; c < Board.COLS; c++) tiles.push({ r, c });
        }
        return tiles;
    }
}
