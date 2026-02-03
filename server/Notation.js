/**
 * Utility for CHEGG custom action notation
 * Syntax:
 * - Attack: <source>!<destination> (e.g. A3v!A2)
 * - Ability: <source>$<destination> or <source>$ (e.g. A1e$J1, F4c$)
 * - Move: <source>:<destination> (e.g. A3v:B4)
 * - Dash: <source>-<destination> (e.g. B4v-C4)
 * - Place: <destination><minion> (e.g. [A1v])
 * 
 * Coordinates: Col A-H (1-8), Row 1-10
 */

export const MINION_MAP = {
    'villager': 'v',
    'zombie': 'z',
    'creeper': 'c',
    'pig': 'p',
    'rabbit': 'r',
    'pufferfish': 'u',
    'iron_golem': 'i',
    'frog': 'f',
    'skeleton': 's',
    'blaze': 'b',
    'phantom': 'h',
    'enderman': 'e',
    'slime': 'L',
    'shulker_box': 'x',
    'parrot': 't',
    'cat': 'm',
    'sniffer': 'n',
    'wither': 'w'
};

const COLS = 'ABCDEFGH';

export class Notation {
    static toCoord(row, col) {
        return `${COLS[col]}${row + 1}`;
    }

    static fromCoord(coord) {
        const col = COLS.indexOf(coord[0]);
        const row = parseInt(coord.substring(1)) - 1;
        return { row, col };
    }

    static getMinionChar(id) {
        return MINION_MAP[id] || '?';
    }

    static formatSpawn(color, row, col, minionId) {
        const char = this.getMinionChar(minionId);
        const coord = this.toCoord(row, col);
        const str = `${coord}${char}`;
        return color === 'blue' ? `[${str}]` : `{${str}}`;
    }

    static formatAction(color, type, payload, minionId) {
        const char = this.getMinionChar(minionId);
        const fromCoord = payload.from ? this.toCoord(payload.from.row, payload.from.col) : '';
        const toCoord = this.toCoord(payload.to.row, payload.to.col);

        let op = '';
        switch (type) {
            case 'move': op = ':'; break;
            case 'dash': op = '-'; break;
            case 'attack': op = '!'; break;
            case 'ability': op = '$'; break;
        }

        const str = fromCoord ? `${fromCoord}${char}${op}${toCoord}` : `${toCoord}${char}${op}`;
        return color === 'blue' ? `[${str}]` : `{${str}}`;
    }
}
