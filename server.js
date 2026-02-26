require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const path = require('path');
const { scrapeAll, loadCachedData } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 4455;

let isScraping = false;
let nextRefreshTime = null;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/usage - return cached data
app.get('/api/usage', (req, res) => {
  const data = loadCachedData();
  if (!data) {
    return res.json({
      lastUpdated: null,
      nextRefresh: nextRefreshTime,
      isScraping,
      accounts: [],
    });
  }
  res.json({
    ...data,
    nextRefresh: nextRefreshTime,
    isScraping,
  });
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
  res.json({
    isScraping,
    nextRefresh: nextRefreshTime,
    uptime: process.uptime(),
  });
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
  // Next refresh is at next 10-minute mark
  const now = new Date();
  const minutesUntilNext = 10 - (now.getMinutes() % 10);
  const next = new Date(now.getTime() + minutesUntilNext * 60 * 1000);
  next.setSeconds(0, 0);
  nextRefreshTime = next.toISOString();
}

// Schedule every 10 minutes
cron.schedule('*/10 * * * *', () => {
  updateNextRefreshTime();
  runScrape();
});

// Start server
app.listen(PORT, async () => {
  console.log(`\n🚀 Claude Usage Dashboard running at http://localhost:${PORT}`);
  console.log('   Press Ctrl+C to stop\n');

  updateNextRefreshTime();

  // Initial scrape on startup
  console.log('Running initial scrape...');
  await runScrape();
});
