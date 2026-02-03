import { DeckManager } from '../engine/DeckManager.js';

export class DeckBuilder {
    constructor(minionLoader) {
        this.minionLoader = minionLoader;
        this.currentDeck = [];
        this.onComplete = null;
        this.currentPlayer = 'blue';
        this.overlay = null;
    }

    show(player, callback) {
        this.currentPlayer = player;
        this.currentDeck = [];
        this.onComplete = callback;

        this.overlay = document.createElement('div');
        this.overlay.className = 'modal-overlay active';

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = this.getHTML();

        this.overlay.appendChild(modal);
        document.body.appendChild(this.overlay);

        this.bindEvents();
        this.render();
    }

    getHTML() {
        const playerName = this.currentPlayer === 'blue' ? 'Blue Player' : 'Red Player';

        return `
            <div class="modal-title">Deck Manager</div>
            
            <div class="deck-builder">
                <div class="minion-pool-section">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <div class="mana-label">Available Minions (click to add)</div>
                        <div style="display: flex; gap: 4px;">
                            <button class="action-btn secondary" id="btn-default" style="font-size: 0.65rem; padding: 4px 8px;">Default Deck</button>
                            <button class="action-btn secondary" id="btn-clear" style="font-size: 0.65rem; padding: 4px 8px; color: var(--player-red);">Clear</button>
                        </div>
                    </div>
                    <div class="minion-pool" id="minion-pool"></div>
                </div>
                
                <div class="deck-preview">
                    <div class="mana-label">Your Deck (<span id="deck-count">0</span>/15)</div>
                    <div class="deck-slots" id="deck-slots"></div>
                    
                    <div class="deck-stats" id="deck-stats" style="margin-top: 15px;"></div>
                    
                    <div style="margin-top: 15px;">
                        <input type="text" id="deck-name-input" placeholder="Deck Name" style="width: 100%; padding: 8px; margin-bottom: 8px; background: var(--bg-secondary); border: 1px solid var(--border); color: white;">
                        <button class="action-btn secondary" id="btn-save" style="width: 100%;">Save Deck</button>
                    </div>

                    <div style="margin-top: 15px;">
                        <select id="deck-load-select" style="width: 100%; padding: 8px; margin-bottom: 8px; background: var(--bg-secondary); border: 1px solid var(--border); color: white;">
                            <option value="">-- Load Saved Deck --</option>
                        </select>
                        <div style="display: flex; gap: 4px;">
                            <button class="action-btn secondary" id="btn-load" style="flex: 1;">Load Selected</button>
                            <button class="action-btn danger" id="btn-delete" style="padding: 10px;">🗑️</button>
                        </div>
                    </div>

                    <div style="margin-top: 15px; display: flex; flex-direction: column; gap: 8px;">
                        <button class="action-btn primary" id="btn-confirm" disabled style="width: 100%;">Finish & Exit</button>
                        <button class="action-btn secondary" id="btn-back-menu" style="width: 100%;">Back to Menu</button>
                    </div>
                </div>
            </div>
        `;
    }

    bindEvents() {
        const btnClear = this.overlay.querySelector('#btn-clear');
        if (btnClear) {
            btnClear.addEventListener('click', () => {
                this.currentDeck = [];
                this.render();
            });
        }

        const btnDefault = this.overlay.querySelector('#btn-default');
        if (btnDefault) {
            btnDefault.addEventListener('click', () => {
                this.currentDeck = DeckManager.createDefaultDeck(this.minionLoader);
                this.render();
            });
        }

        const btnSave = this.overlay.querySelector('#btn-save');
        if (btnSave) {
            btnSave.addEventListener('click', () => {
                const nameInput = this.overlay.querySelector('#deck-name-input');
                const name = nameInput ? nameInput.value.trim() : '';
                if (!name) return alert('Enter a name');
                DeckManager.saveDeck(name, this.currentDeck);
                this.updateLoadList();
                alert('Deck saved!');
            });
        }

        const btnLoad = this.overlay.querySelector('#btn-load');
        if (btnLoad) {
            btnLoad.addEventListener('click', () => {
                const select = this.overlay.querySelector('#deck-load-select');
                const name = select ? select.value : '';
                if (!name) return;
                const loaded = DeckManager.loadDeck(name, this.minionLoader);
                if (loaded) {
                    this.currentDeck = loaded;
                    this.render();
                }
            });
        }

        const btnDelete = this.overlay.querySelector('#btn-delete');
        if (btnDelete) {
            btnDelete.addEventListener('click', () => {
                const select = this.overlay.querySelector('#deck-load-select');
                const name = select ? select.value : '';
                if (!name) return;

                if (confirm(`Are you sure you want to delete "${name}"?`)) {
                    DeckManager.deleteDeck(name);
                    this.updateLoadList();
                }
            });
        }

        const btnConfirm = this.overlay.querySelector('#btn-confirm');
        if (btnConfirm) {
            btnConfirm.addEventListener('click', () => {
                if (this.currentDeck.length === DeckManager.DECK_SIZE) {
                    this.close();
                    if (this.onComplete) {
                        this.onComplete(this.currentDeck);
                    }
                }
            });
        }

        const btnBack = this.overlay.querySelector('#btn-back-menu');
        if (btnBack) {
            btnBack.addEventListener('click', () => {
                this.close();
                // If we were in a matchmaking flow, we should probably refresh start screen
                // but for now just closing is fine.
                this.close();
                if (this.onComplete) this.onComplete(null);
            });
        }
    }

    render() {
        this.renderMinionPool();
        this.renderDeckSlots();
        this.renderStats();
        this.updateConfirmButton();
        this.updateLoadList();
    }

    updateLoadList() {
        const select = this.overlay.querySelector('#deck-load-select');
        const names = DeckManager.getSavedDeckNames();
        const currentVal = select.value;

        select.innerHTML = '<option value="">-- Load Saved Deck --</option>';
        for (const name of names) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        }
        select.value = currentVal;
    }

    renderMinionPool() {
        const pool = this.overlay.querySelector('#minion-pool');
        if (!pool) return;
        pool.innerHTML = '';

        const minions = this.minionLoader.getDeckBuildingConfigs();
        console.log(`[DeckBuilder] Rendering pool with ${minions.length} minions`);

        if (minions.length === 0) {
            pool.innerHTML = '<div style="color: var(--text-muted); padding: 20px;">No minions loaded. Check console for errors.</div>';
            return;
        }

        for (const minion of minions) {
            const card = document.createElement('div');
            card.className = 'card';

            const imgContainer = document.createElement('div');
            imgContainer.className = 'card-image';
            imgContainer.textContent = minion.name.substring(0, 3);

            const img = new Image();
            img.src = `assets/minions/${minion.image || minion.id + '.png'}`;
            img.onload = () => {
                imgContainer.innerHTML = '';
                imgContainer.appendChild(img);
            };

            const name = document.createElement('div');
            name.className = 'card-name';
            name.textContent = minion.name;

            const cost = document.createElement('div');
            cost.className = 'card-cost';
            cost.textContent = minion.cost;

            card.appendChild(imgContainer);
            card.appendChild(name);
            card.appendChild(cost);

            card.addEventListener('click', () => {
                if (this.currentDeck.length < DeckManager.DECK_SIZE) {
                    this.currentDeck.push({ ...minion });
                    this.render();
                }
            });

            pool.appendChild(card);
        }
    }

    renderDeckSlots() {
        const slotsContainer = this.overlay.querySelector('#deck-slots');
        const countDisplay = this.overlay.querySelector('#deck-count');

        slotsContainer.innerHTML = '';
        countDisplay.textContent = this.currentDeck.length;

        // show deck cards
        for (let i = 0; i < this.currentDeck.length; i++) {
            const minion = this.currentDeck[i];
            const slot = document.createElement('div');
            slot.className = 'deck-slot filled';
            slot.title = `${minion.name} (${minion.cost}), Click to remove`;
            slot.style.cursor = 'pointer';

            const img = new Image();
            img.src = `assets/minions/${minion.image || minion.id + '.png'}`;
            img.onload = () => {
                slot.innerHTML = '';
                slot.appendChild(img);
            };
            img.onerror = () => {
                slot.textContent = minion.name.substring(0, 3);
            };

            slot.textContent = minion.name.substring(0, 3);

            slot.addEventListener('click', () => {
                this.currentDeck.splice(i, 1);
                this.render();
            });

            slotsContainer.appendChild(slot);
        }

        // fill with ?
        for (let i = this.currentDeck.length; i < DeckManager.DECK_SIZE; i++) {
            const slot = document.createElement('div');
            slot.className = 'deck-slot';
            slot.textContent = '?';
            slotsContainer.appendChild(slot);
        }
    }

    renderStats() {
        const statsEl = this.overlay.querySelector('#deck-stats');

        if (this.currentDeck.length === 0) {
            statsEl.innerHTML = '<div style="color: var(--text-muted);">Add minions to see stats</div>';
            return;
        }

        const stats = DeckManager.getDeckStats(this.currentDeck);

        statsEl.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="color: var(--text-secondary);">Avg Cost:</span>
                <span style="color: var(--mana-color); font-weight: 600;">${stats.averageCost}</span>
            </div>
            <div style="display: flex; gap: 4px; align-items: flex-end;">
                ${Object.entries(stats.costCurve).map(([cost, count]) => `
                    <div style="display: flex; flex-direction: column; align-items: center;">
                        <div style="
                            width: 20px; 
                            height: ${count * 15}px; 
                            background: var(--mana-color);
                            border-radius: 3px;
                            min-height: 4px;
                        "></div>
                        <span style="font-size: 0.7rem; color: var(--text-muted);">${cost}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    updateConfirmButton() {
        const btn = this.overlay.querySelector('#btn-confirm');
        btn.disabled = this.currentDeck.length !== DeckManager.DECK_SIZE;
    }

    close() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
    }
}

export default DeckBuilder;
