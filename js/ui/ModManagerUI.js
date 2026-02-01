export class ModManagerUI {
    constructor(modManager) {
        this.modManager = modManager;
        this.isVisible = false;
        this.overlay = null;
    }

    show() {
        if (this.isVisible) return;
        this.isVisible = true;
        this.render();
    }

    hide() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
        this.isVisible = false;
    }

    toggle() {
        if (this.isVisible) this.hide();
        else this.show();
    }

    async handleReload() {
        const btn = this.overlay.querySelector('#btn-reload-mods');
        const originalText = btn.textContent;
        btn.textContent = 'Reloading...';
        btn.disabled = true;

        const results = await this.modManager.reload();

        // if we are in game, we might need to refresh shit
        // but for now lets just rerender the UI
        btn.textContent = originalText;
        btn.disabled = false;

        this.renderContent(); // refresh list
    }

    render() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'modal-overlay active';
        this.overlay.style.zIndex = '2000'; // above everything else

        this.overlay.innerHTML = `
            <div class="modal mod-manager-modal" style="width: 600px; max-width: 90vw; max-height: 80vh; display: flex; flex-direction: column;">
                <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <h2 style="margin: 0;">Mod Manager</h2>
                    <button class="close-btn" style="background: none; border: none; color: white; font-size: 1.5rem; cursor: pointer;">&times;</button>
                </div>

                <div class="mod-list-container" style="flex: 1; overflow-y: auto; background: rgba(0,0,0,0.3); border-radius: 8px; padding: 10px; margin-bottom: 20px;">
                    <!-- content goes here -->
                </div>

                <div class="modal-footer" style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button class="action-btn secondary" id="btn-reload-mods">Reload Mods</button>
                    <button class="action-btn primary" id="btn-close-mods">Close</button>
                </div>
            </div>
        `;

        document.body.appendChild(this.overlay);

        this.overlay.querySelector('.close-btn').addEventListener('click', () => this.hide());
        this.overlay.querySelector('#btn-close-mods').addEventListener('click', () => this.hide());
        this.overlay.querySelector('#btn-reload-mods').addEventListener('click', () => this.handleReload());

        // close on background click
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.hide();
        });

        this.renderContent();
    }

    renderContent() {
        const container = this.overlay.querySelector('.mod-list-container');
        const { minions, abilities } = this.modManager.getLoadedMods();
        const errors = this.modManager.getErrors();
        const warnings = this.modManager.getWarnings();

        let html = '';

        // Errors section
        if (errors.length > 0) {
            html += `<div style="margin-bottom: 20px;">
                <h3 style="color: #ef4444; margin-top: 0;">Errors (${errors.length})</h3>
                ${errors.map(err => `
                    <div style="background: rgba(239, 68, 68, 0.1); border-left: 3px solid #ef4444; padding: 10px; margin-bottom: 8px; font-size: 0.9em;">
                        <div style="font-weight: bold;">${err.path}</div>
                        <div>${err.error}</div>
                    </div>
                `).join('')}
            </div>`;
        }

        // Warnings section
        if (warnings.length > 0) {
            html += `<div style="margin-bottom: 20px;">
                <h3 style="color: #f59e0b; margin-top: 0;">Warnings (${warnings.length})</h3>
                ${warnings.map(w => `
                    <div style="background: rgba(245, 158, 11, 0.1); border-left: 3px solid #f59e0b; padding: 10px; margin-bottom: 8px; font-size: 0.9em;">
                        <div style="font-weight: bold;">${w.path || w}</div>
                        <div>${w.warnings ? w.warnings.join(', ') : w}</div>
                    </div>
                `).join('')}
            </div>`;
        }

        // Minions list
        html += `<h3 style="margin-top: 0;">Minions (${minions.length})</h3>`;
        if (minions.length === 0) {
            html += `<div style="color: var(--text-muted); font-style: italic;">No custom minions loaded</div>`;
        } else {
            html += `<div style="display: flex; flex-direction: column; gap: 8px;">
                ${minions.map(m => `
                    <div style="display: flex; align-items: center; background: rgba(255,255,255,0.05); padding: 8px 12px; border-radius: 4px;">
                        <span style="color: #10b981; margin-right: 10px;">✅</span>
                        <div>
                            <div style="font-weight: 500;">${m.name}</div>
                            <div style="font-size: 0.8em; color: var(--text-secondary);">${m.id}</div>
                        </div>
                    </div>
                `).join('')}
            </div>`;
        }

        // Abilities list
        html += `<h3 style="margin-top: 20px;">Abilities (${abilities.length})</h3>`;
        if (abilities.length === 0) {
            html += `<div style="color: var(--text-muted); font-style: italic;">No custom abilities loaded</div>`;
        } else {
            html += `<div style="display: flex; flex-direction: column; gap: 8px;">
                ${abilities.map(a => `
                    <div style="display: flex; align-items: center; background: rgba(255,255,255,0.05); padding: 8px 12px; border-radius: 4px;">
                        <span style="color: #10b981; margin-right: 10px;">✅</span>
                        <div>
                            <div style="font-weight: 500;">${a.name}</div>
                            <div style="font-size: 0.8em; color: var(--text-secondary);">${a.id}</div>
                        </div>
                    </div>
                `).join('')}
            </div>`;
        }

        // External URL section
        html += `
            <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
                <h3 style="margin-top: 0; font-size: 1rem;">Load from URL</h3>
                <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                    <input type="text" id="external-mod-url" placeholder="https://example.com/mod.json" 
                        style="flex: 1; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.2); color: white; padding: 8px 12px; border-radius: 4px; font-family: inherit;">
                    <button class="action-btn primary" id="btn-load-external" style="padding: 8px 16px;">Load</button>
                </div>
                <div style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.4;">
                    <span style="color: #f59e0b;">⚠️ Warning:</span> Loading external mods executes code. Only use URLs from sources you trust.
                </div>
            </div>
        `;

        // External mods list
        if (this.modManager.externalUrls.length > 0) {
            html += `
                <div style="margin-top: 20px;">
                    <h4 style="margin-bottom: 8px; font-size: 0.85rem; color: var(--text-secondary);">External Sources</h4>
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        ${this.modManager.externalUrls.map(url => `
                            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.03); padding: 4px 8px; border-radius: 4px; font-size: 0.8rem;">
                                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 400px; color: var(--text-muted);">${url}</span>
                                <button class="remove-external-btn" data-url="${url}" style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 2px 8px;">Remove</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;

        // Add event listeners for new elements
        const loadBtn = this.overlay.querySelector('#btn-load-external');
        const urlInput = this.overlay.querySelector('#external-mod-url');

        loadBtn.addEventListener('click', async () => {
            const url = urlInput.value.trim();
            if (!url) return;

            const confirmed = window.confirm(
                "⚠️ SAFETY WARNING ⚠️\n\n" +
                "Loading external mods can be dangerous. Mods can contain code that executes in your browser.\n\n" +
                "Are you sure you want to load this mod?\n\n" +
                url
            );

            if (confirmed) {
                loadBtn.disabled = true;
                loadBtn.textContent = '...';
                await this.modManager.loadExternalMod(url);
                this.renderContent();
            }
        });

        // Remove buttons
        this.overlay.querySelectorAll('.remove-external-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const url = btn.dataset.url;
                btn.disabled = true;
                await this.modManager.removeExternalMod(url);
                this.renderContent();
            });
        });
    }
}
