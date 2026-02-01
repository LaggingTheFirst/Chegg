import { Board } from '../../js/engine/Board.js';

export default {
    id: 'raise_dead',
    name: 'Raise Dead',
    cost: 2,
    description: 'Spawn a Zombie on an adjacent empty tile',

    getValidTargets(minion, gameState) {
        const { row, col } = minion.position;
        const targets = [];

        // look for empty adjacent tiles
        for (const dir of Board.DIRECTIONS.surrounding) {
            const r = row + dir.row;
            const c = col + dir.col;

            if (Board.isValidPosition(r, c) && !gameState.getMinionAt(r, c)) {
                targets.push({ row: r, col: c });
            }
        }

        return targets;
    },

    execute(minion, target, gameState) {
        if (window.game && window.game.minionLoader) {
            const zombie = window.game.minionLoader.createSpecializedMinion('zombie', minion.owner);
            gameState.placeMinion(zombie, target.row, target.col);
            return true;
        }

        console.warn('Could not find minionLoader to raise dead');
        return false;
    }
};
