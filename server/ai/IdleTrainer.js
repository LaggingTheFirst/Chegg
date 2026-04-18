import { Worker, isMainThread, parentPort } from 'worker_threads';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEIGHTS_PATH = path.join(__dirname, 'weights.json');

// ─── Worker thread code ───────────────────────────────────────────────────────
if (!isMainThread) {
    // Runs entirely in a worker — never blocks the main thread
    const { GameState }    = await import('../../js/engine/GameState.js');
    const { TurnManager }  = await import('../../js/engine/TurnManager.js');
    const { DeckManager }  = await import('../../js/engine/DeckManager.js');
    const { MinionLoader } = await import('../../js/minions/MinionLoader.js');
    const { ServerAI }     = await import('./ServerAI.js');

    const WEIGHTS_PATH_W = path.join(__dirname, 'weights.json');
    const MAX_TURNS      = 200;
    const MUTATION_RATE  = 0.4;
    const MUTATION_STR   = 0.3;

    function loadWeights() {
        try { return JSON.parse(fs.readFileSync(WEIGHTS_PATH_W, 'utf-8')); }
        catch { return ServerAI.DEFAULT_WEIGHTS; }
    }
    function saveWeights(w) { fs.writeFileSync(WEIGHTS_PATH_W, JSON.stringify(w, null, 4)); }
    function mutate(base) {
        const w = { ...base };
        for (const k of Object.keys(w))
            if (Math.random() < MUTATION_RATE)
                w[k] = Math.max(0.01, w[k] + w[k] * MUTATION_STR * (Math.random() * 2 - 1));
        return w;
    }

    function actionToSearch(action) {
        if (!action) return null;
        const p = action.payload;
        if (action.type === 'SPAWN')  return { type: 'spawn',  index: p.index, row: p.row, col: p.col };
        if (action.type === 'MOVE')   return { type: 'move',   minionId: p.minionId, row: p.row, col: p.col };
        if (action.type === 'ATTACK') return { type: 'attack', minionId: p.minionId, row: p.row, col: p.col };
        return null;
    }

    async function runMatch(wA, wB) {
        const minionLoader = new MinionLoader();
        const gameState    = new GameState();
        const turnManager  = new TurnManager(gameState);
        const deck         = DeckManager.createDefaultDeck(minionLoader);

        gameState.players.blue.deck = DeckManager.shuffle(DeckManager.createDeck(deck));
        gameState.players.red.deck  = DeckManager.shuffle(DeckManager.createDeck(deck));
        const villager = minionLoader.getConfig('villager');
        gameState.players.blue.hand = [{ ...villager, deckCard: true }];
        gameState.players.red.hand  = [{ ...villager, deckCard: true }];

        const aiBlue = new ServerAI({ color: 'blue', weights: wA, minionLoader, difficulty: 'balanced' });
        const aiRed  = new ServerAI({ color: 'red',  weights: wB, minionLoader, difficulty: 'balanced' });
        aiBlue.engine.evalNoise = 5;
        aiRed.engine.evalNoise  = 5;

        turnManager.startGame();
        if (Math.random() < 0.5) gameState.currentPlayer = 'red';

        let turns = 0;
        while (gameState.phase !== 'gameOver' && turns < MAX_TURNS) {
            const ai      = gameState.currentPlayer === 'blue' ? aiBlue : aiRed;
            const actions = await ai.decideTurn(gameState);
            for (const action of actions) {
                if (gameState.phase === 'gameOver') break;
                if (action.type === 'END_TURN') { turnManager.endTurn(); turns++; break; }
                const sa = actionToSearch(action);
                if (sa) gameState.applySearchAction(sa, minionLoader);
            }
        }

        if (gameState.winner) return gameState.winner;
        const be = aiBlue.engine.evaluateState(gameState, 'blue');
        const re = aiRed.engine.evaluateState(gameState, 'red');
        if (be !== re) return be > re ? 'blue' : 'red';
        let bm = 0, rm = 0;
        for (const m of gameState.minionRegistry.values()) {
            const v = m.id === 'villager' ? 100 : (m.cost || 1);
            if (m.owner === 'blue') bm += v; else rm += v;
        }
        return bm >= rm ? 'blue' : 'red';
    }

    async function trainLoop() {
        let gen = 0;
        while (true) {
            // Check for stop signal
            const msg = await new Promise(resolve => {
                parentPort.once('message', resolve);
                setImmediate(() => resolve(null)); // don't block if no message
            });
            if (msg === 'stop') { parentPort.postMessage({ type: 'stopped' }); break; }

            gen++;
            const current    = loadWeights();
            const challenger = mutate(current);

            const r1 = await runMatch(challenger, current);
            const r2 = await runMatch(current, challenger);

            const wins = (r1 === 'blue' ? 1 : 0) + (r2 === 'red' ? 1 : 0);
            if (wins >= 2) {
                saveWeights(challenger);
                parentPort.postMessage({ type: 'gen', gen, result: 'updated' });
            } else {
                parentPort.postMessage({ type: 'gen', gen, result: `${wins}/2` });
            }
        }
    }

    trainLoop();
}

// ─── Main thread exports ──────────────────────────────────────────────────────
export function startIdleTrainer(roomManager) {
    let worker = null;

    function spawnWorker() {
        if (worker) return;
        worker = new Worker(__filename);
        worker.on('message', (msg) => {
            if (msg.type === 'gen') {
                console.log(`[IDLE TRAINER] Gen ${msg.gen} — ${msg.result === 'updated' ? 'weights updated' : `challenger won ${msg.result}, keeping weights`}`);
            } else if (msg.type === 'stopped') {
                worker = null;
            }
        });
        worker.on('error', (err) => {
            console.error('[IDLE TRAINER] Worker error:', err.message);
            worker = null;
        });
        worker.on('exit', () => { worker = null; });
    }

    function stopWorker() {
        if (worker) {
            worker.postMessage('stop');
        }
    }

    // Expose abort for matchmaking hook
    roomManager.abortTraining = () => {
        stopWorker();
    };

    // Poll: start worker when idle, stop when busy
    setInterval(() => {
        const busy = roomManager.rooms.size > 0 || roomManager.matchmakingQueue.length > 0;
        if (busy) {
            stopWorker();
        } else if (!worker) {
            spawnWorker();
        }
    }, 3000);

    // Start immediately
    spawnWorker();
    console.log('[IDLE TRAINER] Started — training in background worker');
}
