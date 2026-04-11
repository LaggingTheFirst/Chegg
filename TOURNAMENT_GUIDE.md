# Tournament System Guide

## Overview

The Chegg game now includes a Swiss-style tournament system that allows players to compete in organized multi-round competitions.

## What is Swiss-Style?

Swiss tournaments pair players with similar records each round. Unlike elimination brackets, everyone plays all rounds regardless of wins/losses. After the final round, the player with the most points wins.

## Features

- **Flexible Round Count**: Configure 1-10 rounds per tournament
- **Custom Time Controls**: Set time limits per player (default 15 minutes)
- **Automatic Pairing**: Smart pairing algorithm matches players with similar scores
- **Bye Handling**: Odd-player tournaments automatically award byes (1 point)
- **Tiebreakers**: Uses opponent points and ELO for fair rankings
- **Live Standings**: Real-time leaderboard updates after each match
- **Match History**: Track all tournament games

## How to Use

### Creating a Tournament (Admin Only)

1. Login to the admin panel at `/admin.html`
2. Click "Manage Tournaments" button
3. Fill in tournament details:
   - Tournament name
   - Description (optional)
   - Number of rounds (typically 5-7 for Swiss)
   - Time control per player in seconds
   - Scheduled start date/time (optional)
4. Click "Create Tournament"

The tournament will appear on the public tournaments page in "registration" status.

### Registering Players

1. Players navigate to the Tournaments page from the main menu
2. Players must have:
   - A username set in their profile
   - At least one saved deck
3. Click "Register for Tournament" on the tournament page
4. First saved deck is automatically used
5. Players can unregister before the tournament starts

### Starting the Tournament (Admin Only)

1. Go to Tournament Admin panel
2. Once enough players are registered (minimum 2)
3. Click "Start" on the tournament
4. First round pairings are generated automatically
5. Players can now join their matches

### Playing Matches

1. When it's your round, click "Join My Match" on the tournament page
2. Wait for your opponent to join
3. Game starts automatically when both players are present
4. Match results are recorded automatically when game ends
5. If you have a bye, you automatically get 1 point

### Advancing Rounds (Admin Only)

1. Monitor the tournament page to see when all matches complete
2. In Tournament Admin, click "Next Round" for the tournament
3. New pairings are generated based on current standings
4. Players are notified and can join their new matches

### Viewing Results

- **Standings Tab**: Shows current rankings with:
  - Points (1 per win)
  - Win/Loss record
  - Opponent points (tiebreaker)
- **Pairings Tab**: Shows current round matches and results

## Pairing Algorithm

The Swiss pairing system works as follows:

1. **Sort players** by:
   - Points (descending)
   - Opponent total points (descending)
   - ELO rating (descending)

2. **Pair from top down**:
   - Try to pair with next player of same score
   - Avoid repeat pairings
   - If no valid opponent, pair with next available player

3. **Handle odd players**:
   - Lowest-ranked unpaired player receives bye
   - Bye awards 1 point automatically
   - Players can only receive one bye per tournament

## API Endpoints

### Public Endpoints

- `GET /api/tournaments` - List all tournaments
- `GET /api/tournament/:id` - Get tournament details, standings, and pairings
- `POST /api/tournament/:id/register` - Register for tournament
- `POST /api/tournament/:id/unregister` - Unregister from tournament

### Admin-Only Endpoints (Require Authentication)

- `POST /api/tournament/create` - Create new tournament
- `POST /api/tournament/:id/start` - Start tournament (begins round 1)
- `POST /api/tournament/:id/advance` - Advance to next round
- `DELETE /api/tournament/:id` - Delete tournament

### WebSocket Events

- `join_tournament_match` - Join your assigned match
  - Payload: `{ tournamentId, username, deck }`

## Tournament Configuration

Tournaments are configured by admins in the Tournament Admin panel:

```javascript
{
  name: 'Tournament Name',
  description: 'Optional description',
  rounds: 5,              // Number of rounds
  timeControl: 900,       // Seconds per player (15 min)
  scheduledStart: null,   // Optional timestamp for scheduled start
  status: 'registration', // registration, active, completed
}
```

### Scheduled Tournaments

Admins can set a scheduled start time when creating tournaments:
- Players see "Starts in X days" on the tournament page
- Useful for weekly/monthly tournaments
- Admin still needs to manually start the tournament at the scheduled time
- Helps players plan ahead and register early

## Database Storage

Completed tournaments are saved to LevelDB:
- Key: `tournament:{tournamentId}`
- Includes full standings, match history, and metadata

## Tips for Tournament Organizers

1. **Announce Early**: Create tournaments 1-2 weeks in advance with scheduled start times

2. **Round Count**: Use formula `log2(players) + 2` for optimal rounds
   - 8 players = 5 rounds
   - 16 players = 6 rounds
   - 32 players = 7 rounds

3. **Time Controls**:
   - Blitz: 180s (3 min)
   - Rapid: 600s (10 min)
   - Standard: 900s (15 min)
   - Long: 1800s (30 min)

4. **Registration Period**: Keep registration open for at least a week to build player base

5. **Scheduling**: Allow 5-10 minutes between rounds for players to rest

6. **Communication**: Use the description field to explain rules, prizes, or special conditions

7. **Monitoring**: Check the tournament page regularly during active rounds to see match progress

8. **Tiebreakers**: If two players tie on points, winner is determined by:
   - Total opponent points (strength of schedule)
   - ELO rating

## Future Enhancements

Potential additions:
- Tournament chat/lobby
- Scheduled start times
- Prize tracking
- Team tournaments
- Double elimination option
- Arena/ladder system
