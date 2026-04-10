import { Board } from './Board.js';
import { Random } from './Random.js';

export class AIManager {
    static DIFFICULTY_PRESETS = {
        cautious: {
            spawnAttempts: 6,
            defendThreatThreshold: 1,
            riskTolerance: 0,
            topChoiceSpread: 1,
            villagerMustFullyEscape: true,
            villagerReductionNeeded: 1
        },
        balanced: {
            spawnAttempts: 5,
            defendThreatThreshold: 1,
            riskTolerance: 1,
            topChoiceSpread: 2,
            villagerMustFullyEscape: true,
            villagerReductionNeeded: 1
        },
        aggressive: {
            spawnAttempts: 4,
            defendThreatThreshold: 2,
            riskTolerance: 2,
            topChoiceSpread: 3,
            villagerMustFullyEscape: false,
            villagerReductionNeeded: 2
        }
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
        // AI's with less AI this time _IDK wat im doing (👉ﾟヮﾟ)👉
        if (this.game.gameState.currentPlayer !== this.color) return;

        // give a second to react
        await this.delay(800);

        // check if we are still in setup mode
        if (this.game.gameState.phase === 'setup') {
            await this.performSetup();
            this.game.endTurn();
            return;
        }

        // normal turn sequence
        await this.performSpawns();
        await this.performActions();

        // wrap it up
        await this.delay(500);
        this.game.endTurn();
    }

    async performSetup() {
        // pick the safest king tile in spawn zone
        const spawnZone = this.getSpawnTiles();
        const pos = this.getBestSetupPosition(spawnZone);

        // find the king in our pocket
        const hand = this.game.gameState.players[this.color].hand;
        const villagerIndex = hand.findIndex(c => c.id === 'villager');

        if (villagerIndex !== -1) {
            this.game.performSpawn(villagerIndex, pos.r, pos.c);
            await this.delay(500);
        }
    }

    async performSpawns() {
        // build an army, but protect king first
        let player = this.game.gameState.players[this.color];
        let attempts = 0;

        while (attempts < this.settings.spawnAttempts) {
            attempts++;
            const hand = player.hand;
            const villagerThreat = this.getVillagerThreatLevel();
            const defending = villagerThreat >= this.settings.defendThreatThreshold;

            const affordable = hand
                .map((card, index) => ({ card, index }))
                .filter(item => this.game.gameState.canAfford(item.card.cost));

            if (affordable.length === 0) break; // too broke

            const choice = this.getBestSpawnCard(affordable, defending);

            const spawnTiles = this.getSpawnTiles().filter(t => !this.game.gameState.getMinionAt(t.r, t.c));

            if (spawnTiles.length === 0) break; // no room left!

            const targetPos = this.getBestSpawnPosition(spawnTiles, defending);

            // summon them!
            if (this.game.performSpawn(choice.index, targetPos.r, targetPos.c)) {
                await this.delay(600);
            }

            player = this.game.gameState.players[this.color]; // refresh local state
        }
    }

    async performActions() {
        // command the troops
        let minions = this.game.gameState.getPlayerMinions(this.color);
        minions = Random.shuffleCopy(minions); // keep them guessing

        const villager = this.game.gameState.players[this.color].villager;
        const otherMinions = minions.filter(m => m.id !== 'villager');
        const ordered = villager ? [...otherMinions, villager] : otherMinions;

        for (const minion of ordered) {
            if (this.game.gameState.phase === 'gameOver') break;

            const currentThreat = this.getVillagerThreatLevel();

            if (minion.id === 'villager') {
                if (await this.performVillagerAction(minion, currentThreat)) {
                    continue;
                }
            }

            // can you hit anything?
            if (this.game.turnManager.canMinionAttack(minion)) {
                const instance = this.game.minionLoader.createSpecializedMinion(minion.id, minion.owner);
                Object.assign(instance, minion);
                const attacks = instance.getValidAttacks(this.game.gameState);

                if (attacks.length > 0) {
                    const target = this.getBestAttackTarget(attacks, currentThreat);

                    if (this.game.performAttack(minion, target.row, target.col)) {
                        await this.delay(600);
                        continue; // attacking usually ends your business for this minion
                    }
                }
            }

            // no one to hit? let's move
            if (this.game.turnManager.canMinionMove(minion)) {
                const instance = this.game.minionLoader.createSpecializedMinion(minion.id, minion.owner);
                Object.assign(instance, minion);
                const moves = instance.getValidMoves(this.game.gameState);

                if (moves.length > 0) {
                    const bestMove = this.getBestMove(minion, moves, currentThreat);

                    if (bestMove && this.game.performMove(minion, bestMove.row, bestMove.col)) {
                        await this.delay(600);
                    }
                }
            }
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getSpawnTiles() {
        const tiles = [];
        for (const r of Board.getSpawnRows(this.color)) {
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
            const threats = this.getThreatCountForPosition(pos.r, pos.c);
            const distFromEnemyBase = Math.abs(pos.r - enemyBaseRow);
            const edgeBias = Math.abs(pos.c - Math.floor(Board.COLS / 2));
            const score = threats * 100 - distFromEnemyBase - edgeBias * 0.25;

            if (score < bestScore) {
                bestScore = score;
                best = pos;
            }
        }

        return best || spawnZone[Math.floor(Math.random() * spawnZone.length)];
    }

    getBestSpawnCard(affordableCards, defending) {
        const peaceful = new Set(['pig', 'rabbit', 'frog', 'cat', 'sniffer', 'villager']);
        const scored = [];

        for (const item of affordableCards) {
            const card = item.card;
            let score = 0;

            if (!peaceful.has(card.id)) score += 8;
            if (defending) score += Math.max(0, 6 - (card.cost || 0));
            if (!defending) score += (card.cost || 0) * 0.5;
            if (card.id === 'villager') score -= 1000;
            scored.push({ item, score });
        }

        return this.pickTopScored(scored, s => s.score)?.item
            || affordableCards[Math.floor(Math.random() * affordableCards.length)];
    }

    getBestSpawnPosition(spawnTiles, defending) {
        const villager = this.game.gameState.players[this.color].villager;
        const candidateScores = spawnTiles.map(pos => {
            let score = 0;

            if (villager?.position) {
                const distToVillager = Board.getDistance(pos.r, pos.c, villager.position.row, villager.position.col);
                score += defending ? distToVillager : distToVillager * 0.2;
            }

            const threatAfterSpawn = this.getThreatLevelAfterTemporaryPlacement(pos.r, pos.c);
            score += threatAfterSpawn * 100;

            if (!defending) {
                const enemyVillager = this.game.gameState.players[this.opponentColor].villager;
                if (enemyVillager?.position) {
                    score += Board.getDistance(pos.r, pos.c, enemyVillager.position.row, enemyVillager.position.col) * 0.4;
                }
            }

            return { pos, score };
        });

        candidateScores.sort((a, b) => a.score - b.score);
        return candidateScores[0]?.pos || spawnTiles[Math.floor(Math.random() * spawnTiles.length)];
    }

    async performVillagerAction(villager, currentThreat) {
        if (!this.game.turnManager.canMinionMove(villager)) return false;
        if (currentThreat <= 0) return false;

        const instance = this.game.minionLoader.createSpecializedMinion(villager.id, villager.owner);
        Object.assign(instance, villager);
        const moves = instance.getValidMoves(this.game.gameState);
        if (moves.length === 0) return false;

        let bestMove = null;
        let bestThreat = currentThreat;

        for (const move of moves) {
            const threatAfter = this.getThreatLevelAfterMove(villager, move.row, move.col);
            if (threatAfter < bestThreat) {
                bestThreat = threatAfter;
                bestMove = move;
            }
        }

        const reduction = currentThreat - bestThreat;
        const needsFullEscape = this.settings.villagerMustFullyEscape;
        const meetsReduction = reduction >= this.settings.villagerReductionNeeded;
        const escapes = bestThreat === 0;
        const shouldMove = bestMove && ((needsFullEscape && escapes) || (!needsFullEscape && meetsReduction));

        if (shouldMove && this.game.performMove(villager, bestMove.row, bestMove.col)) {
            await this.delay(600);
            return true;
        }

        return false;
    }

    getBestAttackTarget(attacks, currentThreat) {
        const scored = [];

        for (const attack of attacks) {
            const target = attack.minion;
            let score = 0;
            if (!target) continue;

            if (target.id === 'villager') score += 1000;
            if (target.hasAttacked || target.hasMoved) score += 12;
            if (target.id === 'wither' || target.id === 'blaze' || target.id === 'skeleton_king') score += 10;
            score += target.cost || 0;
            if (currentThreat > 0 && target.id !== 'villager') score += 8;
            scored.push({ attack, score });
        }

        return this.pickTopScored(scored, s => s.score)?.attack || attacks[0];
    }

    getBestMove(minion, moves, currentThreat) {
        const ownVillager = this.game.gameState.players[this.color].villager;
        const enemyVillager = this.game.gameState.players[this.opponentColor].villager;

        let bestMove = null;
        let bestScore = Infinity;
        let fallbackMove = null;
        let fallbackThreat = Infinity;

        for (const move of moves) {
            const threatAfter = this.getThreatLevelAfterMove(minion, move.row, move.col);
            if (threatAfter < fallbackThreat) {
                fallbackThreat = threatAfter;
                fallbackMove = move;
            }
            if (threatAfter > currentThreat + this.settings.riskTolerance) continue;

            let score = threatAfter * 100;

            if (currentThreat > 0 && ownVillager?.position) {
                score += Board.getDistance(move.row, move.col, ownVillager.position.row, ownVillager.position.col) * 3;
            } else if (enemyVillager?.position) {
                score += Board.getDistance(move.row, move.col, enemyVillager.position.row, enemyVillager.position.col);
            }

            if (ownVillager?.position) {
                const guardDist = Board.getDistance(move.row, move.col, ownVillager.position.row, ownVillager.position.col);
                score += guardDist * 0.4;
            }

            if (score < bestScore) {
                bestScore = score;
                bestMove = move;
            }
        }

        return bestMove || fallbackMove || moves[Math.floor(Math.random() * moves.length)];
    }

    getVillagerThreatLevel() {
        const villager = this.game.gameState.players[this.color].villager;
        if (!villager?.position) return 0;
        return this.getThreatCountForPosition(villager.position.row, villager.position.col);
    }

    getThreatCountForPosition(row, col) {
        const gameState = this.game.gameState;
        const enemies = gameState.getPlayerMinions(this.opponentColor);
        let threats = 0;

        for (const enemy of enemies) {
            const enemyInstance = this.game.minionLoader.createSpecializedMinion(enemy.id, enemy.owner);
            Object.assign(enemyInstance, enemy);
            const attacks = enemyInstance.getValidAttacks(gameState);
            if (attacks.some(a => a.row === row && a.col === col)) {
                threats++;
            }
        }

        return threats;
    }

    getThreatLevelAfterTemporaryPlacement(row, col) {
        const gameState = this.game.gameState;
        if (gameState.getMinionAt(row, col)) return this.getVillagerThreatLevel();

        const placeholder = { id: '_placeholder', owner: this.color, position: { row, col } };
        gameState.board[row][col].minion = placeholder;
        try {
            return this.getVillagerThreatLevel();
        } finally {
            gameState.board[row][col].minion = null;
        }
    }

    getThreatLevelAfterMove(minion, toRow, toCol) {
        const gameState = this.game.gameState;
        const fromRow = minion.position.row;
        const fromCol = minion.position.col;

        const fromCell = gameState.board[fromRow][fromCol];
        const toCell = gameState.board[toRow][toCol];
        const prevAtDestination = toCell.minion;

        fromCell.minion = null;
        toCell.minion = minion;
        minion.position = { row: toRow, col: toCol };

        try {
            return this.getVillagerThreatLevel();
        } finally {
            minion.position = { row: fromRow, col: fromCol };
            fromCell.minion = minion;
            toCell.minion = prevAtDestination;
        }
    }

    pickTopScored(items, getScore) {
        if (!items || items.length === 0) return null;
        const sorted = [...items].sort((a, b) => getScore(b) - getScore(a));
        const spread = Math.max(1, this.settings.topChoiceSpread || 1);
        const pool = sorted.slice(0, spread);
        return pool[Math.floor(Math.random() * pool.length)];
    }

}

export default AIManager;
// This should work i think ^_~
