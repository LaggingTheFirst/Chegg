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
        this.history = [];
        this.evaluationScore = 0;
        this.metadata = { blue: {}, red: {} };
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

    applySearchAction(action, minionLoader) {
        const color = this.currentPlayer;
        const player = this.players[color];
        const undoInfo = {
            type: action.type,
            currentPlayer: color,
            mana: player.mana,
            phase: this.phase,
            winner: this.winner
        };

        if (action.type === 'spawn') {
            const card = player.hand[action.index];
            if (!card) return null; // Safety check for invalid heuristic moves
            undoInfo.card = { ...card };
            undoInfo.index = action.index;
            undoInfo.row = action.row;
            undoInfo.col = action.col;
            
            const minion = minionLoader.createSpecializedMinion(card.id, color);
            if (!minion) return null;
            this.placeMinion(minion, action.row, action.col);
            player.mana -= (card.cost || 0);
            player.hand.splice(action.index, 1);
            undoInfo.instanceId = minion.instanceId;
        } else if (action.type === 'move') {
            const minion = this.minionRegistry.get(action.minionId);
            if (!minion) return null;
            undoInfo.minionId = action.minionId;
            undoInfo.fromRow = minion.position.row;
            undoInfo.fromCol = minion.position.col;
            undoInfo.toRow = action.row;
            undoInfo.toCol = action.col;
            undoInfo.hasMoved = minion.hasMoved;

            const moveCost = ManaSystem.getMoveCost(minion);
            this.moveMinion(minion, action.row, action.col);
            player.mana -= moveCost;
        } else if (action.type === 'attack') {
            const minion = this.minionRegistry.get(action.minionId);
            const target = this.getMinionAt(action.row, action.col);
            
            undoInfo.minionId = action.minionId;
            undoInfo.fromRow = minion.position.row;
            undoInfo.fromCol = minion.position.col;
            undoInfo.toRow = action.row;
            undoInfo.toCol = action.col;
            undoInfo.hasAttacked = minion.hasAttacked;
            undoInfo.hasMoved = minion.hasMoved;
            
            if (target) {
                undoInfo.targetData = JSON.parse(JSON.stringify(target));
                this.removeMinion(target);
            }

            const attackCost = ManaSystem.getAttackCost(minion);
            player.mana -= attackCost;
            minion.hasAttacked = true;

            // Attack with move (if not skeleton)
            if (minion.id !== 'skeleton' && target) {
                this.moveMinion(minion, action.row, action.col);
            }
        }

        this.currentPlayer = this.getOpponent();
        return undoInfo;
    }

    undoSearchAction(undoInfo) {
        const player = this.players[undoInfo.currentPlayer];
        this.currentPlayer = undoInfo.currentPlayer;
        player.mana = undoInfo.mana;
        this.phase = undoInfo.phase;
        this.winner = undoInfo.winner;

        if (undoInfo.type === 'spawn') {
            const minion = this.minionRegistry.get(undoInfo.instanceId);
            this.board[undoInfo.row][undoInfo.col].minion = null;
            this.minionRegistry.delete(undoInfo.instanceId);
            player.hand.splice(undoInfo.index, 0, undoInfo.card);
        } else if (undoInfo.type === 'move') {
            const minion = this.minionRegistry.get(undoInfo.minionId);
            this.board[undoInfo.toRow][undoInfo.toCol].minion = null;
            this.board[undoInfo.fromRow][undoInfo.fromCol].minion = minion;
            minion.position = { row: undoInfo.fromRow, col: undoInfo.fromCol };
            minion.hasMoved = undoInfo.hasMoved;
        } else if (undoInfo.type === 'attack') {
            const minion = this.minionRegistry.get(undoInfo.minionId);
            
            // Revert move if attacker moved forward
            if (minion.id !== 'skeleton' && undoInfo.targetData) {
                this.board[undoInfo.toRow][undoInfo.toCol].minion = null;
                this.board[undoInfo.fromRow][undoInfo.fromCol].minion = minion;
                minion.position = { row: undoInfo.fromRow, col: undoInfo.fromCol };
            }
            
            minion.hasAttacked = undoInfo.hasAttacked;
            minion.hasMoved = undoInfo.hasMoved;

            if (undoInfo.targetData) {
                const target = undoInfo.targetData;
                this.board[target.position.row][target.position.col].minion = target;
                this.minionRegistry.set(target.instanceId, target);
                if (target.id === 'villager') {
                    this.players[target.owner].villager = target;
                }
            }
        }
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

        if (minion.onSpawn) {
            minion.onSpawn(this);
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

        if (minion.id === 'villager' && this.phase !== 'gameOver') {
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
        if (!minion || (minion.getValidMoves && minion.getValidAttacks)) return minion;
        if (!minionLoader) return minion;
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
            winner: this.winner,
            metadata: this.metadata
        });
    }

    clone(minionLoader) {
        const rawData = JSON.parse(this.serialize());
        const clonedState = new GameState();
        
        clonedState.currentPlayer = rawData.currentPlayer;
        clonedState.turnNumber = rawData.turnNumber;
        clonedState.phase = rawData.phase;
        clonedState.winner = rawData.winner;
        clonedState.nextMinionId = this.nextMinionId;

        for (const color of ['red', 'blue']) {
            const p = rawData.players[color];
            clonedState.players[color] = {
                color: p.color,
                mana: p.mana,
                maxMana: p.maxMana,
                hand: p.hand.map(c => ({...c})),
                deck: p.deck.map(c => ({...c})),
                villager: null,
                catBonusMana: p.catBonusMana
            };
        }

        for (let r = 0; r < Board.ROWS; r++) {
            for (let c = 0; c < Board.COLS; c++) {
                const minionData = rawData.board[r][c].minion;
                if (minionData) {
                    const instance = clonedState.rehydrateMinion(minionData, minionLoader);
                    clonedState.board[r][c].minion = instance;
                    clonedState.minionRegistry.set(instance.instanceId, instance);

                    if (instance.id === 'villager') {
                        clonedState.players[instance.owner].villager = instance;
                    }
                }
            }
        }
        
        return clonedState;
    }

    static fromJSON(rawData, minionLoader) {
        const state = new GameState();
        
        state.currentPlayer = rawData.currentPlayer;
        state.turnNumber = rawData.turnNumber;
        state.phase = rawData.phase;
        state.winner = rawData.winner;
        state.nextMinionId = rawData.nextMinionId || 1;
        state.metadata = rawData.metadata || { blue: {}, red: {} };

        for (const color of ['red', 'blue']) {
            const p = rawData.players[color];
            state.players[color] = {
                color: p.color,
                mana: p.mana,
                maxMana: p.maxMana,
                hand: (p.hand || []).map(c => ({...c})),
                deck: (p.deck || []).map(c => ({...c})),
                villager: null,
                catBonusMana: p.catBonusMana || 0
            };
        }

        for (let r = 0; r < Board.ROWS; r++) {
            for (let c = 0; c < Board.COLS; c++) {
                const minionData = rawData.board[r][c].minion;
                if (minionData) {
                    const instance = state.rehydrateMinion(minionData, minionLoader);
                    state.board[r][c].minion = instance;
                    state.minionRegistry.set(instance.instanceId, instance);

                    if (instance.id === 'villager') {
                        state.players[instance.owner].villager = instance;
                    }
                }
            }
        }
        
        return state;
    }
}

export default GameState;
