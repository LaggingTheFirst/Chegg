import { GameState } from '../js/engine/GameState.js';
import { TurnManager } from '../js/engine/TurnManager.js';
import { DeckManager } from '../js/engine/DeckManager.js';
import { MinionLoader } from '../js/minions/MinionLoader.js';
import { ServerAI } from './ai/ServerAI.js';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEIGHTS_PATH = path.join(__dirname, 'ai', 'weights.json');
const OPENINGS_PATH = path.join(__dirname, 'ai', 'openings.json');

const POPULATION_SIZE = 8;
const GENERATIONS = 20;
const MATCHES_PER_PAIR = 2;
const MAX_TURNS = 200;
const MUTATION_RATE = 0.5; // Increased from 0.3 to create more diversity
const MUTATION_STRENGTH = 0.4; // Increased from 0.25 for bigger changes
const TRAIN_DEPTH = 3;
const TRAIN_QUIESCENCE = 1;
const TD_LEARNING_RATE = 0.005;
const TD_LAMBDA = 0.7;
const NUM_WORKERS = Math.max(1, Math.min(8, (await import('os')).default.cpus().length - 2));

function loadWeights() {
    try { return JSON.parse(fs.readFileSync(WEIGHTS_PATH, 'utf-8')); }
    catch (e) { return ServerAI.DEFAULT_WEIGHTS; }
}

function saveWeights(weights) {
    fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(weights, null, 4));
}

function loadOpenings() {
    try { return JSON.parse(fs.readFileSync(OPENINGS_PATH, 'utf-8')); }
    catch (e) { return {}; }
}

function saveOpenings(book) {
    fs.writeFileSync(OPENINGS_PATH, JSON.stringify(book, null, 2));
}

function mutateWeights(base) {
    const mutated = { ...base };
    for (const key of Object.keys(mutated)) {
        if (Math.random() < MUTATION_RATE) {
            const delta = mutated[key] * MUTATION_STRENGTH * (Math.random() * 2 - 1);
            mutated[key] = Math.max(0.01, mutated[key] + delta);
        }
    }
    return normalizeWeights(mutated);
}

function normalizeWeights(weights) {
    let max = 0;
    for (const key in weights) if (Math.abs(weights[key]) > max) max = Math.abs(weights[key]);
    if (max > 100) {
        const scale = 100 / max;
        for (const key in weights) weights[key] *= scale;
    }
    return weights;
}

function crossover(a, b) {
    const child = {};
    for (const key of Object.keys(a)) {
        child[key] = Math.random() < 0.5 ? a[key] : b[key];
    }
    return child;
}

function tdUpdate(positions, outcome, weights) {
    const updated = { ...weights };
    const n = positions.length;
    if (n < 2) return updated;

    const eligibility = {};
    for (const key of Object.keys(weights)) eligibility[key] = 0;

    for (let t = 0; t < n - 1; t++) {
        const currentFeatures = positions[t].features;
        const currentEval = positions[t].eval;
        const nextEval = t === n - 2 ? (outcome > 0 ? 1000000000 : -1000000000) : positions[t + 1].eval;
        const tdError = nextEval - currentEval;

        for (const key of Object.keys(weights)) {
            eligibility[key] = TD_LAMBDA * eligibility[key] + (currentFeatures[key] || 0);
            updated[key] += TD_LEARNING_RATE * tdError * eligibility[key];
            if (Math.abs(updated[key]) < 0.001) updated[key] = 0.01;
        }
    }

    return normalizeWeights(updated);
}

function runHeadlessMatch(weightsA, weightsB, collectPositions = false) {
    const minionLoader = new MinionLoader();
    const gameState = new GameState();
    const turnManager = new TurnManager(gameState);

    const deck = DeckManager.createDefaultDeck(minionLoader);
    gameState.players.blue.deck = DeckManager.shuffle(DeckManager.createDeck(deck));
    gameState.players.red.deck = DeckManager.shuffle(DeckManager.createDeck(deck));

    const villager = minionLoader.getConfig('villager');
    gameState.players.blue.hand = [{ ...villager, deckCard: true }];
    gameState.players.red.hand = [{ ...villager, deckCard: true }];

    const aiBlue = new ServerAI({ color: 'blue', weights: weightsA, minionLoader, difficulty: 'balanced' });
    const aiRed = new ServerAI({ color: 'red', weights: weightsB, minionLoader, difficulty: 'balanced' });
    aiBlue.settings.searchDepth = TRAIN_DEPTH;
    aiBlue.settings.quiescenceDepth = TRAIN_QUIESCENCE;
    aiRed.settings.searchDepth = TRAIN_DEPTH;
    aiRed.settings.quiescenceDepth = TRAIN_QUIESCENCE;
    
    // Add evaluation noise to break symmetry in mirror matches
    aiBlue.evalNoise = 5;
    aiRed.evalNoise = 5;

    turnManager.startGame();

    const bluePositions = [];
    const redPositions = [];
    const openingMoves = { blue: [], red: [] };
    
    // Randomize starting player to reduce first-player advantage
    if (Math.random() < 0.5) {
        gameState.currentPlayer = 'red';
    }

    let turns = 0;
    while (gameState.phase !== 'gameOver' && turns < MAX_TURNS) {
        const currentAI = gameState.currentPlayer === 'blue' ? aiBlue : aiRed;
        const currentColor = gameState.currentPlayer;

        if (collectPositions) {
            const features = currentAI.extractFeatures(gameState, currentColor);
            const evalScore = currentAI.evaluateState(gameState, currentColor);
            const posData = { features, eval: evalScore };
            if (currentColor === 'blue') bluePositions.push(posData);
            else redPositions.push(posData);
        }

        const actions = currentAI.decideTurn(gameState, 200);

        for (const action of actions) {
            if (gameState.phase === 'gameOver') break;
            const { type, payload } = action;
            const color = gameState.currentPlayer;

            if (turns <= 6 && type !== 'END_TURN') {
                if (currentColor === 'blue') openingMoves.blue.push(action);
                else openingMoves.red.push(action);
            }

            if (type === 'SPAWN_MINION') {
                const ps = gameState.players[color];
                const card = ps.hand[payload.cardIndex];
                if (card && gameState.isSpawnZone(payload.row, color) && !gameState.getMinionAt(payload.row, payload.col) && ps.mana >= card.cost) {
                    ps.mana -= card.cost;
                    const minion = minionLoader.createSpecializedMinion(card.id, color);
                    gameState.placeMinion(minion, payload.row, payload.col); // onSpawn called inside
                    ps.hand.splice(payload.cardIndex, 1);
                }
            } else if (type === 'MOVE_MINION') {
                const minion = gameState.minionRegistry.get(payload.minionId);
                if (minion && minion.owner === color) {
                    const instance = gameState.rehydrateMinion(minion, minionLoader);
                    const valid = instance.getValidMoves(gameState);
                    if (valid.some(m => m.row === payload.toRow && m.col === payload.toCol)) {
                        const needsDash = minion.hasMoved;
                        const isVillager = minion.id === 'villager';
                        let cost = 0;
                        if (needsDash) cost = 1;
                        else if (isVillager) cost = 1; // first villager move costs 1

                        if (gameState.players[color].mana >= cost) {
                            gameState.players[color].mana -= cost;
                            gameState.moveMinion(minion, payload.toRow, payload.toCol);
                            if (needsDash) { minion.hasDashed = true; minion.hasActedThisTurn = true; }
                            else { minion.hasMoved = true; }
                        }
                    }
                }
            } else if (type === 'ATTACK_MINION') {
                const minion = gameState.minionRegistry.get(payload.attackerId);
                if (minion && minion.owner === color) {
                    const target = gameState.getMinionAt(payload.targetRow, payload.targetCol);
                    if (target && target.owner !== color) {
                        const config = minionLoader.getConfig(minion.id);
                        const cost = config.attackCost || 1;
                        if (gameState.players[color].mana >= cost) {
                            gameState.players[color].mana -= cost;
                            gameState.removeMinion(target);
                            minion.hasAttacked = true;
                            minion.hasActedThisTurn = true;
                            if (minion.id !== 'skeleton' && config.movesToAttack) {
                                gameState.moveMinion(minion, payload.targetRow, payload.targetCol);
                            }
                        }
                    }
                }
            } else if (type === 'END_TURN') {
                turnManager.endTurn();
                turns++;
                break;
            }
        }
    }

    // If game didn't end naturally, determine winner by evaluation
    let winner = gameState.winner;
    let timeoutWin = false;
    if (!winner && gameState.phase !== 'gameOver') {
        timeoutWin = true;
        const blueEval = aiBlue.evaluateState(gameState, 'blue');
        const redEval = aiRed.evaluateState(gameState, 'red');
        
        // Use evaluation difference - even small differences matter
        if (blueEval !== redEval) {
            winner = blueEval > redEval ? 'blue' : 'red';
        }
        // If evaluations are exactly equal, use material count
        else {
            let blueMaterial = 0, redMaterial = 0;
            for (const minion of gameState.minionRegistry.values()) {
                const value = minion.id === 'villager' ? 100 : (minion.cost || 1);
                if (minion.owner === 'blue') blueMaterial += value;
                else redMaterial += value;
            }
            if (blueMaterial !== redMaterial) {
                winner = blueMaterial > redMaterial ? 'blue' : 'red';
            }
            // If still tied, use piece count
            else {
                const blueCount = gameState.getPlayerMinions('blue').length;
                const redCount = gameState.getPlayerMinions('red').length;
                if (blueCount !== redCount) {
                    winner = blueCount > redCount ? 'blue' : 'red';
                }
                // If still tied, check villager safety (distance from enemy pieces)
                else {
                    const blueVillager = gameState.players.blue.villager;
                    const redVillager = gameState.players.red.villager;
                    if (blueVillager?.position && redVillager?.position) {
                        let blueMinDist = 999, redMinDist = 999;
                        for (const minion of gameState.minionRegistry.values()) {
                            if (minion.id === 'villager') continue;
                            if (minion.owner === 'red' && blueVillager.position) {
                                const dist = Math.abs(minion.position.row - blueVillager.position.row) + 
                                           Math.abs(minion.position.col - blueVillager.position.col);
                                blueMinDist = Math.min(blueMinDist, dist);
                            }
                            if (minion.owner === 'blue' && redVillager.position) {
                                const dist = Math.abs(minion.position.row - redVillager.position.row) + 
                                           Math.abs(minion.position.col - redVillager.position.col);
                                redMinDist = Math.min(redMinDist, dist);
                            }
                        }
                        // Whoever's villager is safer (further from enemies) wins
                        if (blueMinDist !== redMinDist) {
                            winner = blueMinDist > redMinDist ? 'blue' : 'red';
                        }
                    }
                }
            }
        }
        
        // Absolute last resort: random
        if (!winner) {
            winner = Math.random() < 0.5 ? 'blue' : 'red';
        }
    }

    return {
        winner: winner,
        bluePositions,
        redPositions,
        openingMoves: winner ? openingMoves : null
    };
}

if (!isMainThread) {
    const { matchups } = workerData;
    const results = [];
    for (const { weightsA, weightsB, id, collectTD } of matchups) {
        const result = runHeadlessMatch(weightsA, weightsB, collectTD);
        results.push({
            id,
            winner: result.winner,
            bluePositions: collectTD ? result.bluePositions : null,
            redPositions: collectTD ? result.redPositions : null,
            openingMoves: result.openingMoves,
            hitTimeout: result.hitTimeout
        });
    }
    parentPort.postMessage(results);
} else {
    async function runMatchupsParallel(matchups) {
        if (matchups.length === 0) return [];
        const chunkSize = Math.ceil(matchups.length / NUM_WORKERS);
        const chunks = [];
        for (let i = 0; i < matchups.length; i += chunkSize) chunks.push(matchups.slice(i, i + chunkSize));

        const promises = chunks.map(chunk =>
            new Promise((resolve, reject) => {
                const worker = new Worker(__filename, { workerData: { matchups: chunk } });
                worker.on('message', resolve);
                worker.on('error', reject);
            })
        );

        const chunkResults = await Promise.all(promises);
        return chunkResults.flat();
    }

    async function train() {
        console.log('=== CHEGG AI TRAINING (TD + Genetic) ===');
        console.log(`Pop: ${POPULATION_SIZE} | Gen: ${GENERATIONS} | Workers: ${NUM_WORKERS} | TD-λ: ${TD_LAMBDA}`);

        const baseWeights = loadWeights();
        const openingBook = loadOpenings();

        // Create initial population with more diversity
        let population = [baseWeights];
        for (let i = 1; i < POPULATION_SIZE; i++) {
            // Apply mutation multiple times for more initial diversity
            let mutated = { ...baseWeights };
            const mutationPasses = 1 + Math.floor(i / 2); // More mutations for later members
            for (let pass = 0; pass < mutationPasses; pass++) {
                mutated = mutateWeights(mutated);
            }
            population.push(mutated);
        }

        for (let gen = 0; gen < GENERATIONS; gen++) {
            const startTime = Date.now();
            const useTD = gen >= 3;
            console.log(`\n--- Gen ${gen + 1}/${GENERATIONS} ${useTD ? '(+TD)' : ''} ---`);

            const matchups = [];
            for (let i = 0; i < population.length; i++) {
                const opponents = [];
                for (let j = 0; j < population.length; j++) { if (j !== i) opponents.push(j); }
                const selected = opponents.sort(() => Math.random() - 0.5).slice(0, 3);
                for (const oppIdx of selected) {
                    for (let m = 0; m < MATCHES_PER_PAIR; m++) {
                        // Candidate i plays as blue
                        matchups.push({ 
                            weightsA: population[i], 
                            weightsB: population[oppIdx], 
                            id: `${i}-blue-vs-${oppIdx}-${m}`, 
                            collectTD: useTD 
                        });
                        // Candidate i plays as red
                        matchups.push({ 
                            weightsA: population[oppIdx], 
                            weightsB: population[i], 
                            id: `${i}-red-vs-${oppIdx}-${m}`, 
                            collectTD: useTD 
                        });
                    }
                }
            }

            const results = await runMatchupsParallel(matchups);

            const wins = new Array(population.length).fill(0);
            const games = new Array(population.length).fill(0);
            let naturalWins = 0;
            let timeoutWins = 0;
            let blueWins = 0;
            let redWins = 0;
            
            // Debug: track first few results
            const debugResults = [];

            for (const { id, winner, bluePositions, redPositions, openingMoves, hitTimeout } of results) {
                const parts = id.split('-');
                const candidateIdx = parseInt(parts[0]);
                const side = parts[1]; // 'blue' or 'red'
                games[candidateIdx]++;
                
                // Candidate wins if they were blue and blue won, OR they were red and red won
                const didWin = (side === 'blue' && winner === 'blue') || (side === 'red' && winner === 'red');
                if (didWin) {
                    wins[candidateIdx]++;
                }
                
                if (hitTimeout) timeoutWins++;
                else naturalWins++;
                
                if (winner === 'blue') blueWins++;
                else if (winner === 'red') redWins++;
                
                // Debug first 10 matches
                if (debugResults.length < 10) {
                    debugResults.push({ id, winner, candidateIdx, side, didWin });
                }

                if (useTD && winner) {
                    const isWinner = (side === 'blue' && winner === 'blue') || (side === 'red' && winner === 'red');
                    if (isWinner) {
                        const positions = side === 'blue' ? bluePositions : redPositions;
                        if (positions && positions.length > 2) {
                            population[candidateIdx] = tdUpdate(positions, 1, population[candidateIdx]);
                        }
                    }
                }

                if (winner && openingMoves) {
                    const winnerColor = winner;
                    const moves = openingMoves[winnerColor];
                    if (moves && moves.length > 0) {
                        if (!openingBook[winnerColor]) openingBook[winnerColor] = {};
                        const key = `turn_${moves.length}`;
                        if (!openingBook[winnerColor][key]) openingBook[winnerColor][key] = { moves, count: 1 };
                        else openingBook[winnerColor][key].count++;
                    }
                }
            }
            
            // Print debug info for first generation
            if (gen === 0) {
                console.log('\n  DEBUG - First 10 match results:');
                for (const r of debugResults) {
                    console.log(`    ${r.id} -> winner: ${r.winner}, candidate ${r.candidateIdx} as ${r.side}: ${r.didWin ? 'WIN' : 'LOSS'}`);
                }
                console.log(`  Total games per candidate: ${games[0]}`);
                console.log(`  Wins: [${wins.join(', ')}]`);
            }

            const scores = population.map((w, i) => ({
                index: i,
                winRate: games[i] > 0 ? wins[i] / games[i] : 0,
                weights: w
            }));
            scores.sort((a, b) => b.winRate - a.winRate);

            for (const s of scores) process.stdout.write(`  #${s.index + 1}: ${(s.winRate * 100).toFixed(1)}%\n`);
            console.log(`  Best: ${(scores[0].winRate * 100).toFixed(1)}% | Blue: ${blueWins}/${results.length} (${(blueWins/results.length*100).toFixed(1)}%) | Red: ${redWins}/${results.length} (${(redWins/results.length*100).toFixed(1)}%)`);

            const survivors = scores.slice(0, Math.ceil(POPULATION_SIZE / 2));
            const nextGen = survivors.map(s => s.weights);
            while (nextGen.length < POPULATION_SIZE) {
                const a = survivors[Math.floor(Math.random() * survivors.length)].weights;
                const b = survivors[Math.floor(Math.random() * survivors.length)].weights;
                nextGen.push(mutateWeights(crossover(a, b)));
            }
            population = nextGen;

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`  ${elapsed}s | ${matchups.length} matches`);
        }

        saveWeights(population[0]);
        saveOpenings(openingBook);
        console.log('\n=== TRAINING COMPLETE ===');
        console.log('Weights saved to', WEIGHTS_PATH);
        console.log('Opening book saved to', OPENINGS_PATH);
        console.log(JSON.stringify(population[0], null, 2));
    }

    train();
}
