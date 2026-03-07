require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const path = require('path');
const { scrapeAll, loadCachedData, saveSessionKey, loadSessionKeys } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 4455;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

let isScraping = false;
let nextRefreshTime = null;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// GET /api/usage - return cached data
app.get('/api/usage', (req, res) => {
  const data = loadCachedData();
  if (!data) {
    return res.json({ lastUpdated: null, nextRefresh: nextRefreshTime, isScraping, accounts: [] });
  }
  res.json({ ...data, nextRefresh: nextRefreshTime, isScraping });
});

// GET /api/refresh - trigger manual scrape
app.get('/api/refresh', async (req, res) => {
  if (isScraping) {
    return res.json({ success: false, message: 'Scraping already in progress' });
  }
  res.json({ success: true, message: 'Refresh started' });
  runScrape();
});

// GET /api/status - quick status check
app.get('/api/status', (req, res) => {
  res.json({ isScraping, nextRefresh: nextRefreshTime, uptime: process.uptime() });
});

// GET /api/admin/sessions - get masked session keys (admin only)
app.get('/api/admin/sessions', (req, res) => {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const sessions = loadSessionKeys();
  const accountCount = parseInt(process.env.ACCOUNT_COUNT) || 4;
  const result = {};
  for (let i = 1; i <= accountCount; i++) {
    const key = sessions[i] || process.env[`ACCOUNT_${i}_SESSION`] || '';
    result[i] = {
      name: process.env[`ACCOUNT_${i}_NAME`] || `Account ${i}`,
      hasKey: !!key,
      preview: key ? key.substring(0, 20) + '...' : '',
    };
  }
  res.json(result);
});

// POST /api/admin/session - update session key for an account
app.post('/api/admin/session', async (req, res) => {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { accountIndex, sessionKey } = req.body;
  if (!accountIndex || !sessionKey) {
    return res.status(400).json({ error: 'accountIndex and sessionKey required' });
  }
  saveSessionKey(accountIndex, sessionKey.trim());
  res.json({ success: true, message: `Session key updated for account ${accountIndex}` });

  // Trigger immediate re-scrape to verify new key
  if (!isScraping) runScrape();
});

async function runScrape() {
  if (isScraping) return;
  isScraping = true;
  console.log(`\n[${new Date().toLocaleTimeString()}] Starting scrape...`);
  try {
    await scrapeAll();
    console.log(`[${new Date().toLocaleTimeString()}] Scrape complete.`);
  } catch (err) {
    console.error('Scrape error:', err);
  } finally {
    isScraping = false;
  }
}

function updateNextRefreshTime() {
  const next = new Date(Date.now() + 60 * 1000);
  next.setSeconds(0, 0);
  nextRefreshTime = next.toISOString();
}

// Schedule every 1 minute
cron.schedule('* * * * *', () => {
  updateNextRefreshTime();
  runScrape();
});

// Start server
app.listen(PORT, async () => {
  console.log(`\n🚀 Claude Usage Dashboard running at http://localhost:${PORT}`);
  console.log('   Press Ctrl+C to stop\n');
  updateNextRefreshTime();
  console.log('Running initial scrape...');
  await runScrape();
});
