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
        // find a spot for the king
        const spawnZone = [];
        for (let r = 8; r <= 9; r++) {
            for (let c = 0; c < 8; c++) {
                spawnZone.push({ r, c });
            }
        }
        const pos = spawnZone[Math.floor(Math.random() * spawnZone.length)];

        // find the king in our pocket
        const hand = this.game.gameState.players[this.color].hand;
        const villagerIndex = hand.findIndex(c => c.id === 'villager');

        if (villagerIndex !== -1) {
            this.game.performSpawn(villagerIndex, pos.r, pos.c);
            await this.delay(500);
        }
    }

    async performSpawns() {
        // let's build an army
        let player = this.game.gameState.players[this.color];
        let attempts = 0;

        while (attempts < 5) {
            attempts++;
            const hand = player.hand;
            // what can you actually afford?
            const affordable = hand
                .map((card, index) => ({ card, index }))
                .filter(item => this.game.gameState.canAfford(item.card.cost));

            if (affordable.length === 0) break; // too broke

            // pick something at random (for now...)
            const choice = affordable[Math.floor(Math.random() * affordable.length)];

            // find an empty tile in your backyard
            const spawnTiles = [];
            for (let r = 8; r <= 9; r++) {
                for (let c = 0; c < 8; c++) {
                    if (!this.game.gameState.getMinionAt(r, c)) {
                        spawnTiles.push({ r, c });
                    }
                }
            }

            if (spawnTiles.length === 0) break; // no room left!

            const targetPos = spawnTiles[Math.floor(Math.random() * spawnTiles.length)];

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
        this.shuffle(minions); // keep them guessing

        for (const minion of minions) {
            if (this.game.gameState.phase === 'gameOver') break;

            // can you hit anything?
            if (this.game.turnManager.canMinionAttack(minion)) {
                const instance = this.game.minionLoader.createSpecializedMinion(minion.id, minion.owner);
                Object.assign(instance, minion);
                const attacks = instance.getValidAttacks(this.game.gameState);

                if (attacks.length > 0) {
                    // is there a lethal move?
                    const lethal = attacks.find(a => a.minion && a.minion.id === 'villager');
                    const target = lethal || attacks[Math.floor(Math.random() * attacks.length)];

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
                    // find the enemy king and hunt him down
                    const opponentVillager = this.game.gameState.players[this.opponentColor].villager;
                    let bestMove = null;
                    let minDistance = Infinity;

                    if (opponentVillager && opponentVillager.position) {
                        for (const move of moves) {
                            const dist = Board.getDistance(move.row, move.col, opponentVillager.position.row, opponentVillager.position.col);
                            if (dist < minDistance) {
                                minDistance = dist;
                                bestMove = move;
                            }
                        }
                    } else {
                        // just wandering around...
                        bestMove = moves[Math.floor(Math.random() * moves.length)];
                    }

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

    shuffle(array) {
        // mixing the deck
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
}

export default AIManager;
// This should work i think ^_~