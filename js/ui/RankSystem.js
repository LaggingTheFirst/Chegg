export class RankSystem {
    constructor() {
        this.config = null;
        this.loaded = false;
    }

    async load(configPath = 'assets/leaderboard/ranks.json') {
        try {
            const response = await fetch(configPath);
            this.config = await response.json();
            this.loaded = true;
            return true;
        } catch (err) {
            console.error('Failed to load rank config:', err);
            return false;
        }
    }

    getRankForElo(elo) {
        if (!this.loaded || !this.config) return null;

        for (const tier of this.config.ranks) {
            for (const subdivision of tier.subdivisions) {
                if (elo >= subdivision.minElo && elo <= subdivision.maxElo) {
                    return {
                        ...subdivision,
                        tier: tier.tier,
                        color: tier.color
                    };
                }
            }
        }

        const lastTier = this.config.ranks[this.config.ranks.length - 1];
        const lastSubdivision = lastTier.subdivisions[lastTier.subdivisions.length - 1];
        return {
            ...lastSubdivision,
            tier: lastTier.tier,
            color: lastTier.color
        };
    }

    getRankImage(elo) {
        const rank = this.getRankForElo(elo);
        return rank ? rank.image : null;
    }

    getRankColor(elo) {
        const rank = this.getRankForElo(elo);
        return rank ? rank.color : '#9ca3af';
    }

    getRankName(elo) {
        const rank = this.getRankForElo(elo);
        return rank ? rank.name : 'Unranked';
    }

    getTierName(elo) {
        const rank = this.getRankForElo(elo);
        return rank ? rank.tier : 'Unranked';
    }

    createRankBadge(elo, options = {}) {
        const {
            showName = this.config?.displaySettings.showRankName ?? true,
            showTierOnly = this.config?.displaySettings.showTierOnly ?? false,
            size = this.config?.displaySettings.imageSize ?? 32,
            className = ''
        } = options;

        const rank = this.getRankForElo(elo);
        if (!rank) return null;

        const badge = document.createElement('div');
        badge.className = `rank-badge ${className}`;
        badge.style.display = 'inline-flex';
        badge.style.alignItems = 'center';
        badge.style.gap = '8px';

        const img = document.createElement('img');
        img.src = rank.image;
        img.alt = rank.name;
        img.style.width = `${size}px`;
        img.style.height = `${size}px`;
        img.style.imageRendering = 'pixelated';
        badge.appendChild(img);

        if (showName) {
            const nameSpan = document.createElement('span');
            nameSpan.textContent = showTierOnly ? rank.tier : rank.name;
            nameSpan.style.color = rank.color;
            nameSpan.style.fontWeight = 'bold';
            badge.appendChild(nameSpan);
        }

        return badge;
    }

    getRankHTML(elo, options = {}) {
        const {
            showName = this.config?.displaySettings.showRankName ?? true,
            showTierOnly = this.config?.displaySettings.showTierOnly ?? false,
            size = this.config?.displaySettings.imageSize ?? 32
        } = options;

        const rank = this.getRankForElo(elo);
        if (!rank) return '';

        let html = `<div class="rank-badge" style="display: inline-flex; align-items: center; gap: 8px;">`;
        html += `<img src="${rank.image}" alt="${rank.name}" style="width: ${size}px; height: ${size}px; image-rendering: pixelated;">`;
        
        if (showName) {
            const displayName = showTierOnly ? rank.tier : rank.name;
            html += `<span style="color: ${rank.color}; font-weight: bold;">${displayName}</span>`;
        }
        
        html += `</div>`;
        
        return html;
    }

    getAllRanks() {
        if (!this.config) return [];
        
        const allRanks = [];
        for (const tier of this.config.ranks) {
            for (const subdivision of tier.subdivisions) {
                allRanks.push({
                    ...subdivision,
                    tier: tier.tier,
                    color: tier.color
                });
            }
        }
        return allRanks;
    }

    getAllTiers() {
        return this.config?.ranks || [];
    }

    getDisplaySettings() {
        return this.config?.displaySettings || {};
    }
}

export default RankSystem;
