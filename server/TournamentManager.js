export class TournamentManager {
    constructor(db) {
        this.db = db;
        this.tournaments = new Map(); // tournamentId -> tournament data
        this.activeTournaments = new Set(); // IDs of ongoing tournaments
    }

    createTournament(config) {
        const tournamentId = `tournament_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        
        const tournament = {
            id: tournamentId,
            name: config.name || 'Swiss Tournament',
            rounds: config.rounds || 5,
            currentRound: 0,
            status: 'registration', // registration, active, completed
            participants: [], // [{ username, elo, deck }]
            standings: new Map(), // username -> { wins, losses, points, opponents: [], byes: 0 }
            matches: [], // [{ round, player1, player2, winner, roomId }]
            timeControl: config.timeControl || 900, // seconds per player
            createdAt: Date.now(),
            scheduledStart: config.scheduledStart || null, // timestamp for when tournament starts
            startedAt: null,
            completedAt: null,
            description: config.description || ''
        };

        this.tournaments.set(tournamentId, tournament);
        this.activeTournaments.add(tournamentId);
        
        console.log(`[TOURNAMENT] Created: ${tournamentId} - ${tournament.name}`);
        return tournament;
    }

    registerPlayer(tournamentId, username, elo, deck) {
        const tournament = this.tournaments.get(tournamentId);
        if (!tournament) return { success: false, error: 'Tournament not found' };
        if (tournament.status !== 'registration') {
            return { success: false, error: 'Registration is closed' };
        }

        // Check if already registered
        if (tournament.participants.some(p => p.username === username)) {
            return { success: false, error: 'Already registered' };
        }

        tournament.participants.push({ username, elo, deck });
        tournament.standings.set(username, {
            wins: 0,
            losses: 0,
            points: 0,
            opponents: [],
            byes: 0
        });

        console.log(`[TOURNAMENT] ${username} registered for ${tournamentId}`);
        return { success: true };
    }

    unregisterPlayer(tournamentId, username) {
        const tournament = this.tournaments.get(tournamentId);
        if (!tournament) return { success: false, error: 'Tournament not found' };
        if (tournament.status !== 'registration') {
            return { success: false, error: 'Cannot unregister after tournament starts' };
        }

        tournament.participants = tournament.participants.filter(p => p.username !== username);
        tournament.standings.delete(username);

        console.log(`[TOURNAMENT] ${username} unregistered from ${tournamentId}`);
        return { success: true };
    }

    startTournament(tournamentId) {
        const tournament = this.tournaments.get(tournamentId);
        if (!tournament) return { success: false, error: 'Tournament not found' };
        if (tournament.status !== 'registration') {
            return { success: false, error: 'Tournament already started' };
        }
        if (tournament.participants.length < 2) {
            return { success: false, error: 'Need at least 2 players' };
        }

        tournament.status = 'active';
        tournament.startedAt = Date.now();
        tournament.currentRound = 1;

        console.log(`[TOURNAMENT] Starting ${tournamentId} with ${tournament.participants.length} players`);
        
        // Generate first round pairings
        const pairings = this.generatePairings(tournament);
        return { success: true, pairings };
    }

    generatePairings(tournament) {
        const round = tournament.currentRound;
        console.log(`[TOURNAMENT] Generating pairings for round ${round}`);

        // Get standings sorted by points, then by opponents' total points (tiebreaker)
        const standings = Array.from(tournament.standings.entries()).map(([username, stats]) => {
            const participant = tournament.participants.find(p => p.username === username);
            return {
                username,
                elo: participant?.elo || 400,
                deck: participant?.deck || [],
                ...stats,
                opponentPoints: this.calculateOpponentPoints(tournament, username)
            };
        });

        // Sort by points (desc), then opponent points (desc), then elo (desc)
        standings.sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            if (b.opponentPoints !== a.opponentPoints) return b.opponentPoints - a.opponentPoints;
            return b.elo - a.elo;
        });

        const paired = new Set();
        const pairings = [];

        // Swiss pairing: pair players with similar scores who haven't played each other
        for (let i = 0; i < standings.length; i++) {
            if (paired.has(standings[i].username)) continue;

            let opponent = null;
            
            // Try to find opponent with same score who hasn't been played
            for (let j = i + 1; j < standings.length; j++) {
                if (paired.has(standings[j].username)) continue;
                if (standings[i].opponents.includes(standings[j].username)) continue;
                
                opponent = standings[j];
                break;
            }

            // If no valid opponent found, pair with next available
            if (!opponent) {
                for (let j = i + 1; j < standings.length; j++) {
                    if (paired.has(standings[j].username)) continue;
                    opponent = standings[j];
                    break;
                }
            }

            if (opponent) {
                pairings.push({
                    player1: standings[i].username,
                    player2: opponent.username,
                    deck1: standings[i].deck,
                    deck2: opponent.deck
                });
                paired.add(standings[i].username);
                paired.add(opponent.username);
            } else {
                // Odd number of players - give bye
                console.log(`[TOURNAMENT] ${standings[i].username} receives a bye`);
                pairings.push({
                    player1: standings[i].username,
                    player2: null, // bye
                    deck1: standings[i].deck,
                    deck2: null
                });
                paired.add(standings[i].username);
                
                // Award bye point
                const stats = tournament.standings.get(standings[i].username);
                stats.points += 1;
                stats.wins += 1;
                stats.byes += 1;
            }
        }

        // Store pairings
        pairings.forEach(pairing => {
            tournament.matches.push({
                round,
                player1: pairing.player1,
                player2: pairing.player2,
                winner: pairing.player2 === null ? pairing.player1 : null, // auto-win for bye
                roomId: null,
                completed: pairing.player2 === null
            });
        });

        return pairings;
    }

    calculateOpponentPoints(tournament, username) {
        const stats = tournament.standings.get(username);
        if (!stats) return 0;

        let total = 0;
        for (const opponent of stats.opponents) {
            const oppStats = tournament.standings.get(opponent);
            if (oppStats) total += oppStats.points;
        }
        return total;
    }

    recordMatchResult(tournamentId, player1, player2, winner) {
        const tournament = this.tournaments.get(tournamentId);
        if (!tournament) return { success: false, error: 'Tournament not found' };

        // Find the match
        const match = tournament.matches.find(m => 
            m.round === tournament.currentRound &&
            m.player1 === player1 &&
            m.player2 === player2 &&
            !m.completed
        );

        if (!match) {
            return { success: false, error: 'Match not found or already completed' };
        }

        match.winner = winner;
        match.completed = true;

        // Update standings
        const loser = winner === player1 ? player2 : player1;
        
        const winnerStats = tournament.standings.get(winner);
        const loserStats = tournament.standings.get(loser);

        if (winnerStats) {
            winnerStats.wins += 1;
            winnerStats.points += 1;
            winnerStats.opponents.push(loser);
        }

        if (loserStats) {
            loserStats.losses += 1;
            loserStats.opponents.push(winner);
        }

        console.log(`[TOURNAMENT] Match result: ${winner} defeated ${loser}`);

        // Check if round is complete
        const roundMatches = tournament.matches.filter(m => m.round === tournament.currentRound);
        const allComplete = roundMatches.every(m => m.completed);

        if (allComplete) {
            console.log(`[TOURNAMENT] Round ${tournament.currentRound} completed`);
            
            if (tournament.currentRound >= tournament.rounds) {
                this.completeTournament(tournamentId);
            }
        }

        return { success: true, roundComplete: allComplete };
    }

    advanceRound(tournamentId) {
        const tournament = this.tournaments.get(tournamentId);
        if (!tournament) return { success: false, error: 'Tournament not found' };

        const roundMatches = tournament.matches.filter(m => m.round === tournament.currentRound);
        const allComplete = roundMatches.every(m => m.completed);

        if (!allComplete) {
            return { success: false, error: 'Current round not complete' };
        }

        if (tournament.currentRound >= tournament.rounds) {
            return { success: false, error: 'Tournament is complete' };
        }

        tournament.currentRound += 1;
        const pairings = this.generatePairings(tournament);

        console.log(`[TOURNAMENT] Advanced to round ${tournament.currentRound}`);
        return { success: true, pairings };
    }

    completeTournament(tournamentId) {
        const tournament = this.tournaments.get(tournamentId);
        if (!tournament) return;

        tournament.status = 'completed';
        tournament.completedAt = Date.now();
        this.activeTournaments.delete(tournamentId);

        console.log(`[TOURNAMENT] Completed: ${tournamentId}`);
        
        // Save to database
        this.saveTournament(tournament);
    }

    async saveTournament(tournament) {
        try {
            const data = {
                ...tournament,
                standings: Array.from(tournament.standings.entries())
            };
            await this.db.put(`tournament:${tournament.id}`, data);
            console.log(`[TOURNAMENT] Saved to database: ${tournament.id}`);
        } catch (err) {
            console.error('[TOURNAMENT] Save error:', err);
        }
    }

    getStandings(tournamentId) {
        const tournament = this.tournaments.get(tournamentId);
        if (!tournament) return null;

        const standings = Array.from(tournament.standings.entries()).map(([username, stats]) => {
            const participant = tournament.participants.find(p => p.username === username);
            return {
                username,
                elo: participant?.elo || 400,
                ...stats,
                opponentPoints: this.calculateOpponentPoints(tournament, username)
            };
        });

        standings.sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            if (b.opponentPoints !== a.opponentPoints) return b.opponentPoints - a.opponentPoints;
            return b.elo - a.elo;
        });

        return standings;
    }

    getCurrentPairings(tournamentId) {
        const tournament = this.tournaments.get(tournamentId);
        if (!tournament) return null;

        return tournament.matches
            .filter(m => m.round === tournament.currentRound)
            .map(m => ({
                player1: m.player1,
                player2: m.player2,
                winner: m.winner,
                completed: m.completed,
                roomId: m.roomId
            }));
    }

    getTournament(tournamentId) {
        return this.tournaments.get(tournamentId);
    }

    getAllTournaments() {
        return Array.from(this.tournaments.values()).map(t => ({
            id: t.id,
            name: t.name,
            status: t.status,
            rounds: t.rounds,
            currentRound: t.currentRound,
            participants: t.participants.length,
            createdAt: t.createdAt,
            scheduledStart: t.scheduledStart,
            description: t.description
        }));
    }

    setMatchRoom(tournamentId, player1, player2, roomId) {
        const tournament = this.tournaments.get(tournamentId);
        if (!tournament) return false;

        const match = tournament.matches.find(m => 
            m.round === tournament.currentRound &&
            m.player1 === player1 &&
            m.player2 === player2
        );

        if (match) {
            match.roomId = roomId;
            return true;
        }
        return false;
    }
}
