import { Board } from '../engine/Board.js';
import { loadImageInto, showTooltip, hideTooltip } from './UIUtils.js';

export class BoardUI {
    constructor(gameState, containerSelector) {
        this.gameState = gameState;
        this.container = document.querySelector(containerSelector);
        this.boardElement = null;
        this.tiles = [];
        this.onTileClick = null;
        this.onMinionClick = null;
        this.onTileRightClick = null;
        this.flipped = false;

        this.init();
    }

    init() {
        // Wrapper for labels + board
        const wrapper = document.createElement('div');
        wrapper.className = 'board-grid-wrapper';

        // Top labels (1-8)
        const topLabels = document.createElement('div');
        topLabels.className = 'board-labels-top';
        // empty corner
        topLabels.appendChild(document.createElement('div'));
        for (let i = 1; i <= Board.COLS; i++) {
            const lbl = document.createElement('div');
            lbl.className = 'label-cell';
            lbl.textContent = i;
            topLabels.appendChild(lbl);
        }
        wrapper.appendChild(topLabels);

        // Center section: Left labels + Board
        const centerSection = document.createElement('div');
        centerSection.className = 'board-center-section';

        // Left labels (A-J)
        const leftLabels = document.createElement('div');
        leftLabels.className = 'board-labels-left';
        const rows = Array.from({ length: Board.ROWS }, (_, i) => String.fromCharCode(65 + i));
        for (const r of rows) {
            const lbl = document.createElement('div');
            lbl.className = 'label-cell';
            lbl.textContent = r;
            leftLabels.appendChild(lbl);
        }
        centerSection.appendChild(leftLabels);

        // Actual board
        this.boardElement = document.createElement('div');
        this.boardElement.className = 'board';

        // 10x8 grid
        for (let row = 0; row < Board.ROWS; row++) {
            this.tiles[row] = [];
            for (let col = 0; col < Board.COLS; col++) {
                const tile = this.createTile(row, col);
                this.tiles[row][col] = tile;
                this.boardElement.appendChild(tile);
            }
        }
        centerSection.appendChild(this.boardElement);

        wrapper.appendChild(centerSection);
        this.container.appendChild(wrapper);
    }

    createTile(row, col) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.dataset.row = row;
        tile.dataset.col = col;

        // checkerboard
        if ((row + col) % 2 === 0) {
            tile.classList.add('light');
        } else {
            tile.classList.add('dark');
        }

        // spawn zone shades
        if (Board.isSpawnZone(row, 'blue')) {
            tile.classList.add('blue-spawn');
        } else if (Board.isSpawnZone(row, 'red')) {
            tile.classList.add('red-spawn');
        }

        tile.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleTileClick(row, col);
        });

        tile.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.handleTileRightClick(row, col);
        });

        return tile;
    }

    handleTileClick(row, col) {
        const minion = this.gameState.getMinionAt(row, col);

        // unit or empty?
        if (minion && this.onMinionClick) {
            this.onMinionClick(minion, row, col);
        } else if (this.onTileClick) {
            this.onTileClick(row, col);
        }
    }

    handleTileRightClick(row, col) {
        if (this.onTileRightClick) {
            this.onTileRightClick(row, col);
        }
    }

    render() {
        // wipe & redraw
        for (let row = 0; row < Board.ROWS; row++) {
            for (let col = 0; col < Board.COLS; col++) {
                const tile = this.tiles[row][col];
                const minionEl = tile.querySelector('.minion');
                if (minionEl) {
                    minionEl.remove();
                }
            }
        }

        this.gameState.minionRegistry.forEach(minion => {
            if (minion.position) {
                this.renderMinion(minion);
            }
        });
    }

    renderMinion(minion) {
        const { row, col } = minion.position;
        const tile = this.tiles[row][col];

        const minionEl = document.createElement('div');
        minionEl.className = `minion ${minion.owner}`;
        minionEl.dataset.instanceId = minion.instanceId;

        if (minion.id === 'villager') {
            minionEl.classList.add('villager');
        }

        // glow if active
        if (!minion.justSpawned && !minion.hasActedThisTurn &&
            minion.owner === this.gameState.currentPlayer) {
            minionEl.classList.add('can-act');
        }

        if (minion.justSpawned) {
            minionEl.classList.add('just-spawned');
        }

        if (minion.hasMoved && minion.id !== 'villager' && !minion.hasDashed && !this.sandboxMode) {
            minionEl.classList.add('dash-mode');
        }

        // load sprite, fallback to initials
        const imgPath = `assets/minions/${minion.image || minion.id + '.png'}`;
        loadImageInto(minionEl, imgPath, minion.name.substring(0, 3), 'minion-placeholder');

        tile.appendChild(minionEl);
    }

    clearHighlights() {
        for (let row = 0; row < Board.ROWS; row++) {
            for (let col = 0; col < Board.COLS; col++) {
                const tile = this.tiles[row][col];
                tile.classList.remove(
                    'highlight-move',
                    'highlight-attack',
                    'highlight-ability',
                    'highlight-selected',
                    'highlight-attack-preview'
                );
            }
        }
    }

    highlightMoves(positions) {
        for (const pos of positions) {
            const tile = this.tiles[pos.row][pos.col];
            tile.classList.add('highlight-move');
        }
    }

    highlightAttacks(positions) {
        for (const pos of positions) {
            const row = pos.row !== undefined ? pos.row : pos.targets?.[0]?.row;
            const col = pos.col !== undefined ? pos.col : pos.targets?.[0]?.col;
            if (row !== undefined && col !== undefined) {
                const tile = this.tiles[row][col];
                tile.classList.add('highlight-attack');
            }
        }
    }

    highlightAbilityTargets(positions) {
        for (const pos of positions) {
            const row = pos.row !== undefined ? pos.row : pos.minion?.position?.row;
            const col = pos.col !== undefined ? pos.col : pos.minion?.position?.col;
            if (row !== undefined && col !== undefined) {
                const tile = this.tiles[row][col];
                tile.classList.add('highlight-ability');
            }
        }
    }

    highlightAttackPreview(positions) {
        for (const pos of positions) {
            if (this.gameState.isValidPosition(pos.row, pos.col)) {
                const tile = this.tiles[pos.row][pos.col];
                tile.classList.add('highlight-attack-preview');
            }
        }
    }

    selectTile(row, col) {
        this.tiles[row][col].classList.add('highlight-selected');
    }

    highlightSpawnZone(player, onlyDarkTiles = false) {
        for (let row = 0; row < Board.ROWS; row++) {
            for (let col = 0; col < Board.COLS; col++) {
                const inZone = Board.isSpawnZone(row, player);
                const isDark = this.gameState.board[row][col].isDark;
                if (inZone && !this.gameState.getMinionAt(row, col)) {
                    if (!onlyDarkTiles || isDark) {
                        this.tiles[row][col].classList.add('highlight-move');
                    }
                }
            }
        }
    }

    animateSpawn(row, col) {
        const tile = this.tiles[row][col];
        const minionEl = tile.querySelector('.minion');
        if (minionEl) {
            minionEl.classList.add('minion-spawn');
            setTimeout(() => minionEl.classList.remove('minion-spawn'), 300);
        }
    }

    animateAttack(row, col) {
        const tile = this.tiles[row][col];
        const minionEl = tile.querySelector('.minion');
        if (minionEl) {
            minionEl.classList.add('minion-attack');
            setTimeout(() => minionEl.classList.remove('minion-attack'), 200);
        }
    }

    animateDeath(row, col) {
        const tile = this.tiles[row][col];
        const minionEl = tile.querySelector('.minion');
        if (minionEl) {
            minionEl.classList.add('minion-death');
        }
    }

    setFlip(flipped) {
        this.flipped = flipped;
        const wrapper = this.container.querySelector('.board-grid-wrapper');
        if (flipped) {
            wrapper.classList.add('flipped');
        } else {
            wrapper.classList.remove('flipped');
        }
    }



    showTooltip(minion, x, y) {
        const config = minion.config || minion;
        showTooltip({
            id: 'minion-tooltip',
            title: minion.name,
            cost: minion.cost,
            description: config.description || '',
            x,
            y,
            offsetX: 10,
            offsetY: 10
        });
    }

    hideTooltip() {
        hideTooltip('minion-tooltip');
    }
}

export default BoardUI;
