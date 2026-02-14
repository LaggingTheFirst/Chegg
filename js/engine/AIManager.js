import { ManaSystem } from './ManaSystem.js';
import { Board } from './Board.js';

export class AIManager {
    constructor(game) {
        this.game = game;
        this.color = 'red';
        this.opponentColor = 'blue';
        this.minionLoader = game.minionLoader;
        this.abilitySystem = game.abilitySystem;
    }

    async performTurn() {
        if (this.game.gameState.currentPlayer !== this.color) return;

        // Small delay at start of turn
        await this.delay(800);

        // 1. Setup Phase if needed
        if (this.game.gameState.phase === 'setup') {
            await this.performSetup();
            this.game.endTurn();
            return;
        }

        // 2. Spawn Phase
        await this.performSpawns();

        // 3. Action Phase
        await this.performActions();

        // 4. End Turn
        await this.delay(500);
        this.game.endTurn();
    }

    async performSetup() {
        // Find a random spot in spawn zone
        const spawnZone = [];
        for (let r = 8; r <= 9; r++) {
            for (let c = 0; c < 8; c++) {
                spawnZone.push({ r, c });
            }
        }
        const pos = spawnZone[Math.floor(Math.random() * spawnZone.length)];

        // Find villager in hand
        const hand = this.game.gameState.players[this.color].hand;
        const villagerIndex = hand.findIndex(c => c.id === 'villager');

        if (villagerIndex !== -1) {
            this.game.handleCardClick(hand[villagerIndex], villagerIndex);
            await this.delay(500);
            this.game.handleTileClick(pos.r, pos.c);
            await this.delay(500);
        }
    }

    async performSpawns() {
        let player = this.game.gameState.players[this.color];
        let attempts = 0;

        while (attempts < 5) {
            attempts++;
            const hand = player.hand;
            const affordable = hand
                .map((card, index) => ({ card, index }))
                .filter(item => ManaSystem.canAfford(player, item.card.cost));

            if (affordable.length === 0) break;

            // Pick a random affordable card
            const choice = affordable[Math.floor(Math.random() * affordable.length)];

            // Find a random empty spawn tile
            const spawnTiles = [];
            for (let r = 8; r <= 9; r++) {
                for (let c = 0; c < 8; c++) {
                    if (!this.game.gameState.getMinionAt(r, c)) {
                        spawnTiles.push({ r, c });
                    }
                }
            }

            if (spawnTiles.length === 0) break;

            const targetPos = spawnTiles[Math.floor(Math.random() * spawnTiles.length)];

            this.game.handleCardClick(choice.card, choice.index);
            await this.delay(400);
            this.game.handleTileClick(targetPos.r, targetPos.c);
            await this.delay(400);

            player = this.game.gameState.players[this.color]; // Refresh state
        }
    }

    async performActions() {
        const minions = this.game.gameState.getPlayerMinions(this.color);

        // Shuffle minions to make behavior less predictable
        this.shuffle(minions);

        for (const minion of minions) {
            if (this.game.gameState.phase === 'gameOver') break;

            // Skip stationary minions for move evaluation (redundant but safer)
            if (minion.id === 'villager') {
                // However, check for attacks if it can attack? 
                // Rules say "The villager can move and attack in the 8 squares surrounding it"
                // If movement is disabled, maybe it can still attack?
                // But the user said "cant move the villager once placed".
                // I'll keep attack logic for villager just in case it can still whack adjacent tiles.
            }

            // 1. Check for Attacks
            if (this.game.turnManager.canMinionAttack(minion)) {
                const config = this.minionLoader.getConfig(minion.id);
                const minionInstance = this.minionLoader.createSpecializedMinion(minion.id, minion.owner);
                Object.assign(minionInstance, minion);

                const validAttacks = minionInstance.getValidAttacks(this.game.gameState);
                if (validAttacks.length > 0) {
                    // Check for lethal
                    const lethal = validAttacks.find(a => a.minion && a.minion.id === 'villager');
                    const target = lethal || validAttacks[Math.floor(Math.random() * validAttacks.length)];

                    this.game.handleMinionClick(minion, minion.position.row, minion.position.col);
                    await this.delay(400);
                    this.game.handleTileClick(target.row, target.col);
                    await this.delay(500);
                    continue; // Skip moving if attacked
                }
            }

            // 2. Check for Moves
            if (this.game.turnManager.canMinionMove(minion)) {
                const config = this.minionLoader.getConfig(minion.id);
                const minionInstance = this.minionLoader.createSpecializedMinion(minion.id, minion.owner);
                Object.assign(minionInstance, minion);

                const validMoves = minionInstance.getValidMoves(this.game.gameState);
                if (validMoves.length > 0) {
                    // Evaluation: pick move closest to enemy villager
                    const opponentVillager = this.game.gameState.players[this.opponentColor].villager;
                    let bestMove = null;
                    let minDistance = Infinity;

                    if (opponentVillager && opponentVillager.position) {
                        for (const move of validMoves) {
                            const dist = Board.getDistance(move.row, move.col, opponentVillager.position.row, opponentVillager.position.col);
                            if (dist < minDistance) {
                                minDistance = dist;
                                bestMove = move;
                            }
                        }
                    } else {
                        // Just move randomly if no king (shouldn't happen)
                        bestMove = validMoves[Math.floor(Math.random() * validMoves.length)];
                    }

                    if (bestMove) {
                        this.game.handleMinionClick(minion, minion.position.row, minion.position.col);
                        await this.delay(400);
                        this.game.handleTileClick(bestMove.row, bestMove.col);
                        await this.delay(500);
                    }
                }
            }
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
}

export default AIManager;
