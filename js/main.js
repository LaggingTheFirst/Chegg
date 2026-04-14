import { GameState } from './engine/GameState.js';
import { TurnManager } from './engine/TurnManager.js';
import { DeckManager } from './engine/DeckManager.js';
import { ManaSystem } from './engine/ManaSystem.js';
import { Board } from './engine/Board.js';
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
import { createModalOverlay } from './ui/Modal.js';
import { RankSystem } from './ui/RankSystem.js';
import { API_URL } from './config.js';

//sorry yh ill have to touch all of this (._.) 

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
        this.aiDifficulty = this.getSavedAiDifficulty();
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
        this.rankSystem = new RankSystem();

        await this.rankSystem.load();
        console.log('[RankSystem] Loaded rank configuration');

        // load externals via mod manager
        await this.modManager.loadAll();
        this.minionLoader.loadFromModManager(this.modManager);

        // expose export function
        window.exportBoard = () => this.gameState.exportBoardState();

        // Check if joining tournament match
        const tournamentJoin = localStorage.getItem('tournament_join');
        if (tournamentJoin) {
            localStorage.removeItem('tournament_join');
            const { tournamentId, username } = JSON.parse(tournamentJoin);
            this.joinTournamentMatch(tournamentId, username);
        } else {
            this.showStartScreen();
        }
    }

    joinTournamentMatch(tournamentId, username) {
        const overlay = createModalOverlay({ id: 'tournament-join' });
        overlay.innerHTML = `
            <div class="modal" style="text-align: center;">
                <div class="modal-title">Joining Tournament Match...</div>
                <div class="preloader-spinner" style="margin: 20px auto;"></div>
                <button class="action-btn secondary" onclick="window.location.href='tournament.html'">Cancel</button>
            </div>
        `;
        document.body.appendChild(overlay);

        this.selectDeck((deck) => {
            this.networkClient.connect();
            // Wait for connection
            const checkConnection = setInterval(() => {
                if (this.networkClient.socket && this.networkClient.socket.readyState === 1) {
                    clearInterval(checkConnection);
                    this.networkClient.joinTournamentMatch(tournamentId, username, deck);
                }
            }, 100);
        });
    }

    showStartScreen() {
        const container = document.getElementById('game-container');
        const aiDifficulty = this.aiDifficulty;

        container.innerHTML = `
            <div class="start-screen-container">
                <div class="start-screen-content">
                    <div class="start-screen-title">CHEGG</div>
                    <div class="start-screen-subtitle">A turn based & deck building strategy game</div>
                    
                    <div class="start-screen-buttons">
                        <button class="action-btn primary" id="btn-custom-local">
                            Play Local Game
                        </button>
                        <button class="action-btn primary" id="btn-matchmaking">
                            Find Online Match
                        </button>
                        <div style="display: flex; gap: 8px; align-items: center; width: 100%;">
                            <button class="action-btn primary" id="btn-vs-ai" style="flex: 1; width: 45%;">
                                Play vs AI
                            </button>
                            <select id="ai-difficulty" class="action-btn secondary" style="width: 45%; text-align: left; cursor: pointer;">
                                <option value="cautious" ${aiDifficulty === 'cautious' ? 'selected' : ''}>Cautious</option>
                                <option value="balanced" ${aiDifficulty === 'balanced' ? 'selected' : ''}>Balanced</option>
                                <option value="aggressive" ${aiDifficulty === 'aggressive' ? 'selected' : ''}>Aggressive</option>
                            </select>
                        </div>
                        <button class="action-btn secondary" id="btn-custom-online">
                            Sandbox Mode
                        </button>
                        <button class="action-btn secondary" id="btn-profile">
                            My Profile
                        </button>
                        <button class="action-btn secondary" id="btn-leaderboard">
                            Leaderboard
                        </button>
                        <button class="action-btn secondary" id="btn-tournaments">
                            Tournaments
                        </button>
                        <button class="action-btn secondary" id="btn-custom-decks">
                            Deck Manager
                        </button>
                        <button class="action-btn secondary" id="btn-mods">
                            Mod Manager (${this.modManager.getLoadedMods().minions.length + this.modManager.getLoadedMods().abilities.length})
                        </button>
                    </div>
                    
                    <div class="start-screen-footer">
                        <p>Designed by Gerg • Jiyath5516F/Minecraft-CSS • <a href="https://docs.google.com/document/d/1TM736HhNsh2nz8l3L-a6PuWAVxbnBSF__NB7qX7Wdlw/edit?tab=t.0" target="_blank">wtf are the rules?</a></p>
                    </div>
                </div>
            </div>
        `;

        container.querySelector('#btn-custom-local').addEventListener('click', () => {
            this.startCustomLocalMatch();
        });

        container.querySelector('#btn-matchmaking').addEventListener('click', () => {
            if (!this.networkClient.authManager.isAuthenticated()) {
                this.showProfileModal(() => this.startMatchmaking());
                return;
            }
            this.startMatchmaking();
        });

        container.querySelector('#btn-custom-online').addEventListener('click', () => {
            this.startSandboxMode();
        });

        container.querySelector('#btn-vs-ai').addEventListener('click', () => {
            const aiDiffEl = container.querySelector('#ai-difficulty');
            const selectedDifficulty = aiDiffEl ? aiDiffEl.value : this.aiDifficulty;
            this.setAiDifficulty(selectedDifficulty);
            this.startAiGame(selectedDifficulty);
        });

        const btnProfile = container.querySelector('#btn-profile');
        btnProfile.addEventListener('click', () => {
            this.showProfileModal();
        });

        container.querySelector('#btn-leaderboard').addEventListener('click', () => {
            window.location.href = 'leaderboard.html';
        });

        container.querySelector('#btn-tournaments').addEventListener('click', () => {
            window.location.href = 'tournament.html';
        });

        container.querySelector('#btn-custom-decks').addEventListener('click', () => {
            this.startDeckBuilding();
        });

        container.querySelector('#btn-mods').addEventListener('click', () => {
            this.modManagerUI.show();
        });
    }

    startSandboxMode() {
        // Initialize game state without decks
        this.isOnline = false;
        this.sandboxMode = true; // Set this early
        this.gameState = new GameState();
        this.turnManager = new TurnManager(this.gameState);
        this.abilitySystem = new AbilitySystem(this.gameState);
        this.abilitySystem.loadFromModManager(this.modManager);

        // Don't initialize decks or hands - pure sandbox
        this.gameState.players.blue.hand = [];
        this.gameState.players.red.hand = [];
        this.gameState.players.blue.deck = [];
        this.gameState.players.red.deck = [];
        
        // Give infinite mana
        this.gameState.players.blue.mana = 999;
        this.gameState.players.red.mana = 999;
        this.gameState.players.blue.maxMana = 999;
        this.gameState.players.red.maxMana = 999;

        this.setupSandboxUI();
        this.enableSandboxMode();
    }

    setupSandboxUI() {
        const container = document.getElementById('game-container');
        container.innerHTML = `
            <header class="game-header">
                <div class="game-title">SANDBOX MODE</div>
                <div style="color: var(--text-secondary); font-size: 0.9rem;">Place and move minions freely</div>
                <div class="header-actions">
                    <button class="action-btn secondary btn-compact" id="btn-flip-board">Flip Board</button>
                    <button class="action-btn secondary btn-compact" id="btn-clear-board">Clear Board</button>
                    <button class="action-btn danger btn-compact" id="btn-exit-sandbox">Exit Sandbox</button>
                </div>
            </header>
            
            <main class="game-main">
                <div class="board-wrapper">
                    <div class="board-container" id="board-container"></div>
                </div>
            </main>
        `;

        this.boardUI = new BoardUI(this.gameState, '#board-container');
        this.boardUI.sandboxMode = true; // Tell BoardUI we're in sandbox
        this.boardUI.render();

        document.getElementById('btn-flip-board').addEventListener('click', () => {
            this.boardUI.setFlip(!this.boardUI.flipped);
            this.boardUI.render();
        });

        document.getElementById('btn-clear-board').addEventListener('click', () => {
            if (confirm('Clear all minions from the board?')) {
                for (const minion of Array.from(this.gameState.minionRegistry.values())) {
                    this.gameState.removeMinion(minion);
                }
                this.boardUI.render();
            }
        });

        document.getElementById('btn-exit-sandbox').addEventListener('click', () => {
            window.location.reload();
        });
    }

    enableSandboxMode() {
        this.sandboxMode = true;
        this.selectedSandboxMinion = null;

        // Add sandbox panel
        const sandboxPanel = document.createElement('div');
        sandboxPanel.id = 'sandbox-panel';
        sandboxPanel.style.cssText = `
            position: fixed;
            right: 20px;
            top: 80px;
            background: var(--bg-card);
            border: 2px solid var(--border);
            border-radius: 0px;
            padding: 16px;
            width: 280px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 8px 16px rgba(0, 0, 0, 0.4);
            z-index: 100;
        `;

        sandboxPanel.innerHTML = `
            <div style="font-weight: 700; margin-bottom: 12px; color: var(--mana-color); font-size: 1.1rem;">Place Minions</div>
            <div style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 12px;">Click a minion, then click the board to place it</div>
            
            <div style="margin-bottom: 12px;">
                <label style="display: block; font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 4px;">Owner:</label>
                <select id="sandbox-owner" style="width: 100%; padding: 8px; background: var(--bg-panel); border: 2px solid var(--border); border-radius: 0px;">
                    <option value="blue">Blue</option>
                    <option value="red">Red</option>
                </select>
            </div>

            <button class="action-btn secondary" id="sandbox-deselect" style="width: 100%; padding: 8px; font-size: 0.85rem; margin-bottom: 12px;">Deselect (Move Mode)</button>

            <div id="minion-list" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;"></div>
        `;

        document.body.appendChild(sandboxPanel);

        // Populate minion buttons
        const minionList = document.getElementById('minion-list');
        
        console.log('[SANDBOX] Minion loader:', this.minionLoader);
        console.log('[SANDBOX] Available minions:', this.minionLoader.configs);
        
        if (!this.minionLoader.configs || this.minionLoader.configs.size === 0) {
            minionList.innerHTML = '<div style="color: var(--player-red); font-size: 0.85rem; grid-column: 1 / -1;">No minions loaded!</div>';
            return;
        }
        
        const allMinions = Array.from(this.minionLoader.configs.keys()).sort();
        console.log('[SANDBOX] Creating buttons for:', allMinions);
        
        allMinions.forEach(id => {
            const config = this.minionLoader.getConfig(id);
            if (!config) {
                console.warn('[SANDBOX] No config for:', id);
                return;
            }
            
            const btn = document.createElement('button');
            btn.className = 'action-btn secondary';
            btn.style.cssText = `
                padding: 8px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 4px;
                min-height: 70px;
                position: relative;
            `;
            
            // Create image element
            const img = document.createElement('img');
            const imgPath = `assets/minions/${config.image || id + '.png'}`;
            img.src = imgPath;
            img.style.cssText = 'width: 32px; height: 32px; object-fit: contain;';
            img.onerror = () => {
                // Fallback to text initials if image fails
                img.style.display = 'none';
                const fallback = document.createElement('div');
                fallback.textContent = (config.name || id).substring(0, 3).toUpperCase();
                fallback.style.cssText = 'font-size: 0.9rem; font-weight: 700;';
                btn.insertBefore(fallback, btn.firstChild);
            };
            
            // Create label
            const label = document.createElement('div');
            label.textContent = config.name || id;
            label.style.cssText = 'font-size: 0.65rem; text-align: center; line-height: 1.1; max-width: 100%; overflow: hidden; text-overflow: ellipsis;';
            
            btn.appendChild(img);
            btn.appendChild(label);
            
            btn.onclick = () => {
                // Deselect all
                minionList.querySelectorAll('button').forEach(b => {
                    b.classList.remove('primary');
                    b.classList.add('secondary');
                });
                // Select this one
                btn.classList.remove('secondary');
                btn.classList.add('primary');
                this.selectedSandboxMinion = id;
                console.log('[SANDBOX] Selected:', id);
            };
            minionList.appendChild(btn);
        });

        console.log('[SANDBOX] Created', minionList.children.length, 'minion buttons');

        // Deselect button
        document.getElementById('sandbox-deselect').addEventListener('click', () => {
            this.selectedSandboxMinion = null;
            this.selectedMinionToMove = null;
            this.sandboxAbilityMode = false;
            this.currentAbility = null;
            this.boardUI.clearHighlights();
            this.boardUI.render();
            
            // Deselect all minion buttons
            minionList.querySelectorAll('button').forEach(b => {
                b.classList.remove('primary');
                b.classList.add('secondary');
            });
        });

        // Override board click handler
        this.boardUI.onTileClick = (row, col) => {
            console.log('[SANDBOX] Empty tile clicked:', row, col);
            console.log('[SANDBOX] Selected for move:', this.selectedMinionToMove);
            console.log('[SANDBOX] Selected for place:', this.selectedSandboxMinion);
            console.log('[SANDBOX] Ability mode:', this.sandboxAbilityMode);
            
            // If in ability mode, execute ability on the tile
            if (this.sandboxAbilityMode && this.selectedMinionToMove && this.currentAbility) {
                const targets = this.abilitySystem.getValidTargets(this.selectedMinionToMove, this.currentAbility);
                const validTarget = targets.find(t => t.row === row && t.col === col && !t.minion);
                
                if (validTarget) {
                    console.log('[SANDBOX] Executing ability at', row, col);
                    this.abilitySystem.execute(this.selectedMinionToMove, this.currentAbility, validTarget);
                    this.selectedMinionToMove = null;
                    this.currentAbility = null;
                    this.sandboxAbilityMode = false;
                    this.boardUI.clearHighlights();
                    this.boardUI.render();
                    return;
                }
            }
            
            // If we have a minion selected for moving, move it to the empty tile
            if (this.selectedMinionToMove) {
                console.log('[SANDBOX] Moving minion to empty tile', row, col);
                this.gameState.moveMinion(this.selectedMinionToMove, row, col);
                this.selectedMinionToMove = null;
                this.sandboxAbilityMode = false;
                this.currentAbility = null;
                this.boardUI.clearHighlights();
                this.boardUI.render();
                return;
            }
            
            // If we have a minion selected for placement, place it
            if (this.selectedSandboxMinion) {
                const owner = document.getElementById('sandbox-owner').value;
                console.log('[SANDBOX] Placing', this.selectedSandboxMinion, 'at', row, col, 'for', owner);

                // Spawn new minion
                const minion = this.minionLoader.createSpecializedMinion(this.selectedSandboxMinion, owner);
                minion.justSpawned = false; // Allow immediate action
                minion.hasMoved = false;
                minion.hasAttacked = false;
                this.gameState.placeMinion(minion, row, col);
                
                this.boardUI.render();
                this.boardUI.animateSpawn(row, col);
                return;
            }
            
            // Nothing selected, clicking empty tile does nothing
            console.log('[SANDBOX] Nothing selected, ignoring empty tile click');
        };

        // Override right-click handler to delete minions
        this.boardUI.onTileRightClick = (row, col) => {
            const minion = this.gameState.getMinionAt(row, col);
            if (minion) {
                console.log('[SANDBOX] Right-click deleting minion at', row, col);
                this.gameState.removeMinion(minion);
                this.boardUI.animateDeath(row, col);
                setTimeout(() => {
                    this.boardUI.render();
                }, 150);
            }
        };

        // Override minion click handler for moving
        this.boardUI.onMinionClick = (minion, row, col) => {
            console.log('[SANDBOX] Minion clicked:', minion.id, 'at', row, col);
            console.log('[SANDBOX] Selected for move:', this.selectedMinionToMove);
            console.log('[SANDBOX] Selected for place:', this.selectedSandboxMinion);
            console.log('[SANDBOX] Ability mode:', this.sandboxAbilityMode);
            
            // If in ability mode, execute ability on the minion
            if (this.sandboxAbilityMode && this.selectedMinionToMove && this.currentAbility) {
                const targets = this.abilitySystem.getValidTargets(this.selectedMinionToMove, this.currentAbility);
                const validTarget = targets.find(t => 
                    t.minion && t.minion.instanceId === minion.instanceId
                );
                
                if (validTarget) {
                    console.log('[SANDBOX] Executing ability on minion', minion.id);
                    this.abilitySystem.execute(this.selectedMinionToMove, this.currentAbility, validTarget);
                    this.selectedMinionToMove = null;
                    this.currentAbility = null;
                    this.sandboxAbilityMode = false;
                    this.boardUI.clearHighlights();
                    this.boardUI.render();
                    return;
                }
            }
            
            // If we have a minion selected for placement, place it here (replacing the existing minion)
            if (this.selectedSandboxMinion) {
                console.log('[SANDBOX] Placement mode - replacing minion at', row, col);
                const owner = document.getElementById('sandbox-owner').value;
                
                // Remove existing minion
                this.gameState.removeMinion(minion);
                
                // Spawn new minion
                const newMinion = this.minionLoader.createSpecializedMinion(this.selectedSandboxMinion, owner);
                newMinion.justSpawned = false;
                newMinion.hasMoved = false;
                newMinion.hasAttacked = false;
                this.gameState.placeMinion(newMinion, row, col);
                
                this.boardUI.render();
                this.boardUI.animateSpawn(row, col);
                return;
            }
            
            if (this.selectedMinionToMove && this.selectedMinionToMove.instanceId === minion.instanceId) {
                // Clicking the same minion - deselect it
                console.log('[SANDBOX] Deselecting minion');
                this.selectedMinionToMove = null;
                this.sandboxAbilityMode = false;
                this.currentAbility = null;
                this.boardUI.clearHighlights();
                this.boardUI.render();
            } else if (this.selectedMinionToMove) {
                // Clicking a different minion while one is selected
                // If it's an enemy, attack it
                if (minion.owner !== this.selectedMinionToMove.owner) {
                    console.log('[SANDBOX] Attacking enemy minion');
                    this.gameState.removeMinion(minion);
                    this.boardUI.animateDeath(row, col);
                    
                    // Move our minion there
                    setTimeout(() => {
                        this.gameState.moveMinion(this.selectedMinionToMove, row, col);
                        this.selectedMinionToMove = null;
                        this.sandboxAbilityMode = false;
                        this.currentAbility = null;
                        this.boardUI.clearHighlights();
                        this.boardUI.render();
                    }, 150);
                } else {
                    // Same team - switch selection
                    console.log('[SANDBOX] Switching to different friendly minion');
                    this.selectedMinionToMove = minion;
                    this.sandboxAbilityMode = false;
                    this.currentAbility = null;
                    this.boardUI.clearHighlights();
                    this.boardUI.selectTile(row, col);
                    this.showSandboxMoves(minion);
                }
            } else {
                // No minion selected - select this one
                console.log('[SANDBOX] Selecting minion for movement');
                this.selectedMinionToMove = minion;
                this.sandboxAbilityMode = false;
                this.currentAbility = null;
                this.boardUI.selectTile(row, col);
                this.showSandboxMoves(minion);
            }
        };
    }

    showSandboxMoves(minion) {
        // Create a temporary instance to get realistic movement
        const config = this.minionLoader.getConfig(minion.id);
        const minionInstance = this.minionLoader.createSpecializedMinion(minion.id, minion.owner);
        Object.assign(minionInstance, minion);
        
        // Restore movement config
        if (config.movement) {
            minionInstance.movement = config.movement;
        }
        
        // Get valid moves (shows realistic range, but clicking anywhere will still work)
        const validMoves = minionInstance.getValidMoves(this.gameState);
        this.boardUI.highlightMoves(validMoves);
        
        // Show attack range preview and valid attacks if available
        if (config.attack && !config.cannotAttack) {
            // Show attack range pattern (like normal gameplay)
            const attackPreview = this.minionLoader.getAttackPreview(minion, this.gameState);
            if (attackPreview) {
                this.boardUI.highlightAttackPreview(attackPreview);
            }
            
            // Show actual enemy targets
            const validAttacks = minionInstance.getValidAttacks(this.gameState);
            this.boardUI.highlightAttacks(validAttacks);
        }
        
        // Show ability targets if available
        if (config.abilities && config.abilities.length > 0) {
            for (const ability of config.abilities) {
                const targets = this.abilitySystem.getValidTargets(minion, ability);
                if (targets.length > 0) {
                    this.boardUI.highlightAbilityTargets(targets);
                    this.currentAbility = ability;
                    this.sandboxAbilityMode = true;
                }
            }
        }
    }

    showCustomOnlineMenu() {
        if (!this.networkClient.authManager.isAuthenticated()) {
            this.showProfileModal(() => this.showCustomOnlineMenu());
            return;
        }

        const overlay = createModalOverlay({ id: 'online-menu' });

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
                    roomEl.style = 'display: flex; justify-content: space-between; align-items: center; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 0px;'
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

    startAiGame(difficulty = this.aiDifficulty) {
        this.aiEnabled = true;
        this.setAiDifficulty(difficulty);
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
            this.aiManager = new AIManager(this, { difficulty: this.aiDifficulty });
        }

        if (!isOnline) {
            this.playerColor = 'blue';
            
            this.gameState.metadata = {};
            const creds = this.networkClient.authManager.getCredentials();
            this.gameState.metadata.blue = { username: creds ? creds.username : 'Local Player' };

            if (this.aiEnabled) {
                const aiNames = ['Gerald AI', 'Hydrophobis AI', 'wayback AI', 'Stockfish AI', 'Gerg_ AI'];
                const randomName = aiNames[Math.floor(Math.random() * aiNames.length)];
                this.gameState.metadata.red = { username: randomName, elo: '100' };
            } else {
                this.gameState.metadata.red = { username: 'Local P2' };
            }

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
                <div class="header-actions">
                    <button class="action-btn secondary btn-compact" id="btn-cancel">Cancel</button>
                    <button class="action-btn secondary btn-compact" id="btn-forfeit" style="display: none;">Forfeit</button>
                </div>
            </header>
            
            <main class="game-main">
                <div id="blue-panel-container"></div>
                
                <div class="board-wrapper">
                    <div class="action-hint" id="action-hint"></div>
                    <div class="board-container" id="board-container"></div>
                    <div id="current-hand-container"></div>
                </div>
                
                <div id="red-panel-container"></div>
            </main>
            
            <button class="action-btn primary" id="btn-end-turn">End Turn</button>
            
            <div id="room-info" style="text-align: center; color: var(--text-muted); font-size: 0.75rem;"></div>
            <div id="turn-timer" style="text-align: center; font-weight: bold; color: var(--player-red);"></div>
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

        // Update end turn button state
        const endTurnBtn = document.getElementById('btn-end-turn');
        if (endTurnBtn && this.isOnline) {
            const isMyTurn = this.gameState.currentPlayer === this.playerColor;
            if (isMyTurn) {
                endTurnBtn.classList.remove('secondary');
                endTurnBtn.classList.add('primary');
                endTurnBtn.disabled = false;
            } else {
                endTurnBtn.classList.remove('primary');
                endTurnBtn.classList.add('secondary');
                endTurnBtn.disabled = true;
            }
        }

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

        // In AI mode, keep a fixed player perspective.
        // In online mode, follow assigned color.
        // In local hotseat, follow current player.
        const flip = this.aiEnabled
            ? (this.playerColor === 'blue')
            : (this.isOnline ? (this.networkClient.color === 'blue') : (this.gameState.currentPlayer === 'blue'));
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

        const config = this.minionLoader.getConfig(card.id);
        const onlyDarkTiles = config.onlyDarkTiles || false;
        this.boardUI.highlightSpawnZone(this.gameState.currentPlayer, onlyDarkTiles);
        this.updateActionHint();
    }

    handleMinionClick(minion, row, col) {
        if (this.isSpectator()) return;
        if (this.isOnline && this.gameState.currentPlayer !== this.playerColor) return;
        
        console.log('[handleMinionClick] Mode:', this.mode, 'Clicked minion:', minion.id, 'at', row, col);
        
        if (this.mode === 'selectingAbility') {
            console.log('[handleMinionClick] Executing ability on minion');
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
            console.log('[Ability] Checking ability:', ability, 'for minion:', minion.id);
            const targets = this.abilitySystem.getValidTargets(minion, ability);
            console.log('[Ability] Valid targets:', targets);
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

        const config = this.minionLoader.getConfig(card.id);
        if (config.onlyDarkTiles && !this.gameState.board[row][col].isDark) {
            this.setHint('can only spawn on dark tiles');
            return false;
        }

        if (!ManaSystem.spendMana(this.gameState.players[player], card.cost)) {
            this.setHint('not enough mana to summon');
            return false;
        }

        const minion = this.minionLoader.createSpecializedMinion(card.id, player);
        this.gameState.placeMinion(minion, row, col);

        this.gameState.players[player].hand.splice(cardIndex, 1);
        if (minion.onSpawn) {
            minion.onSpawn(this.gameState);
        }

        if (this.gameState.phase === 'gameOver') {
            this.showGameOver();
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
        if (!this.turnManager.canMinionAttack(attacker)) {
            this.setHint('this minion cannot attack right now');
            return false;
        }

        // Client-side check: prevent attacking twice
        if (attacker.hasAttacked) {
            this.setHint('this minion has already attacked');
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

        const cost = config.attackCost || ManaSystem.ATTACK_COST;
        if (!ManaSystem.spendMana(this.gameState.players[this.gameState.currentPlayer], cost)) {
            this.setHint('too broke to fight');
            return false;
        }

        if (attacker.id === 'creeper' && config.attack && config.attack.selfDestruct) {
            this.executeCreeper(attacker);
            return true;
        }

        this.boardUI.animateAttack(attacker.position.row, attacker.position.col);
        this.boardUI.animateDeath(row, col);

        setTimeout(() => {
            this.gameState.removeMinion(target);
            this.turnManager.recordAction(attacker, 'attack');

            if (attacker.id === 'wither' && config.attack && config.attack.splash) {
                const splashTargets = [];
                for (const dir of Board.DIRECTIONS.lateral) {
                    const sr = row + dir.row;
                    const sc = col + dir.col;
                    const splashMinion = this.gameState.getMinionAt(sr, sc);
                    if (splashMinion) {
                        splashTargets.push(splashMinion);
                    }
                }
                for (const splashMinion of splashTargets) {
                    this.gameState.removeMinion(splashMinion);
                }
            }

            if (minionInstance.movesToAttack) {
                this.gameState.moveMinion(attacker, row, col);
            }

            if (this.gameState.phase === 'gameOver') {
                this.showGameOver();
            }

            this.render();
        }, 150);

        return true;
    }

    attackMinion(row, col) {
        if (!this.selectedMinion) return;

        const attacker = this.selectedMinion;

        if (this.isOnline) {
            this.networkClient.sendAction('ATTACK_MINION', { attackerId: attacker.instanceId, targetRow: row, targetCol: col });
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

        // Add 10 ELO for an AI Win!
        if (this.aiEnabled && winner === this.playerColor && this.networkClient.authManager.isAuthenticated()) {
            const creds = this.networkClient.authManager.getCredentials();
            fetch(`${API_URL}/player/${creds.username}/ai-win`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: creds.token })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    this.networkClient.authManager.setCredentials(creds.username, creds.token, data.newElo);
                    setTimeout(() => {
                        this.showRatingChange({
                            blue: { username: creds.username, newElo: data.newElo, diff: data.diff },
                            red: { username: 'AI', newElo: 0, diff: 0 }
                        });
                    }, 500); // Pops up slightly after the win screen
                }
            })
            .catch(err => console.error("Could not claim AI win ELO:", err));
        }

        const overlay = createModalOverlay({ id: 'game-over-screen' });

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
        const overlay = createModalOverlay({ zIndex: 3000 });

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
                        Standard Deck
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
            const container = document.getElementById('game-container');
            container.innerHTML = `
                <div class="start-screen-container">
                    <div class="start-screen-content" style="text-align: center;">
                        <div class="start-screen-title" style="font-size: 2rem;">Finding Match...</div>
                        <div class="preloader-spinner" style="margin: 20px auto;"></div>
                        <button class="action-btn secondary" onclick="window.location.reload()" style="width: 100%;">Cancel</button>
                    </div>
                </div>
            `;
            this.networkClient.findMatch(deck);
            
            // A 20 sec timer incase a real match isnt found 
            this.matchmakingTimeout = setTimeout(() => {
                const titleEl = document.querySelector('.start-screen-title');
                if (titleEl && titleEl.innerText === 'Finding Match...') {
                    console.log('Matchmaking timeout reached. Falling back to AI game.');
                    
                    // Force disconnect from matchmaking to avoid phantom connections
                    if (this.networkClient.socket) {
                        this.networkClient.socket.onclose = null; // Prevent the error popup
                        this.networkClient.socket.close();
                    }
                    
                    // Fallback to AI Match
                    this.startAiGame('balanced'); 
                }
            }, 20000);
        });
    }


    onServerStateUpdate(newStateData) {
        // Clear AI fallback timeout if we found a match
        if (this.matchmakingTimeout) {
            clearTimeout(this.matchmakingTimeout);
            this.matchmakingTimeout = null;
        }

        // No need to remove anything since we're using the game-container now

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
        for (let r = 0; r < Board.ROWS; r++) {
            for (let c = 0; c < Board.COLS; c++) {
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

        const overlay = createModalOverlay({ zIndex: 2000 });

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
            border-radius: 0px;
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
        const elo = auth.elo || 1000;
        const isAuthenticated = auth.isAuthenticated();

        const overlay = createModalOverlay({ id: 'profile-modal' });

        overlay.innerHTML = `
            <div class="modal" style="width: 400px; text-align: center;">
                <div class="modal-title">Player Profile</div>
                
                ${isAuthenticated ? `
                    <div style="background: linear-gradient(135deg, var(--mana-color), #a78bfa); padding: 20px; border-radius: 0px;">
                        <div style="font-size: 0.75rem; color: rgba(255,255,255,0.8); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Your Rating</div>
                        <div style="font-size: 3rem; font-weight: 800; color: white; text-shadow: 0 2px 8px rgba(0,0,0,0.3);">${elo}</div>
                        <div style="font-size: 0.85rem; color: rgba(255,255,255,0.9); margin-top: 4px;">ELO</div>
                    </div>
                ` : ''}
                
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

                    <div style="background: rgba(239, 68, 68, 0.1); padding: 10px; border-radius: 0px;">
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

    getSavedAiDifficulty() {
        const saved = localStorage.getItem('chegg_ai_difficulty');
        const allowed = new Set(['cautious', 'balanced', 'aggressive']);
        return allowed.has(saved) ? saved : 'balanced';
    }

    setAiDifficulty(difficulty) {
        const allowed = new Set(['cautious', 'balanced', 'aggressive']);
        this.aiDifficulty = allowed.has(difficulty) ? difficulty : 'balanced';
        localStorage.setItem('chegg_ai_difficulty', this.aiDifficulty);
    }
}

// entry point
document.addEventListener('DOMContentLoaded', () => {
    window.game = new CheggGame();
});

export default CheggGame;
