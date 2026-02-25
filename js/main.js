import { GameState } from './engine/GameState.js';
import { TurnManager } from './engine/TurnManager.js';
import { DeckManager } from './engine/DeckManager.js';
import { ManaSystem } from './engine/ManaSystem.js';
import { MinionLoader } from './minions/MinionLoader.js';
import { AbilitySystem } from './minions/AbilitySystem.js';
import { BoardUI } from './ui/BoardUI.js';
import { HandUI } from './ui/HandUI.js';
import { InfoPanel } from './ui/InfoPanel.js';
import { DeckBuilder } from './ui/DeckBuilder.js';
import { ModManager } from './mods/ModManager.js';
import { ModManagerUI } from './ui/ModManagerUI.js';
import { NetworkClient } from './multiplayer/NetworkClient.js';
import { AIManager } from './engine/AIManager.js';
//sorry yh ill have to touch all of this (._.) 
//if ur confused about why theres a lot of ASCII i like em :3 
class CheggGame {
    constructor() {
        this.gameState = null;
        this.turnManager = null;
        this.minionLoader = null;
        this.abilitySystem = null;
        this.modManager = null;
        this.networkClient = new NetworkClient(this);
        this.aiManager = null;

        // ui stuff
        this.boardUI = null;
        this.bluePanel = null;
        this.redPanel = null;
        this.blueHand = null;
        this.redHand = null;
        this.deckBuilder = null;
        this.modManagerUI = null;

        // current state
        this.mode = 'idle'; // idle, selectingSpawn, selectingMove, selectingAttack, selectingAbility
        this.aiEnabled = false;
        this.isOnline = false;
        this.playerColor = 'blue'; // blue by default for local
        this.selectedMinion = null;
        this.selectedCard = null;
        this.currentAbility = null;

        this.init();
    }

    async init() {
        this.minionLoader = new MinionLoader();
        this.modManager = new ModManager();
        this.modManagerUI = new ModManagerUI(this.modManager);

        // load externals via mod manager
        await this.modManager.loadAll();
        this.minionLoader.loadFromModManager(this.modManager);

        // expose export function
        window.exportBoard = () => this.gameState.exportBoardState();

        this.showStartScreen();
    }

    showStartScreen() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = 'start-screen';

        overlay.innerHTML = `
            <div class="modal" style="text-align: center; max-width: 450px;">
                <div class="modal-title" style="font-size: 2.5rem; margin-bottom: 8px;">
                    CHEGG
                </div>
                <div style="color: var(--text-secondary); margin-bottom: 24px;">
                    A turn based & deck building strategy game
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <button class="action-btn primary" id="btn-quick-start" style="width: 100%; padding: 12px;">
                        Quick Start (Local Decks)
                    </button>
                    <button class="action-btn secondary" id="btn-custom-local" style="width: 100%; padding: 12px;">
                        Custom Local Game
                    </button>
                    <div style="display: flex; gap: 4px; align-items: center; width: 100%;">
                        <button class="action-btn secondary" id="btn-matchmaking" style="flex: 1; padding: 12px; background: rgba(34, 197, 94, 0.2); border: 1px solid rgba(34, 197, 94, 0.5);">
                            Find Online Match
                        </button>
                        <div id="lobby-elo-badge" style="
                            display: ${this.networkClient.authManager.isAuthenticated() ? 'flex' : 'none'};
                            background: var(--bg-secondary);
                            border: 1px solid var(--border);
                            border-radius: 6px;
                            padding: 0 12px;
                            height: 42px;
                            align-items: center;
                            justify-content: center;
                            font-weight: 800;
                            color: var(--mana-color);
                            min-width: 60px;
                        ">${this.networkClient.authManager.elo}</div>
                    </div>
                    <button class="action-btn secondary" id="btn-vs-ai" style="width: 100%; padding: 12px; border: 1px solid var(--player-red);">
                        Play vs AI
                    </button>
                    <button class="action-btn secondary" id="btn-custom-online" style="width: 100%; padding: 12px;">
                        Custom Online Game
                    </button>
                    <button class="action-btn secondary" id="btn-profile" style="width: 100%; padding: 12px; background: rgba(168, 85, 247, 0.2); border: 1px solid rgba(168, 85, 247, 0.5);">
                        My Profile / Account
                    </button>
                    <button class="action-btn secondary" id="btn-custom-decks" style="width: 100%; padding: 12px;">
                        Deck Manager
                    </button>
                    <button class="action-btn secondary" id="btn-mods" style="width: 100%; padding: 12px; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.5);">
                        Mod Manager (${this.modManager.getLoadedMods().minions.length + this.modManager.getLoadedMods().abilities.length})
                    </button>
                </div>
                
                <div style="margin-top: 24px; font-size: 0.75rem; color: var(--text-muted);">
                    <p>Designed by Gerg • JS version • <a href="https://docs.google.com/document/d/1TM736HhNsh2nz8l3L-a6PuWAVxbnBSF__NB7qX7Wdlw/edit?tab=t.0" target="_blank">wtf are the rules?</a></p>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        overlay.querySelector('#btn-quick-start').addEventListener('click', () => {
            overlay.remove();
            this.startGameWithDefaultDecks();
        });

        overlay.querySelector('#btn-custom-local').addEventListener('click', () => {
            overlay.remove();
            this.startCustomLocalMatch();
        });

        overlay.querySelector('#btn-matchmaking').addEventListener('click', () => {
            if (!this.networkClient.authManager.isAuthenticated()) {
                this.showProfileModal(() => this.startMatchmaking());
                return;
            }
            this.startMatchmaking();
        });

        overlay.querySelector('#btn-custom-online').addEventListener('click', () => {
            this.showCustomOnlineMenu();
        });

        overlay.querySelector('#btn-vs-ai').addEventListener('click', () => {
            overlay.remove();
            this.startAiGame();
        });

        const btnProfile = overlay.querySelector('#btn-profile');
        btnProfile.addEventListener('click', () => {
            this.showProfileModal();
        });

        // Listen for auth success to update menu rank
        document.addEventListener('chegg:auth_success', (e) => {
            const { elo } = e.detail;
            const badge = overlay.querySelector('#lobby-elo-badge');
            if (badge) {
                badge.textContent = elo;
                badge.style.display = 'flex';
            }
            if (btnProfile) {
                btnProfile.textContent = `Account (${elo} Elo)`;
            }
        });

        // Listen for rating changes during/after game
        document.addEventListener('chegg:rating_change', (e) => {
            const auth = this.networkClient.authManager;
            const myName = auth.username;
            const myData = e.detail.blue.username === myName ? e.detail.blue : e.detail.red;

            const badge = overlay.querySelector('#lobby-elo-badge');
            if (badge) {
                badge.textContent = myData.newElo;
            }
            if (btnProfile) {
                btnProfile.textContent = `Account (${myData.newElo} Elo)`;
            }
        });

        overlay.querySelector('#btn-custom-decks').addEventListener('click', () => {
            overlay.remove();
            this.startDeckBuilding();
        });

        overlay.querySelector('#btn-mods').addEventListener('click', () => {
            this.modManagerUI.show();
        });
    }

    showCustomOnlineMenu() {
        if (!this.networkClient.authManager.isAuthenticated()) {
            this.showProfileModal(() => this.showCustomOnlineMenu());
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = 'online-menu';

        overlay.innerHTML = `
            <div class="modal" style="width: 600px;">
                <div class="modal-title">Custom Online Game</div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <div>
                        <h3 style="margin-bottom: 12px; font-size: 0.9rem;">Create Room</h3>
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            <input type="text" id="room-name" placeholder="Room Name" class="action-btn secondary" style="text-align: left; cursor: text;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 0.8rem;">Timer:</span>
                                <input type="number" id="room-timer" value="60" min="10" max="300" class="action-btn secondary" style="width: 70px; text-align: left; cursor: text;">
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="save-game" checked>
                                <label for="save-game" style="font-size: 0.8rem;">Save Game (LevelDB)</label>
                            </div>
                            <button class="action-btn primary" id="btn-do-create">Create & Join</button>
                        </div>
                    </div>
                    
                    <div>
                        <h3 style="margin-bottom: 12px; font-size: 0.9rem;">Active Rooms</h3>
                        <div id="room-list" style="max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;">
                            <div style="color: var(--text-muted); font-size: 0.8rem;">Loading rooms...</div>
                        </div>
                        <button class="action-btn secondary" id="btn-refresh-rooms" style="margin-top: 10px; width: 100%; font-size: 0.7rem;">Refresh</button>
                    </div>
                </div>
                
                <div style="margin-top: 20px; text-align: right;">
                    <button class="action-btn secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const refreshRooms = () => {
            const list = overlay.querySelector('#room-list');
            this.networkClient.getCustomRooms((rooms) => {
                list.innerHTML = rooms.length ? '' : '<div style="color: var(--text-muted); font-size: 0.8rem;">No rooms found</div>';
                rooms.forEach(room => {
                    const roomEl = document.createElement('div');
                    roomEl.className = 'room-item';
                    roomEl.style = 'display: flex; justify-content: space-between; align-items: center; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px;';
                    roomEl.innerHTML = `
                        <div style="flex: 1;">
                            <div style="font-size: 0.85rem; font-weight: 600;">${room.name}</div>
                            <div style="font-size: 0.7rem; color: var(--text-muted);">${room.players}/2 players • ${room.timer}s</div>
                        </div>
                        <div style="display: flex; gap: 4px;">
                            ${room.status === 'waiting' ? `<button class="action-btn primary" style="padding: 4px 8px; font-size: 0.7rem;" onclick="window.game.joinRoom('${room.id}')">Join</button>` : ''}
                            <button class="action-btn secondary" style="padding: 4px 8px; font-size: 0.7rem;" onclick="window.game.spectateRoom('${room.id}')">Spectate</button>
                        </div>
                    `;
                    list.appendChild(roomEl);
                });
            });
        };

        refreshRooms();
        overlay.querySelector('#btn-refresh-rooms').addEventListener('click', refreshRooms);

        overlay.querySelector('#btn-do-create').addEventListener('click', () => {
            const name = overlay.querySelector('#room-name').value || 'Chegg Room';
            const timer = parseInt(overlay.querySelector('#room-timer').value) || 60;
            const saveGame = overlay.querySelector('#save-game').checked;

            this.selectDeck((deck) => {
                this.networkClient.createCustomRoom(name, timer, deck, saveGame);
                overlay.remove();
            });
        });
    }

    joinRoom(roomId) {
        this.selectDeck((deck) => {
            this.networkClient.joinCustomRoom(roomId, deck);
            const menu = document.getElementById('online-menu');
            if (menu) menu.remove();
        });
    }

    spectateRoom(roomId) {
        this.networkClient.spectateRoom(roomId);
        const menu = document.getElementById('online-menu');
        if (menu) menu.remove();
    }

    startDeckBuilding() {
        this.deckBuilder = new DeckBuilder(this.minionLoader);

        // Standalone editor mode: just one builder, then return to menu
        this.deckBuilder.show('blue', (savedDeck) => {
            // After confirming, they've already had the chance to save it.
            // Just return to start screen.
            this.showStartScreen();
        });
    }

    startGameWithDefaultDecks() {
        const defaultDeck = DeckManager.createDefaultDeck(this.minionLoader);
        this.startGame(defaultDeck, [...defaultDeck]);
    }

    startCustomLocalMatch() {
        this.selectDeck((blueDeck) => {
            // delay to let the previous modal fade if any
            setTimeout(() => {
                this.selectDeck((redDeck) => {
                    this.startGame(blueDeck, redDeck);
                });
            }, 150);
        });
    }

    startAiGame() {
        this.aiEnabled = true;
        const defaultDeck = DeckManager.createDefaultDeck(this.minionLoader);
        this.startGame(defaultDeck, [...defaultDeck]);
    }

    startGame(blueDeck, redDeck, isOnline = false) {
        this.isOnline = isOnline;
        this.gameState = new GameState();
        this.turnManager = new TurnManager(this.gameState);
        this.abilitySystem = new AbilitySystem(this.gameState);
        this.abilitySystem.loadFromModManager(this.modManager);

        if (this.aiEnabled) {
            this.aiManager = new AIManager(this);
        }

        if (!isOnline) {
            this.playerColor = 'blue';
            // prep decks, shuffle happens inside
            DeckManager.initializePlayerDeck(this.gameState.players.blue, blueDeck);
            DeckManager.initializePlayerDeck(this.gameState.players.red, redDeck);

            // start with villager in hand
            const villagerCard = this.minionLoader.getConfig('villager');
            if (villagerCard) {
                this.gameState.players.blue.hand.unshift({ ...villagerCard, deckCard: true });
                this.gameState.players.red.hand.unshift({ ...villagerCard, deckCard: true });
            }
        }

        this.setupUI();

        if (!isOnline) {
            this.turnManager.startGame();
        }

        this.render();
    }

    setupUI() {
        const container = document.getElementById('game-container');
        container.innerHTML = `
            <header class="game-header">
                <div class="game-title">CHEGG</div>
                <div class="turn-indicator blue" id="turn-indicator">
                    <div class="player-dot"></div>
                    <span id="turn-text">Blue's Turn</span>
                </div>
                <div class="turn-number" id="turn-number">Turn 1</div>
            </header>
            
            <main class="game-main">
                <div id="blue-panel-container"></div>
                
                <div class="board-wrapper">
                    <div class="action-hint" id="action-hint"></div>
                    <div class="board-container" id="board-container"></div>
                    
                    <div id="current-hand-container"></div>
                    
                    <div class="action-bar">
                        <button class="action-btn secondary" id="btn-cancel">Cancel</button>
                        <button class="action-btn secondary" id="btn-forfeit" style="display: none;">Forfeit</button>
                        <button class="action-btn primary" id="btn-end-turn">End Turn</button>
                    </div>
                    
                    <div id="room-info" style="text-align: center; margin-top: 8px; color: var(--text-muted); font-size: 0.75rem;"></div>
                    <div id="turn-timer" style="text-align: center; font-weight: bold; color: var(--player-red); margin-top: 4px;"></div>
                </div>
                
                <div id="red-panel-container"></div>
            </main>
        `;

        this.boardUI = new BoardUI(this.gameState, '#board-container');
        this.boardUI.onTileClick = (row, col) => this.handleTileClick(row, col);
        this.boardUI.onMinionClick = (minion, row, col) => this.handleMinionClick(minion, row, col);

        this.bluePanel = new InfoPanel(this.gameState, '#blue-panel-container', 'blue');
        this.redPanel = new InfoPanel(this.gameState, '#red-panel-container', 'red');

        this.currentHand = new HandUI(this.gameState, '#current-hand-container', this.playerColor);
        this.currentHand.onCardClick = (card, index) => this.handleCardClick(card, index);

        document.getElementById('btn-cancel').addEventListener('click', () => this.cancelAction());
        document.getElementById('btn-end-turn').addEventListener('click', () => this.endTurn());
        document.getElementById('btn-forfeit').addEventListener('click', () => {
            if (confirm('Are you sure you want to forfeit?')) {
                if (this.isOnline) this.networkClient.forfeit();
            }
        });

        if (this.isOnline) {
            document.getElementById('btn-forfeit').style.display = 'block';
        }

        // clicking away cancels stuff
        document.getElementById('board-container').addEventListener('click', (e) => {
            if (e.target.id === 'board-container' || e.target.classList.contains('board')) {
                this.cancelAction();
            }
        });

        document.addEventListener('chegg:turnStart', (e) => this.onTurnStart(e.detail));
        document.addEventListener('chegg:turnEnd', (e) => this.onTurnEnd(e.detail));
    }

    placeVillagers() {
        // Obsolete
    }

    render() {
        this.boardUI.render();
        this.bluePanel.render();
        this.redPanel.render();
        this.currentHand.setPlayer(this.gameState.currentPlayer);

        const indicator = document.getElementById('turn-indicator');
        const turnText = document.getElementById('turn-text');
        const turnNumber = document.getElementById('turn-number');

        const currentPlayerName = this.gameState.metadata?.[this.gameState.currentPlayer]?.username || (this.gameState.currentPlayer === 'blue' ? 'Blue' : 'Red');
        if (indicator) indicator.className = `turn-indicator ${this.gameState.currentPlayer}`;
        if (turnText) turnText.textContent = `${currentPlayerName}'s Turn`;
        if (turnNumber) turnNumber.textContent = `Turn ${this.gameState.turnNumber}`;

        this.updateActionHint();
    }

    updateActionHint() {
        const hint = document.getElementById('action-hint');
        if (!hint) return;

        switch (this.mode) {
            case 'idle':
                if (this.gameState.phase === 'setup') {
                    hint.textContent = 'Placement Phase: Place your Villager/King on the board';
                } else {
                    hint.textContent = 'Select a card to spawn or a minion to command';
                }
                break;
            case 'selectingSpawn':
                hint.textContent = 'Click a tile in your spawn zone to place the minion';
                break;
            case 'selectingMove':
                hint.textContent = 'Green = move, Red = attack. Click elsewhere to cancel.';
                break;
            case 'selectingAbility':
                hint.textContent = `Select a target for ${this.currentAbility} ability`;
                break;
            default:
                hint.textContent = '';
        }
    }

    onTurnStart(detail) {
        this.mode = 'idle';
        this.selectedMinion = null;
        this.selectedCard = null;
        this.currentAbility = null;
        this.boardUI.clearHighlights();

        // Flip board if blue (since blue is row 0-1, normally top)
        // In online mode, we follow our assigned color
        const flip = this.isOnline ? (this.networkClient.color === 'blue') : (this.gameState.currentPlayer === 'blue');
        this.boardUI.setFlip(flip);

        this.render();

        if (this.aiEnabled && this.gameState.currentPlayer === 'red') {
            this.aiManager.performTurn();
        }
    }

    onTurnEnd(detail) {
        if (this.gameState.phase === 'gameOver') {
            this.showGameOver();
        }
    }

    handleCardClick(card, index) {
        if (this.isSpectator()) return;
        if (this.isOnline && this.gameState.currentPlayer !== this.playerColor) return;

        // too broke
        if (!ManaSystem.canAfford(this.gameState.players[this.gameState.currentPlayer], card.cost)) {
            return;
        }

        this.cancelAction();

        this.selectedCard = { card, index };
        this.currentHand.selectCard(index);
        this.mode = 'selectingSpawn';

        this.boardUI.highlightSpawnZone(this.gameState.currentPlayer);
        this.updateActionHint();
    }

    handleMinionClick(minion, row, col) {
        if (this.isSpectator()) return;
        if (this.isOnline && this.gameState.currentPlayer !== this.playerColor) return;
        if (this.mode === 'selectingAbility') {
            this.executeAbility(minion, row, col);
            return;
        }

        // clicking enemy = attack, clicking empty = move
        if (this.mode === 'selectingMove' && minion.owner !== this.gameState.currentPlayer) {
            this.handleTileClick(row, col);
            return;
        }

        if (minion.owner === this.gameState.currentPlayer) {
            // in online mode, only select your own minions on your turn
            if (this.isOnline && minion.owner !== this.playerColor) return;
            this.selectMinion(minion);
        }
    }

    selectMinion(minion) {
        this.cancelAction();

        // can't act same turn they spawn
        if (minion.justSpawned) {
            this.setHint('too dizzy to move this turn');
            return;
        }

        this.selectedMinion = minion;
        this.mode = 'selectingMove';

        this.boardUI.selectTile(minion.position.row, minion.position.col);

        const config = this.minionLoader.getConfig(minion.id);

        // dummy instance for logic
        const minionInstance = this.minionLoader.createSpecializedMinion(minion.id, minion.owner);
        Object.assign(minionInstance, minion);
        // Restore fresh movement config
        if (config.movement) {
            minionInstance.movement = config.movement;
        }

        if (this.turnManager.canMinionMove(minion)) {
            const moves = minionInstance.getValidMoves(this.gameState);
            this.boardUI.highlightMoves(moves);
        }

        // Show attack range preview if minion has an attack
        if (config.attack && !config.cannotAttack) {
            const positions = this.minionLoader.getAttackPreview(minion, this.gameState);
            if (positions) {
                this.boardUI.highlightAttackPreview(positions);
            }
        }

        if (this.turnManager.canMinionAttack(minion)) {
            const attacks = minionInstance.getValidAttacks(this.gameState);
            this.boardUI.highlightAttacks(attacks);
        }

        // handle abilities
        if (config.abilities && config.abilities.length > 0 && !minion.hasUsedAbility) {
            this.checkAndShowAbilityTargets(minion, config);
        }

        this.updateActionHint();
    }

    checkAndShowAbilityTargets(minion, config) {
        for (const ability of config.abilities) {
            const targets = this.abilitySystem.getValidTargets(minion, ability);
            if (targets.length > 0) {
                this.boardUI.highlightAbilityTargets(targets);
                this.currentAbility = ability;
                this.mode = 'selectingAbility';
            }
        }
    }

    handleTileClick(row, col) {
        if (this.isSpectator()) return;
        if (this.isOnline && this.gameState.currentPlayer !== this.playerColor) return;
        if (this.mode === 'selectingSpawn') {
            this.spawnMinion(row, col);
        } else if (this.mode === 'selectingMove' && this.selectedMinion) {
            const targetMinion = this.gameState.getMinionAt(row, col);

            // enemy = attack, empty = move
            if (targetMinion && targetMinion.owner !== this.gameState.currentPlayer) {
                this.attackMinion(row, col);
            } else if (!targetMinion) {
                this.moveMinion(row, col);
            }
        } else if (this.mode === 'selectingAbility' && this.selectedMinion) {
            const targetMinion = this.gameState.getMinionAt(row, col);

            if (targetMinion) {
                this.cancelAction();
                return;
            }

            const targets = this.abilitySystem.getValidTargets(this.selectedMinion, this.currentAbility);
            const isAbilityTarget = targets.some(t => t.row === row && t.col === col && !t.minion);

            if (isAbilityTarget) {
                this.executeAbility(null, row, col);
                return;
            }

            this.moveMinion(row, col);
        } else {
            this.cancelAction();
        }
    }

    performAbility(minion, row, col) {
        // doing something fancy...
        if (!this.turnManager.canMinionUseAbility(minion)) {
            this.setHint('This minion cannot use abilities');
            return false;
        }

        const config = this.minionLoader.getConfig(minion.id);
        const abilityCost = config.abilityCost || 1;

        if (!ManaSystem.canAfford(this.gameState.players[this.gameState.currentPlayer], abilityCost)) {
            this.setHint('too broke for this move');
            return false;
        }

        // is there a valid target?
        const targets = this.abilitySystem.getValidTargets(minion, this.currentAbility);
        const validTarget = targets.find(t =>
            (t.row === row && t.col === col) ||
            (t.minion && t.minion.position.row === row && t.minion.position.col === col)
        );

        if (!validTarget) {
            this.setHint('nothing there to hit');
            return false;
        }

        // unleash it!
        const success = this.abilitySystem.execute(minion, this.currentAbility, validTarget);

        if (success) {
            ManaSystem.spendMana(this.gameState.players[this.gameState.currentPlayer], abilityCost);
            minion.hasUsedAbility = true;
            minion.hasActedThisTurn = true;
        }

        this.render();
        return true;
    }

    executeAbility(targetMinion, row, col) {
        if (!this.selectedMinion || !this.currentAbility) return;

        const minion = this.selectedMinion;

        if (this.isOnline) {
            this.networkClient.sendAction('USE_ABILITY', {
                minionId: minion.instanceId,
                targetRow: row,
                targetCol: col
            });
            this.cancelAction();
            return;
        }

        if (this.performAbility(minion, row, col)) {
            this.cancelAction();
        }
    }

    performSpawn(cardIndex, row, col) {
        // trying to bring a new friend to the board
        const player = this.gameState.currentPlayer;
        const card = this.gameState.players[player].hand[cardIndex];

        if (!card) return false;

        if (!this.gameState.isSpawnZone(row, player)) {
            this.setHint('cant spawn in enemy territory');
            return false;
        }

        if (this.gameState.getMinionAt(row, col)) {
            this.setHint('tile is already taken');
            return false;
        }

        if (!ManaSystem.spendMana(this.gameState.players[player], card.cost)) {
            this.setHint('not enough mana to summon');
            return false;
        }

        // drop them in
        const minion = this.minionLoader.createSpecializedMinion(card.id, player);
        this.gameState.placeMinion(minion, row, col);

        // rip card from hand
        this.gameState.players[player].hand.splice(cardIndex, 1);
        if (minion.onSpawn) {
            minion.onSpawn(this.gameState);
        }

        this.render();
        this.boardUI.animateSpawn(row, col);
        return true;
    }

    spawnMinion(row, col) {
        if (!this.selectedCard) return;

        const { index } = this.selectedCard;

        if (this.isOnline) {
            this.networkClient.sendAction('SPAWN_MINION', { cardIndex: index, row, col });
            this.cancelAction();
            return;
        }

        if (this.performSpawn(index, row, col)) {
            this.cancelAction();
        }
    }

    performMove(minion, row, col) {
        // time to go for a walk
        if (!this.turnManager.canMinionMove(minion)) {
            this.setHint('this one is staying put');
            return false;
        }

        const needsDash = minion.hasMoved;

        // build a temporary instance for logic
        const minionInstance = this.minionLoader.createSpecializedMinion(minion.id, minion.owner);
        Object.assign(minionInstance, minion);
        const config = this.minionLoader.getConfig(minion.id);
        if (config.movement) {
            minionInstance.movement = config.movement;
        }

        // check if this move is actually okay
        const validMoves = minionInstance.getValidMoves(this.gameState);
        const isValidMove = validMoves.some(m => m.row === row && m.col === col);

        if (!isValidMove) {
            return false;
        }

        // pay the tax man
        let cost = minionInstance.getMoveCost();

        if (cost > 0 && !ManaSystem.spendMana(this.gameState.players[this.gameState.currentPlayer], cost)) {
            this.setHint('not enough bits for this move');
            return false;
        }

        const oldPos = { ...minion.position };
        this.gameState.moveMinion(minion, row, col);

        if (needsDash) {
            this.turnManager.recordAction(minion, 'dash');
        } else {
            minion.hasMoved = true;
        }

        // bunnies love jumping over things
        if (minion.id === 'rabbit') {
            const rabbitAbility = this.abilitySystem.get('drawOnJumpOver');
            if (rabbitAbility && rabbitAbility.checkTrigger(minion, oldPos, { row, col }, this.gameState)) {
                rabbitAbility.onTrigger(minion, this.gameState);
            }
        }

        this.render();
        return true;
    }

    moveMinion(row, col) {
        if (!this.selectedMinion) return;

        const minion = this.selectedMinion;

        if (this.isOnline) {
            this.networkClient.sendAction('MOVE_MINION', { minionId: minion.instanceId, toRow: row, toCol: col });
            this.cancelAction();
            return;
        }

        if (this.performMove(minion, row, col)) {
            this.cancelAction();
        } else if (this.selectedMinion) {
            this.selectedMinion = null;
            this.boardUI.clearHighlights();
            this.boardUI.render();
        }
    }

    performAttack(attacker, row, col) {
        // someone's looking for a fight...
        if (!this.turnManager.canMinionAttack(attacker)) {
            this.setHint('this minion cannot attack right now');
            return false;
        }

        const target = this.gameState.getMinionAt(row, col);
        if (!target || target.owner === attacker.owner) {
            this.setHint('no friendly fire!');
            return false;
        }

        const config = this.minionLoader.getConfig(attacker.id);
        const minionInstance = this.minionLoader.createSpecializedMinion(attacker.id, attacker.owner);
        Object.assign(minionInstance, attacker);

        const validAttacks = minionInstance.getValidAttacks(this.gameState);
        const isValidAttack = validAttacks.some(a => a.row === row && a.col === col);

        if (!isValidAttack) {
            this.setHint('cant reach that target');
            return false;
        }

        // pay the mana tax
        const cost = config.attackCost || ManaSystem.ATTACK_COST;
        if (!ManaSystem.spendMana(this.gameState.players[this.gameState.currentPlayer], cost)) {
            this.setHint('too broke to fight');
            return false;
        }

        // creepers are special... and explosive
        if (attacker.id === 'creeper' && config.attack && config.attack.selfDestruct) {
            this.executeCreeper(attacker);
            return true;
        }

        this.boardUI.animateAttack(attacker.position.row, attacker.position.col);
        this.boardUI.animateDeath(row, col);

        // wait for the flash of light
        setTimeout(() => {
            this.gameState.removeMinion(target);
            this.turnManager.recordAction(attacker, 'attack');

            if (minionInstance.movesToAttack) {
                this.gameState.moveMinion(attacker, row, col);
            }

            if (this.gameState.phase === 'gameOver') {
                this.showGameOver(); // rip
            }

            this.render();
        }, 150);

        return true;
    }

    attackMinion(row, col) {
        if (!this.selectedMinion) return;

        const attacker = this.selectedMinion;

        if (this.isOnline) {
            this.networkClient.sendAction('ATTACK_MINION', { attackerId: attacker.instanceId, targetRow: row, toCol: col });
            this.cancelAction();
            return;
        }

        if (this.performAttack(attacker, row, col)) {
            this.cancelAction();
        }
    }

    executeCreeper(minion) {
        const { row, col } = minion.position;
        const targets = [];
        const positions = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1], [0, 1],
            [1, -1], [1, 0], [1, 1]
        ];

        // boom, rip everyone nearby
        for (const [dr, dc] of positions) {
            const target = this.gameState.getMinionAt(row + dr, col + dc);
            if (target) targets.push(target);
        }

        this.boardUI.animateAttack(row, col);

        setTimeout(() => {
            for (const target of targets) {
                this.gameState.removeMinion(target);
            }
            this.gameState.removeMinion(minion);
            this.turnManager.recordAction(minion, 'attack');

            if (this.gameState.phase === 'gameOver') {
                this.showGameOver();
            }

            this.cancelAction();
            this.render();
        }, 150);
    }

    cancelAction() {
        this.mode = 'idle';
        this.selectedMinion = null;
        this.selectedCard = null;
        this.currentAbility = null;
        this.boardUI.clearHighlights();
        this.currentHand.clearSelection();
        this.updateActionHint();
    }

    endTurn() {
        if (this.isOnline) {
            this.networkClient.sendAction('END_TURN', {});
            this.cancelAction();
            return;
        }

        if (this.gameState.phase === 'setup') {
            const player = this.gameState.currentPlayer;
            const minions = Array.from(this.gameState.minionRegistry.values());
            const hasVillager = minions.find(m => m.id === 'villager' && m.owner === player);
            if (!hasVillager) {
                this.setHint('You must place your Villager first');
                return;
            }
        }
        this.cancelAction();
        this.turnManager.endTurn();
        this.render();
    }

    setHint(message) {
        const hint = document.getElementById('action-hint');
        hint.textContent = message;
        hint.style.color = 'var(--player-red)';

        // clear after 2s
        setTimeout(() => {
            hint.style.color = 'var(--text-secondary)';
            this.updateActionHint();
        }, 2000);
    }

    showGameOver() {
        const winner = this.gameState.winner;
        const winnerName = winner === 'blue' ? 'Blue Player' : 'Red Player';

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = 'game-over-screen';

        overlay.innerHTML = `
            <div class="modal game-over">
                <div class="game-over-title ${winner}">
                    ${winnerName} Wins!
                </div>
                <div class="game-over-subtitle">
                    The enemy Villager has been defeated after ${this.gameState.turnNumber} turns
                </div>
                <button class="action-btn primary" id="btn-play-again" style="padding: 12px 32px;">
                    Return to Menu
                </button>
            </div>
        `;

        document.body.appendChild(overlay);

        overlay.querySelector('#btn-play-again').addEventListener('click', () => {
            window.location.reload(); // back to clean slate
        });
    }

    selectDeck(onSelected) {
        const savedDecks = DeckManager.getSavedDeckNames();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.style.zIndex = '3000';

        let deckListHtml = '';
        if (savedDecks.length === 0) {
            deckListHtml = '<div style="color: var(--text-muted); margin: 20px 0;">No custom decks found.</div>';
        } else {
            deckListHtml = savedDecks.map(name => `
                <div style="display: flex; gap: 4px; margin-bottom: 8px;">
                    <button class="action-btn secondary" style="flex: 1; text-align: left;" onclick="this.closest('.modal-overlay').remove(); window.game._onDeckSelected('${name}')">
                        🂡 ${name}
                    </button>
                    <button class="action-btn danger" style="padding: 4px 10px;" onclick="window.game._onDeleteDeck('${name}')">Del</button>
                </div>
            `).join('');
        }

        overlay.innerHTML = `
            <div class="modal" style="width: 320px;">
                <div class="modal-title">Select Deck</div>
                <div style="margin: 20px 0; max-height: 300px; overflow-y: auto;">
                    <button class="action-btn primary" style="width: 100%; margin-bottom: 12px;" onclick="this.closest('.modal-overlay').remove(); window.game._onDeckSelected('default')">
                        Standard Starters
                    </button>
                    <div id="deck-list-container">
                        ${deckListHtml}
                    </div>
                </div>
                <button class="action-btn secondary" style="width: 100%;" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            </div>
        `;

        this._onDeckSelected = (name) => {
            const deckRaw = DeckManager.loadDeck(name, this.minionLoader);
            onSelected(deckRaw || DeckManager.createDefaultDeck(this.minionLoader));
        };

        this._onDeleteDeck = (name) => {
            if (confirm(`Delete deck "${name}"?`)) {
                DeckManager.deleteDeck(name);
                this.selectDeck(onSelected); // re-open to refresh
                overlay.remove();
            }
        };

        document.body.appendChild(overlay);
    }

    startMatchmaking() {
        this.selectDeck((deck) => {
            document.getElementById('start-screen').innerHTML = `
                <div class="modal" style="text-align: center;">
                    <div class="modal-title">Finding Match...</div>
                    <div class="preloader-spinner" style="margin: 20px auto;"></div>
                    <button class="action-btn secondary" onclick="window.location.reload()">Cancel</button>
                </div>
            `;
            this.networkClient.findMatch(deck);
        });
    }


    onServerStateUpdate(newStateData) {
        if (document.getElementById('start-screen')) {
            document.getElementById('start-screen').remove();
        }

        if (!this.gameState) {
            this.startGame([], [], true);
            this.playerColor = this.networkClient.color;
            if (this.playerColor === 'blue') {
                this.boardUI.setFlip(true);
            }
        }

        // map raw data back to engine state
        this.gameState.metadata = newStateData.metadata;
        this.gameState.currentPlayer = newStateData.currentPlayer;
        this.gameState.turnNumber = newStateData.turnNumber;
        this.gameState.phase = newStateData.phase;
        this.gameState.winner = newStateData.winner;
        this.gameState.board = newStateData.board;
        this.gameState.players = newStateData.players;

        // rebuild minion registry
        this.gameState.minionRegistry.clear();
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 8; c++) {
                const m = this.gameState.board[r][c].minion;
                if (m) {
                    this.gameState.minionRegistry.set(m.instanceId, m);
                }
            }
        }

        if (this.gameState.phase === 'gameOver') {
            this.showGameOver();
        }

        this.render();
    }

    updateTimer(data) {
        const { playerTimes, currentPlayer } = data;

        // Update the header timer for the active player
        const el = document.getElementById('turn-timer');
        if (el) {
            const time = playerTimes[currentPlayer];
            const mins = Math.floor(time / 60);
            const secs = time % 60;
            el.textContent = `${currentPlayer === 'blue' ? 'Blue' : 'Red'}: ${mins}:${secs.toString().padStart(2, '0')}`;
            if (time < 30) el.style.color = '#ef4444';
            else el.style.color = 'var(--text-muted)';
        }

        this.bluePanel.updateTimer(playerTimes.blue);
        this.redPanel.updateTimer(playerTimes.red);
    }

    showRatingChange(data) {
        const myName = this.networkClient.authManager.username;
        const result = (data.blue.username === myName) ? data.blue : data.red;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.style.zIndex = '2000';

        const color = result.diff >= 0 ? 'var(--player-blue)' : 'var(--player-red)';
        const sign = result.diff >= 0 ? '+' : '';

        overlay.innerHTML = `
            <div class="modal" style="width: 300px; text-align: center; border: 2px solid ${color};">
                <div class="modal-title">RANK UPDATED</div>
                <div style="font-size: 2.5rem; font-weight: 800; margin: 20px 0;">
                    ${result.newElo}
                </div>
                <div style="color: ${color}; font-weight: 600; font-size: 1.2rem; margin-bottom: 20px;">
                    ${sign}${result.diff} Rating
                </div>
                <p style="font-size: 0.8rem; color: var(--text-secondary);">
                    Match: vs ${data.blue.username === myName ? data.red.username : data.blue.username}
                </p>
                <button class="action-btn primary" style="width: 100%; margin-top: 20px;" onclick="location.reload()">Return to Menu</button>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    showError(message) {
        console.error('[GAME ERROR]', message);

        const toast = document.createElement('div');
        toast.className = 'error-toast';
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #ef4444;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            z-index: 10000;
            font-weight: 600;
            animation: slideIn 0.3s ease-out;
        `;
        toast.textContent = message;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease-in forwards';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    showProfileModal(onComplete) {
        const auth = this.networkClient.authManager;
        const creds = auth.getCredentials() || { username: '', token: '' };

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = 'profile-modal';

        overlay.innerHTML = `
            <div class="modal" style="width: 400px; text-align: center;">
                <div class="modal-title">Player Profile</div>
                <p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 20px;">
                    Your identity is secured by a Secret Token. Keep it safe to use your rank on other devices!
                </p>
                
                <div style="display: flex; flex-direction: column; gap: 15px; text-align: left;">
                    <div>
                        <label style="font-size: 0.75rem; color: var(--text-muted);">USERNAME</label>
                        <input type="text" id="prof-username" value="${creds.username}" class="action-btn secondary" style="width: 100%; text-align: left; cursor: text;" placeholder="Enter username...">
                    </div>
                    
                    <div>
                        <label style="font-size: 0.75rem; color: var(--text-muted);">SECRET TOKEN (DO NOT SHARE)</label>
                        <div style="display: flex; gap: 5px;">
                            <input type="password" id="prof-token" value="${creds.token}" class="action-btn secondary" style="width: 100%; text-align: left; cursor: text;" readonly>
                            <button class="action-btn secondary" id="btn-show-token" style="padding: 5px 10px;">👁️</button>
                        </div>
                    </div>

                    <div style="background: rgba(239, 68, 68, 0.1); padding: 10px; border-radius: 6px; border: 1px solid rgba(239, 68, 68, 0.3);">
                        <p style="font-size: 0.7rem; color: var(--player-red);">
                            <strong>Warning:</strong> Pasting a new token will overwrite your current account!
                        </p>
                        <button class="action-btn secondary" id="btn-import-token" style="font-size: 0.7rem; width: 100%; margin-top: 5px;">Import Existing Token</button>
                    </div>

                    <button class="action-btn primary" id="btn-save-profile" style="width: 100%; padding: 12px; margin-top: 10px;">Save & Connect</button>
                </div>

                <div style="margin-top: 15px;">
                    <button class="action-btn secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const tokenInput = overlay.querySelector('#prof-token');
        overlay.querySelector('#btn-show-token').addEventListener('click', () => {
            tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
        });

        overlay.querySelector('#btn-import-token').addEventListener('click', () => {
            const newToken = prompt('Paste your Secret Token here:');
            if (newToken) {
                tokenInput.value = newToken;
            }
        });

        overlay.querySelector('#btn-save-profile').addEventListener('click', () => {
            const username = overlay.querySelector('#prof-username').value.trim();
            const token = tokenInput.value.trim();

            if (!username) {
                alert('Please enter a username');
                return;
            }

            auth.setCredentials(username, token);
            this.networkClient.connect(); // Reconnect with new auth

            overlay.remove();
            if (onComplete) onComplete();
        });
    }

    isSpectator() {
        return this.playerColor === 'spectator';
    }
}

// entry point
document.addEventListener('DOMContentLoaded', () => {
    window.game = new CheggGame();
});

export default CheggGame;
