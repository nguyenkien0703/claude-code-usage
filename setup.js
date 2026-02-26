#!/usr/bin/env node
require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const accountIndex = parseInt(process.argv[2]);

if (!accountIndex || accountIndex < 1 || accountIndex > 4) {
  console.error('Usage: node setup.js <account-number>');
  console.error('Example: node setup.js 1');
  process.exit(1);
}

const accountCount = parseInt(process.env.ACCOUNT_COUNT) || 4;
if (accountIndex > accountCount) {
  console.error(`Account index ${accountIndex} exceeds ACCOUNT_COUNT=${accountCount}`);
  process.exit(1);
}

const sessionDir = path.join(__dirname, 'sessions', `account-${accountIndex}`);
const accountName = process.env[`ACCOUNT_${accountIndex}_NAME`] || `Account ${accountIndex}`;

async function setup() {
  console.log(`\n=== Setting up ${accountName} (Account ${accountIndex}) ===`);
  console.log(`Session will be saved to: ${sessionDir}\n`);

  if (fs.existsSync(sessionDir)) {
    console.log('Session directory already exists. Re-login will overwrite it.');
  }

  fs.mkdirSync(sessionDir, { recursive: true });

  const browser = await chromium.launchPersistentContext(sessionDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const page = await browser.newPage();

  console.log('Opening claude.ai login page...');
  await page.goto('https://claude.ai/login', { waitUntil: 'domcontentloaded' });

  console.log('\n>>> Please log in with your Google account in the browser window.');
  console.log('>>> Complete any 2FA steps as needed.');
  console.log('>>> Once you are on the Claude dashboard, come back here and press Enter.\n');

  // Wait for user to finish login
  await new Promise((resolve) => {
    process.stdin.setRawMode(false);
    process.stdout.write('Press Enter when login is complete... ');
    process.stdin.once('data', resolve);
    process.stdin.resume();
  });

  // Verify we're logged in by checking the page URL
  const currentUrl = page.url();
  console.log(`\nCurrent URL: ${currentUrl}`);

  if (currentUrl.includes('claude.ai') && !currentUrl.includes('/login')) {
    console.log(`\n✓ Login successful for ${accountName}!`);

    // Export cookies to JSON (portable across platforms / Docker)
    const cookies = await browser.cookies();
    const cookiesFile = path.join(sessionDir, 'cookies.json');
    fs.writeFileSync(cookiesFile, JSON.stringify(cookies, null, 2));
    console.log(`✓ Cookies exported to: ${cookiesFile}`);
    console.log(`✓ Session saved to: ${sessionDir}`);
  } else {
    console.log('\n⚠ Warning: URL still shows login page. Please verify login was successful.');
  }

  await browser.close();
  process.stdin.pause();

  console.log('\nDone! You can now run: npm start');
}

setup().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
