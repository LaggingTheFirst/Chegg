import { GameState } from '../js/engine/GameState.js';
import { TurnManager } from '../js/engine/TurnManager.js';
import { MinionLoader } from '../js/minions/MinionLoader.js';
import { AbilitySystem } from '../js/minions/AbilitySystem.js';
import { DeckManager } from '../js/engine/DeckManager.js';
import { Notation } from './Notation.js';

export class Room {
    constructor(id, wss, db, config = {}) {
        this.id = id;
        this.wss = wss;
        this.db = db;
        this.config = {
            name: config.name || id,
            timer: config.timer || 60, // default turn timer
            saveGame: config.saveGame !== false,
            ...config
        };

        this.players = []; // { socket, color, deck }
        this.spectators = []; // [socket]
        this.gameState = new GameState();
        this.turnManager = new TurnManager(this.gameState);
        this.minionLoader = new MinionLoader();
        this.abilitySystem = new AbilitySystem(this.gameState);

        this.playerTimes = {
            blue: config.matchTime || 900,
            red: config.matchTime || 900
        };
        this.timer = null;
        this.gameLog = []; // list of notation strings

        // hook up authoritative event stuff
        this.turnManager.onEvent = (eventName, data) => {
            this.broadcast('game_event', { eventName, data });
        };
    }

    addPlayer(socket, color, deck) {
        this.players.push({ socket, color, deck });
        this.send(socket, 'player_assigned', { color });
    }

    addSpectator(socket) {
        this.spectators.push(socket);
        this.send(socket, 'player_assigned', { color: 'spectator' });
        // Send current state
        this.send(socket, 'state_update', { state: this.gameState.serialize() });
        // Send timer if active
        if (this.timeLeft > 0) {
            this.send(socket, 'timer_tick', { timeLeft: this.timeLeft });
        }
    }

    isFull() {
        return this.players.length >= 2;
    }

    isEmpty() {
        return this.players.length === 0;
    }

    start() {
        // setup players
        for (const p of this.players) {
            const playerState = this.gameState.players[p.color];

            // 1. Initialize and SHUFFLE the deck
            playerState.deck = DeckManager.shuffle(DeckManager.createDeck(p.deck));

            // 2. Initialize hand with ONLY the Villager
            const villager = this.minionLoader.getConfig('villager');
            if (villager) {
                playerState.hand = [{ ...villager, deckCard: true }];
            } else {
                playerState.hand = [];
            }
        }

        this.turnManager.startGame();
        this.broadcastState();
        this.startTimer();
    }

    processAction(socket, data) {
        const player = this.players.find(p => p.socket.id === socket.id);
        if (!player || player.color !== this.gameState.currentPlayer) {
            return; // not your turn
        }

        // authoritative type shi
        let success = false;

        const { type, payload } = data;

        switch (type) {
            case 'SPAWN_MINION':
                success = this.handleSpawn(player.color, payload);
                break;
            case 'MOVE_MINION':
                success = this.handleMove(player.color, payload);
                break;
            case 'ATTACK_MINION':
                success = this.handleAttack(player.color, payload);
                break;
            case 'USE_ABILITY':
                success = this.handleAbility(player.color, payload);
                break;
            case 'END_TURN':
                success = this.handleEndTurn();
                break;
            // TODO: add ability support
        }

        if (success) {
            this.broadcastState();
            if (this.gameState.phase === 'gameOver') {
                this.stopTimer();
                this.calculateEloChange(this.gameState.winner);
                this.saveToDB();
            } else if (type === 'END_TURN') {
                this.saveToDB(); // save point after each turn
            }
        }
    }

    logAction(notation) {
        this.gameLog.push(notation);
        console.log(`[${this.id}] ${notation}`);
    }

    async saveToDB() {
        if (!this.config.saveGame) return;
        try {
            await this.db.put(`game:${this.id}`, {
                id: this.id,
                name: this.config.name,
                winner: this.gameState.winner,
                turns: this.gameState.turnNumber,
                log: this.gameLog,
                finalState: this.gameState.serialize(),
                timestamp: Date.now()
            });
        } catch (err) {
            console.error('LevelDB save error:', err);
        }
    }

    handleSpawn(color, payload) {
        // payload: { cardIndex, row, col }
        const { cardIndex, row, col } = payload;
        const playerState = this.gameState.players[color];
        const card = playerState.hand[cardIndex];

        if (!card) return false;
        if (!this.gameState.isSpawnZone(row, color)) return false;
        if (this.gameState.getMinionAt(row, col)) return false;
        if (playerState.mana < card.cost) return false;

        // execute
        playerState.mana -= card.cost;
        const minion = this.minionLoader.createSpecializedMinion(card.id, color);
        this.gameState.placeMinion(minion, row, col);
        playerState.hand.splice(cardIndex, 1);

        this.logAction(Notation.formatSpawn(color, row, col, card.id));

        if (minion.onSpawn) {
            minion.onSpawn(this.gameState);
        }

        return true;
    }

    handleMove(color, payload) {
        // payload: { minionId, toRow, toCol }
        const minion = this.gameState.minionRegistry.get(payload.minionId);
        if (!minion || minion.owner !== color) return false;
        if (minion.hasDashed) return false;

        // check if move is valid via engine logic
        const minionInstance = this.minionLoader.createSpecializedMinion(minion.id, color);
        Object.assign(minionInstance, minion);

        const validMoves = minionInstance.getValidMoves(this.gameState);
        const isValid = validMoves.some(m => m.row === payload.toRow && m.col === payload.toCol);

        if (!isValid) return false;

        // spend mana if needed (villager or dash)
        const needsDash = minion.hasMoved;
        const isVillager = minion.id === 'villager';
        let cost = 0;
        if (isVillager) cost = needsDash ? 2 : 1;
        else if (needsDash) cost = 1;

        if (this.gameState.players[color].mana < cost) return false;

        const oldPos = { ...minion.position };
        this.gameState.players[color].mana -= cost;
        this.gameState.moveMinion(minion, payload.toRow, payload.toCol);

        const type = needsDash ? 'dash' : 'move';
        this.logAction(Notation.formatAction(color, type, { from: oldPos, to: minion.position }, minion.id));

        if (needsDash) {
            this.turnManager.recordAction(minion, 'dash');
        } else {
            minion.hasMoved = true;
        }

        return true;
    }

    handleAttack(color, payload) {
        // payload: { attackerId, targetRow, targetCol }
        const minion = this.gameState.minionRegistry.get(payload.attackerId);
        if (!minion || minion.owner !== color) return false;

        const target = this.gameState.getMinionAt(payload.targetRow, payload.targetCol);
        if (!target || target.owner === color) return false;

        const minionInstance = this.minionLoader.createSpecializedMinion(minion.id, color);
        Object.assign(minionInstance, minion);

        const validAttacks = minionInstance.getValidAttacks(this.gameState);
        const isValid = validAttacks.some(a => a.row === payload.targetRow && a.col === payload.targetCol);

        if (!isValid) return false;

        const config = this.minionLoader.getConfig(minion.id);
        const cost = config.attackCost || 1;

        if (this.gameState.players[color].mana < cost) return false;

        const attackerId = minion.id;
        const oldPos = { ...minion.position };
        this.gameState.players[color].mana -= cost;

        // special creeper logic
        if (minion.id === 'creeper') {
            this.logAction(Notation.formatAction(color, 'attack', { from: oldPos, to: { row: payload.targetRow, col: payload.targetCol } }, attackerId));
            const { row, col } = minion.position;
            const positions = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
            for (const [dr, dc] of positions) {
                const t = this.gameState.getMinionAt(row + dr, col + dc);
                if (t) this.gameState.removeMinion(t);
            }
            this.gameState.removeMinion(minion);
        } else {
            this.logAction(Notation.formatAction(color, 'attack', { from: oldPos, to: { row: payload.targetRow, col: payload.targetCol } }, attackerId));
            this.gameState.removeMinion(target);
            this.turnManager.recordAction(minion, 'attack');
            if (minionInstance.movesToAttack) {
                this.gameState.moveMinion(minion, payload.targetRow, payload.targetCol);
            }
        }

        return true;
    }

    handleAbility(color, payload) {
        // payload: { minionId, targetRow, targetCol }
        const minion = this.gameState.minionRegistry.get(payload.minionId);
        if (!minion || minion.owner !== color) return false;

        if (!this.turnManager.canMinionUseAbility(minion)) return false;

        const config = this.minionLoader.getConfig(minion.id);
        const abilityId = config.abilities ? config.abilities[0] : null;
        if (!abilityId) return false;

        const ability = this.abilitySystem.get(abilityId);
        if (!ability) return false;

        const abilityCost = ability.cost !== undefined ? ability.cost : (config.abilityCost || 1);
        if (this.gameState.players[color].mana < abilityCost) return false;

        // Construct target data as AbilitySystem expects
        let targetData = null;
        if (payload.targetRow !== undefined) {
            // For teleport/pull/sweep, we need to map the row/col to the objects AbilitySystem expects
            const validTargets = this.abilitySystem.getValidTargets(minion, abilityId);
            targetData = validTargets.find(t => t.row === payload.targetRow && t.col === payload.targetCol);

            // Special handling for directional abilities like sweep
            if (!targetData && ability.getValidDirections) {
                const validDirs = ability.getValidDirections(minion, this.gameState);
                // In sweep, the click is on the "center" tile of the sweep
                targetData = validDirs.find(d => d.direction.row === (payload.targetRow - minion.position.row) && d.direction.col === (payload.targetCol - minion.position.col));
            }

            if (!targetData) {
                targetData = { row: payload.targetRow, col: payload.targetCol };
            }
        }

        const success = this.abilitySystem.execute(minion, abilityId, targetData);

        if (success) {
            this.gameState.players[color].mana -= abilityCost;
            this.logAction(Notation.formatAction(color, 'ability', { from: minion.position, to: { row: payload.targetRow, col: payload.targetCol } }, minion.id));
        }

        return success;
    }

    async calculateEloChange(winnerColor) {
        if (!this.config.isRanked) return;

        const bluePlayer = this.players.find(p => p.color === 'blue');
        const redPlayer = this.players.find(p => p.color === 'red');
        if (!bluePlayer || !redPlayer) return;

        const blueName = bluePlayer.socket.username;
        const redName = redPlayer.socket.username;
        if (!blueName || !redName) return;

        try {
            let blueProfile = await this.db.get(`user:${blueName}`);
            let redProfile = await this.db.get(`user:${redName}`);

            if (typeof blueProfile === 'string') blueProfile = JSON.parse(blueProfile);
            if (typeof redProfile === 'string') redProfile = JSON.parse(redProfile);

            const ratingA = blueProfile.elo || 1200;
            const ratingB = redProfile.elo || 1200;
            const scoreA = winnerColor === 'blue' ? 1 : 0;

            const K = 32; // volatility of the func
            const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
            const diff = Math.round(K * (scoreA - expectedA));

            blueProfile.elo = ratingA + diff;
            redProfile.elo = ratingB - diff;

            await this.db.put(`user:${blueName}`, blueProfile);
            await this.db.put(`user:${redName}`, redProfile);

            this.broadcast('rating_change', {
                blue: { username: blueName, oldElo: ratingA, newElo: blueProfile.elo, diff: diff },
                red: { username: redName, oldElo: ratingB, newElo: redProfile.elo, diff: -diff }
            });

            console.log(`[ELO] ${blueName} (${ratingA} -> ${blueProfile.elo}) | ${redName} (${ratingB} -> ${redProfile.elo})`);

        } catch (err) {
            console.error('Elo update error:', err);
        }
    }

    handleEndTurn() {
        this.turnManager.endTurn();
        this.broadcastState();
        this.resetTimer();
        return true;
    }

    forfeit(socket) {
        const player = this.players.find(p => p.socket.id === socket.id);
        if (player) {
            this.gameState.phase = 'gameOver';
            this.gameState.winner = player.color === 'blue' ? 'red' : 'blue';
            this.broadcast('game_over', { winner: this.gameState.winner, reason: 'forfeit' });
            this.broadcastState();
            this.stopTimer();
            this.calculateEloChange(this.gameState.winner);
            this.saveToDB();
        }
    }

    handlePlayerDisconnect(socket) {
        const disconnectedPlayer = this.players.find(p => p.socket.id === socket.id);
        this.players = this.players.filter(p => p.socket.id !== socket.id);
        // if game was active, other player wins
        if (disconnectedPlayer && (this.gameState.phase === 'playing' || this.gameState.phase === 'setup')) {
            const winner = disconnectedPlayer.color === 'blue' ? 'red' : 'blue';
            this.gameState.phase = 'gameOver';
            this.gameState.winner = winner;
            this.broadcast('game_over', { winner });
            this.broadcastState();
            this.calculateEloChange(winner);
            this.saveToDB();
            this.stopTimer();
        }
    }

    startTimer() {
        this.stopTimer();
        this.timer = setInterval(() => {
            const currentPlayer = this.gameState.currentPlayer;
            if (this.playerTimes[currentPlayer] > 0) {
                this.playerTimes[currentPlayer]--;

                // Broadcast both times
                this.broadcast('timer_tick', {
                    playerTimes: this.playerTimes,
                    currentPlayer
                });

                if (this.playerTimes[currentPlayer] <= 0) {
                    this.handleTimeOut(currentPlayer);
                }
            }
        }, 1000);
    }

    handleTimeOut(playerColor) {
        this.stopTimer();
        const winner = playerColor === 'blue' ? 'red' : 'blue';
        this.gameState.phase = 'gameOver';
        this.gameState.winner = winner;
        this.broadcast('game_over', { winner, reason: 'timeout' });
        this.broadcastState();
        this.calculateEloChange(winner);
        this.saveToDB();
    }

    resetTimer() {
        // No-op for Blitz clock as it's cumulative
    }

    stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    broadcastState() {
        const fullState = JSON.parse(this.gameState.serialize());

        // Add metadata to fullState (for spectators)
        const metadata = {
            blue: {
                username: this.players.find(p => p.color === 'blue')?.socket.username || 'Blue Player',
                elo: this.players.find(p => p.color === 'blue')?.socket.elo || 1200
            },
            red: {
                username: this.players.find(p => p.color === 'red')?.socket.username || 'Red Player',
                elo: this.players.find(p => p.color === 'red')?.socket.elo || 1200
            }
        };
        fullState.metadata = metadata;

        // Broadcast to players with masking
        for (const p of this.players) {
            const maskedState = JSON.parse(JSON.stringify(fullState));
            const opponent = p.color === 'blue' ? 'red' : 'blue';

            // Mask opponent's hand
            if (maskedState.players[opponent]) {
                maskedState.players[opponent].hand = maskedState.players[opponent].hand.map(() => ({ hidden: true }));
            }

            this.send(p.socket, 'state_update', { state: JSON.stringify(maskedState) });
        }

        // Broadcast to spectators (full state)
        for (const s of this.spectators) {
            this.send(s, 'state_update', { state: JSON.stringify(fullState) });
        }
    }

    send(socket, event, payload) {
        if (socket.readyState === 1) { // OPEN
            socket.send(JSON.stringify({ event, payload }));
        }
    }

    broadcast(event, payload) {
        const all = [...this.players.map(p => p.socket), ...this.spectators];
        for (const s of all) {
            this.send(s, event, payload);
        }
    }
}
