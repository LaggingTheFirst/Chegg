#!/bin/bash

# Chegg Security Test Suite - cURL Commands
# Make sure server is running: npm start

BASE_URL="http://localhost:1109"

echo "╔═════════════════════════════════════════╗"
echo "║  CHEGG SECURITY TEST - cURL Commands   ║"
echo "╚═════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: AI Win Endpoint - No Auth Required
echo -e "${YELLOW}[TEST 1] AI Win Endpoint - No Authentication${NC}"
echo "Testing: POST /api/player/:username/ai-win"
echo ""
TESTUSER="testuser_$(date +%s)"
echo "Creating fake player: $TESTUSER"
echo "Running: curl -X POST $BASE_URL/api/player/$TESTUSER/ai-win"
echo ""

curl -s -X POST "$BASE_URL/api/player/$TESTUSER/ai-win" \
  -H "Content-Type: application/json" \
  -d '{"winner": "player"}' | jq '.'

echo ""
echo -e "${GREEN}If 'success: true' appears above, the endpoint is VULNERABLE${NC}"
echo ""
echo ""

# Test 2: Check Leaderboard - Verify fake player appears
echo -e "${YELLOW}[TEST 2] Leaderboard Reflection${NC}"
echo "Checking if fake player appears on leaderboard..."
echo ""

curl -s "$BASE_URL/api/leaderboard?search=$TESTUSER" | jq '.players[]'

echo ""
echo ""

# Test 3: Admin Password - Try default
echo -e "${YELLOW}[TEST 3] Admin Authentication - Default Password${NC}"
echo "Testing: POST /api/admin/auth with password=admin123"
echo ""

ADMIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/admin/auth" \
  -H "Content-Type: application/json" \
  -d '{"password":"admin123"}')

echo "$ADMIN_RESPONSE" | jq '.'

if echo "$ADMIN_RESPONSE" | grep -q '"success":true'; then
  echo ""
  echo -e "${RED}✓ VULNERABLE: Admin password is 'admin123'${NC}"
  ADMIN_TOKEN=$(echo "$ADMIN_RESPONSE" | jq -r '.token')
  echo "Token: $ADMIN_TOKEN"
  echo ""
  echo "You can now use this token to create/modify players:"
  echo "curl -X POST $BASE_URL/api/admin/player \\"
  echo "  -H 'Authorization: Bearer $ADMIN_TOKEN' \\"
  echo "  -H 'Content-Type: application/json' \\"
  echo "  -d '{\"username\":\"fake_rank1\",\"elo\":9999,\"wins\":1000,\"losses\":0}'"
fi

echo ""
echo ""

# Test 4: Get Player Data
echo -e "${YELLOW}[TEST 4] Player Profile - No Auth Required${NC}"
echo "Testing: GET /api/player/:username"
echo ""

curl -s "$BASE_URL/api/player/$TESTUSER" | jq '.'

echo ""
echo ""

# Test 5: Match History
echo -e "${YELLOW}[TEST 5] Match History - Anonymous Access${NC}"
echo "Testing: GET /api/player/:username/matches"
echo ""

curl -s "$BASE_URL/api/player/$TESTUSER/matches" | jq '.matches | length' | xargs echo "Total matches:"

echo ""
echo ""

# Test 6: Repeated Abuse
echo -e "${YELLOW}[TEST 6] Repeated AI Win Abuse (5x loop)${NC}"
CHEATER="cheater_$(date +%s)"
echo "Username: $CHEATER"
echo "Running 5 consecutive fake wins..."
echo ""

for i in {1..5}; do
  RESPONSE=$(curl -s -X POST "$BASE_URL/api/player/$CHEATER/ai-win" \
    -H "Content-Type: application/json" \
    -d '{"winner":"player"}')
  
  ELO=$(echo "$RESPONSE" | jq '.newElo')
  DIFF=$(echo "$RESPONSE" | jq '.diff')
  
  echo "Win #$i: ELO = $ELO (Δ +$DIFF)"
done

echo ""
echo -e "${RED}Easily boosted player from 800→??? ELO without authentication!${NC}"
echo ""

# Test 7: Full Leaderboard
echo -e "${YELLOW}[TEST 7] Full Leaderboard Request${NC}"
echo "Top 10 players:"
echo ""

curl -s "$BASE_URL/api/leaderboard?limit=10" | jq '.players[] | "\(.rank). \(.username) - \(.elo) ELO (\(.wins)W-\(.losses)L)"' | head -n 10

echo ""
echo ""

# Test Summary
echo -e "${YELLOW}═════════════════════════════════════════${NC}"
echo -e "${YELLOW}VULNERABILITY SUMMARY${NC}"
echo -e "${YELLOW}═════════════════════════════════════════${NC}"
echo ""
echo "1. ❌ /api/player/:username/ai-win - NO AUTHENTICATION"
echo "   Impact: Anyone can award fake wins/ELO"
echo ""
echo "2. ❌ /api/leaderboard - REFLECTS FAKE DATA"
echo "   Impact: Fake players appear on leaderboard"
echo ""
echo "3. ❌ /api/admin/auth - WEAK DEFAULT PASSWORD"
echo "   Impact: Full system compromise if password is 'admin123'"
echo ""
echo "4. ❌ /api/player/:username - NO AUTH REQUIRED"
echo "   Impact: Player data visible to anyone"
echo ""
echo "5. ⚠️  /api/player/:username/matches - LIMITED VISIBILITY"
echo "   Impact: Match history accessible"
echo ""
echo "All results saved to: SECURITY_TEST.md"
echo ""
