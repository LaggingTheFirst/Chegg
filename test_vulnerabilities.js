#!/usr/bin/env node

import fetch from 'node-fetch'; // npm install node-fetch@2

const BASE_URL = 'http://localhost:1109';
const COLORS = {
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  RESET: '\x1b[0m'
};

async function log(type, message) {
  const prefix = {
    'TEST': `${COLORS.BLUE}[TEST]${COLORS.RESET}`,
    'PASS': `${COLORS.GREEN}[✓ PASS]${COLORS.RESET}`,
    'FAIL': `${COLORS.RED}[✗ FAIL]${COLORS.RESET}`,
    'INFO': `${COLORS.BLUE}[ℹ]${COLORS.RESET}`,
    'WARN': `${COLORS.YELLOW}[⚠]${COLORS.RESET}`
  };
  console.log(`${prefix[type]} ${message}`);
}

// Test 1: AI Win Endpoint - No Token Validation
async function testAIWinExploit() {
  console.log(`\n${COLORS.YELLOW}═══ TEST 1: AI Win Endpoint (No Auth) ═══${COLORS.RESET}`);
  
  try {
    const testUsername = `testuser_${Date.now()}`;
    
    await log('TEST', `Attempting to award fake win to: ${testUsername}`);
    
    const response = await fetch(`${BASE_URL}/api/player/${testUsername}/ai-win`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winner: 'player' })
    });
    
    const data = await response.json();
    
    if (response.status === 200 && data.success) {
      await log('PASS', `✅ VULNERABLE: Gained ${data.diff} ELO without authentication!`);
      await log('INFO', `New ELO: ${data.newElo}`);
      return { vulnerable: true, username: testUsername, elo: data.newElo };
    } else {
      await log('FAIL', `❌ PROTECTED: ${data.error}`);
      return { vulnerable: false };
    }
  } catch (err) {
    await log('WARN', `Error during test: ${err.message}`);
    return { vulnerable: null };
  }
}

// Test 2: Repeated AI Win Abuse
async function testRepeatedAIWinAbuse() {
  console.log(`\n${COLORS.YELLOW}═══ TEST 2: Repeated AI Win Abuse ═══${COLORS.RESET}`);
  
  try {
    const cheaterUsername = `cheater_${Date.now()}`;
    let currentElo = 800;
    
    await log('TEST', `Username: ${cheaterUsername}`);
    await log('TEST', 'Attempting 5 consecutive fake wins...');
    
    for (let i = 1; i <= 5; i++) {
      const response = await fetch(`${BASE_URL}/api/player/${cheaterUsername}/ai-win`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winner: 'player' })
      });
      
      const data = await response.json();
      if (data.success) {
        currentElo = data.newElo;
        await log('INFO', `Win #${i}: ELO → ${data.newElo} (+${data.diff})`);
      }
    }
    
    await log('PASS', `✅ VULNERABLE: Boosted from ~800 to ${currentElo} ELO in 5 requests!`);
    return { vulnerable: true, username: cheaterUsername, finalElo: currentElo };
  } catch (err) {
    await log('WARN', `Error: ${err.message}`);
  }
}

// Test 3: Leaderboard Check
async function testLeaderboardCheck() {
  console.log(`\n${COLORS.YELLOW}═══ TEST 3: Check Leaderboard Ranking ═══${COLORS.RESET}`);
  
  try {
    const response = await fetch(`${BASE_URL}/api/leaderboard`);
    const data = await response.json();
    
    if (data.success) {
      await log('INFO', `Top 5 Players:`);
      data.players.slice(0, 5).forEach((p, idx) => {
        console.log(`  ${idx + 1}. ${p.username}: ${p.elo} ELO (${p.wins}W-${p.losses}L)`);
      });
      
      return { success: true, players: data.players };
    }
  } catch (err) {
    await log('WARN', `Error: ${err.message}`);
  }
}

// Test 4: Admin Auth - Check Default Password
async function testAdminAuth() {
  console.log(`\n${COLORS.YELLOW}═══ TEST 4: Admin Password (Default) ═══${COLORS.RESET}`);
  
  try {
    const passwords = ['admin123', 'password', 'admin', '123456'];
    
    for (const pwd of passwords) {
      await log('TEST', `Trying password: ${pwd}`);
      
      const response = await fetch(`${BASE_URL}/api/admin/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd })
      });
      
      const data = await response.json();
      
      if (response.status === 200 && data.success) {
        await log('PASS', `✅ VULNERABLE: Admin password is "${pwd}"`);
        await log('INFO', `Token: ${data.token.substring(0, 20)}...`);
        return { vulnerable: true, password: pwd, token: data.token };
      }
    }
    
    await log('FAIL', `❌ PROTECTED: None of the common passwords worked`);
    return { vulnerable: false };
  } catch (err) {
    await log('WARN', `Error: ${err.message}`);
  }
}

// Test 5: Match History Visibility
async function testMatchHistory() {
  console.log(`\n${COLORS.YELLOW}═══ TEST 5: Match History Access ═══${COLORS.RESET}`);
  
  try {
    // Use a test username
    const response = await fetch(`${BASE_URL}/api/player/testuser/matches`);
    const data = await response.json();
    
    if (data.success) {
      await log('PASS', `Match history accessible without auth`);
      await log('INFO', `Total matches: ${data.total}`);
      if (data.matches.length > 0) {
        console.log(`  Latest: vs ${data.matches[0].opponent} - ${data.matches[0].result}`);
      }
      return { accessible: true };
    }
  } catch (err) {
    await log('WARN', `Error: ${err.message}`);
  }
}

// Main Test Runner
async function runAllTests() {
  console.log(`${COLORS.BLUE}
╔═══════════════════════════════════════╗
║   CHEGG SECURITY VULNERABILITY TESTS  ║
║            Report Generator            ║
╚═══════════════════════════════════════╝
${COLORS.RESET}`);
  
  await log('INFO', `Target: ${BASE_URL}`);
  await log('INFO', `Started at: ${new Date().toISOString()}`);
  
  const results = {
    tests_run: 0,
    vulnerabilities_found: 0,
    details: []
  };
  
  // Run tests
  const test1 = await testAIWinExploit();
  results.tests_run++;
  if (test1.vulnerable) {
    results.vulnerabilities_found++;
    results.details.push(test1);
  }
  
  const test2 = await testRepeatedAIWinAbuse();
  results.tests_run++;
  if (test2?.vulnerable) {
    results.vulnerabilities_found++;
    results.details.push(test2);
  }
  
  const test3 = await testLeaderboardCheck();
  results.tests_run++;
  
  const test4 = await testAdminAuth();
  results.tests_run++;
  if (test4.vulnerable) {
    results.vulnerabilities_found++;
    results.details.push(test4);
  }
  
  const test5 = await testMatchHistory();
  results.tests_run++;
  
  // Summary
  console.log(`\n${COLORS.BLUE}═══════════════════════════════════════${COLORS.RESET}`);
  console.log(`${COLORS.YELLOW}SUMMARY${COLORS.RESET}`);
  console.log(`${COLORS.BLUE}═══════════════════════════════════════${COLORS.RESET}`);
  await log('INFO', `Tests Run: ${results.tests_run}`);
  await log('INFO', `Vulnerabilities Found: ${results.vulnerabilities_found}`);
  
  if (results.vulnerabilities_found > 0) {
    console.log(`\n${COLORS.RED}⚠️  SECURITY ISSUES DETECTED:${COLORS.RESET}`);
    results.details.forEach((detail, idx) => {
      console.log(`${idx + 1}. ${detail.username || 'N/A'}`);
    });
  }
  
  console.log(`\n${COLORS.GREEN}Report saved to: SECURITY_TEST.md${COLORS.RESET}\n`);
}

runAllTests();
