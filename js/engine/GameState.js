import { Board } from './Board.js';
import { ManaSystem } from './ManaSystem.js';

export class GameState {
    constructor() {
        this.board = this.createEmptyBoard();
        this.players = {
            red: this.createPlayerState('red'),
            blue: this.createPlayerState('blue')
        };
        this.currentPlayer = 'blue'; // blue always starts
        this.turnNumber = 0;
        this.phase = 'setup'; // setup, playing, gameOver
        this.winner = null;
        this.selectedMinion = null;
        this.selectedHandCard = null;
        this.actionMode = null; // null, 'move', 'attack', 'ability', 'spawn'
        this.minionRegistry = new Map(); // tracks all active instances
        this.nextMinionId = 1;
    }

    createEmptyBoard() {
        // board is 8x10
        // blue @ 0-1, red @ 8-9
        const board = [];
        for (let row = 0; row < Board.ROWS; row++) {
            const rowData = [];
            for (let col = 0; col < Board.COLS; col++) {
                rowData.push({
                    minion: null,
                    tileType: Board.getTileType(row, col),
                    isDark: (row + col) % 2 === 1 // phantoms love these
                });
            }
            board.push(rowData);
        }
        return board;
    }

    createPlayerState(color) {
        return {
            color,
            mana: 0,
            maxMana: 0,
            hand: [],
            deck: [],
            villager: null,
            catBonusMana: 0
        };
    }

    getOpponent() {
        return this.currentPlayer === 'red' ? 'blue' : 'red';
    }

    placeMinion(minion, row, col) {
        if (!this.isValidPosition(row, col)) return false;
        if (this.board[row][col].minion) return false;

        minion.instanceId = this.nextMinionId++;
        minion.position = { row, col };
        minion.justSpawned = true;

        this.board[row][col].minion = minion;
        this.minionRegistry.set(minion.instanceId, minion);

        if (minion.id === 'villager') {
            this.players[minion.owner].villager = minion;
        }

        return true;
    }

    moveMinion(minion, toRow, toCol) {
        const { row: fromRow, col: fromCol } = minion.position;

        this.board[fromRow][fromCol].minion = null;
        this.board[toRow][toCol].minion = minion;
        minion.position = { row: toRow, col: toCol };
        minion.hasMoved = true;

        return true;
    }

    removeMinion(minion) {
        const { row, col } = minion.position;
        this.board[row][col].minion = null;
        this.minionRegistry.delete(minion.instanceId);

        // rip king -> game over
        if (minion.id === 'villager') {
            this.phase = 'gameOver';
            this.winner = minion.owner === 'red' ? 'blue' : 'red';
        }

        if (minion.onDeath) {
            minion.onDeath(this);
        }
    }

    isValidPosition(row, col) {
        return Board.isValidPosition(row, col);
    }

    isSpawnZone(row, player) {
        return Board.isSpawnZone(row, player);
    }

    getMinionAt(row, col) {
        if (!this.isValidPosition(row, col)) return null;
        return this.board[row][col].minion;
    }

    rehydrateMinion(minion, minionLoader) {
        // wake up minion ... they're a bit confused
        if (!minion || !minionLoader) return minion;
        const config = minionLoader.getConfig(minion.id);
        if (!config) return minion; // i don't know what this thing is

        // build a fresh body
        const instance = minionLoader.createSpecializedMinion(minion.id, minion.owner);
        // stitch the old soul back in
        Object.assign(instance, minion);

        return instance;
    }

    startTurn() {
        this.turnNumber++;
        const player = this.players[this.currentPlayer];

        // Normal play starts after turn 1
        if (this.turnNumber > 1) {
            this.phase = 'playing';
            ManaSystem.refreshMana(player);
        } else {
            this.phase = 'setup';
            player.mana = 0;
            player.maxMana = 0;
        }

        // reset everyone
        this.resetMinionStatesForPlayer(this.currentPlayer);
    }

    endTurn() {
        this.currentPlayer = this.getOpponent();
        this.selectedMinion = null;
        this.selectedHandCard = null;
        this.actionMode = null;
        this.startTurn();
    }

    spendMana(amount) {
        const player = this.players[this.currentPlayer];
        return ManaSystem.spendMana(player, amount);
    }

    canAfford(cost) {
        return ManaSystem.canAfford(this.players[this.currentPlayer], cost);
    }

    drawCards(player, count) {
        const p = this.players[player];
        for (let i = 0; i < count; i++) {
            if (p.deck.length > 0) {
                p.hand.push(p.deck.pop());
            }
        }
    }

    drawFromOpponent(player, count) {
        const opponent = player === 'red' ? 'blue' : 'red';
        const p = this.players[player];
        const opp = this.players[opponent];

        for (let i = 0; i < count; i++) {
            if (opp.deck.length > 0) {
                p.hand.push(opp.deck.pop());
            }
        }
    }

    discardCards(player, count) {
        const p = this.players[player];
        for (let i = 0; i < count && p.hand.length > 0; i++) {
            p.hand.pop();
        }
    }

    getPlayerMinions(player) {
        const minions = [];
        this.minionRegistry.forEach(minion => {
            if (minion.owner === player) {
                minions.push(minion);
            }
        });
        return minions;
    }

    resetMinionStatesForPlayer(player) {
        this.minionRegistry.forEach(minion => {
            if (minion.owner === player) {
                minion.hasActedThisTurn = false;
                minion.hasMoved = false;
                minion.hasDashed = false;
                minion.hasAttacked = false;
                minion.hasUsedAbility = false;
                minion.justSpawned = false;
            }
        });
    }

    exportBoardState() {
        const rows = Array.from({ length: Board.ROWS }, (_, i) => String.fromCharCode(65 + i));
        // dump board to console
        console.log('=== BOARD EXPORT ===');

        // Print header
        console.log(`   ${Array.from({ length: Board.COLS }, (_, i) => i + 1).join(' ')}`);

        // Print grid
        for (let r = 0; r < Board.ROWS; r++) {
            let line = `${rows[r]}  `;
            for (let c = 0; c < Board.COLS; c++) {
                const minion = this.getMinionAt(r, c);
                if (!minion) {
                    line += '. ';
                } else {
                    // Start of name + owner indicator
                    const code = minion.name[0];
                    line += minion.owner === 'blue' ? code.toUpperCase() + ' ' : code.toLowerCase() + ' ';
                }
            }
            console.log(line);
        }

        // List details
        console.log('\nMinion Details:');
        this.minionRegistry.forEach(m => {
            if (m.position) {
                const r = rows[m.position.row];
                const c = m.position.col + 1;
                console.log(`[${r}${c}] ${m.name} (${m.owner}) - Cost: ${m.cost}`);
            }
        });

        // List Hands
        console.log('\nHands:');
        for (const color of ['blue', 'red']) {
            const hand = this.players[color].hand;
            // hand contains card objects (configs)
            const handStr = hand.map(c => c.name).join(', ') || '(empty)';
            console.log(`${color.toUpperCase()}: ${handStr}`);
        }
        console.log('====================');
    }

    serialize() {
        return JSON.stringify({
            board: this.board,
            players: this.players,
            currentPlayer: this.currentPlayer,
            turnNumber: this.turnNumber,
            phase: this.phase,
            winner: this.winner
        });
    }
}

export default GameState;
