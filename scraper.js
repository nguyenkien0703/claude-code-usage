require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const DATA_FILE = path.join(__dirname, 'data', 'usage.json');

function getSessionDir(accountIndex) {
  return path.join(__dirname, 'sessions', `account-${accountIndex}`);
}

async function scrapeAccount(accountIndex, accountName) {
  const sessionDir = getSessionDir(accountIndex);
  const cookiesFile = path.join(sessionDir, 'cookies.json');

  if (!fs.existsSync(cookiesFile)) {
    const msg = fs.existsSync(sessionDir)
      ? `Session exists but no cookies.json. Re-run: node setup.js ${accountIndex}`
      : `No session found. Run: node setup.js ${accountIndex}`;
    console.log(`  [Account ${accountIndex}] ${msg}`);
    return {
      accountIndex,
      accountName,
      status: 'no_session',
      error: msg,
      lastUpdated: new Date().toISOString(),
    };
  }

  let browser = null;
  let context = null;
  try {
    // Launch fresh browser and load cookies from JSON (cross-platform portable)
    browser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    const cookies = JSON.parse(fs.readFileSync(cookiesFile, 'utf8'));
    await context.addCookies(cookies);

    const page = await context.newPage();

    console.log(`  [Account ${accountIndex}] Navigating to usage page...`);
    await page.goto('https://claude.ai/settings/usage', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Check if we actually landed on the usage page
    const currentUrl = page.url();
    if (!currentUrl.includes('settings/usage')) {
      console.log(`  [Account ${accountIndex}] Session expired (redirected to ${currentUrl}). Re-run: node setup.js ${accountIndex}`);
      return {
        accountIndex,
        accountName,
        status: 'session_expired',
        error: 'Session expired. Re-run setup.',
        lastUpdated: new Date().toISOString(),
      };
    }

    // Wait for React/Next.js to hydrate and settle (may redirect if not authenticated)
    await page.waitForTimeout(5000);

    // Re-check after React routing settled — homepage means not logged in
    const finalUrl = page.url();
    const bodyPreCheck = await page.evaluate(() => document.body.innerText || '');
    if (!finalUrl.includes('settings/usage') || bodyPreCheck.includes('Continue with Google')) {
      console.log(`  [Account ${accountIndex}] Session invalid on Linux (cookies from Mac don't transfer). Re-run setup on VPS.`);
      return {
        accountIndex,
        accountName,
        status: 'session_expired',
        error: 'Session invalid. Run setup inside Docker on VPS (see README).',
        lastUpdated: new Date().toISOString(),
      };
    }

    // Wait for usage data to fully render
    try {
      await page.waitForFunction(
        () => {
          const body = document.body.innerText;
          return body.length > 200 && !body.includes('Loading...\nLoading...\nLoading...');
        },
        { timeout: 20000, polling: 500 }
      );
    } catch { /* fallback */ }
    await page.waitForTimeout(1000);

    const data = await page.evaluate(() => {
      const result = {
        session: null,
        weekly: null,
        extra: null,
      };

      // Helper to parse percentage text like "45%" -> 45
      function parsePercent(text) {
        if (!text) return null;
        const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
        return match ? parseFloat(match[1]) : null;
      }

      // Helper to find text content near a label
      function findNearText(label, container) {
        const elements = container ? container.querySelectorAll('*') : document.querySelectorAll('*');
        for (const el of elements) {
          if (el.children.length === 0 && el.textContent.trim().toLowerCase().includes(label.toLowerCase())) {
            return el;
          }
        }
        return null;
      }

      // Try to extract all text from the page for debugging
      const pageText = document.body.innerText;

      // Extract usage sections - look for progress bars and associated text
      const progressBars = document.querySelectorAll('[role="progressbar"], progress, [class*="progress"]');

      // Try to find usage data by looking at section headings and nearby content
      const allSections = document.querySelectorAll('section, [class*="section"], [class*="usage"], [class*="limit"]');

      // Get all text nodes and structure
      const usageData = {
        rawText: pageText,
        sections: [],
      };

      // Look for specific patterns in the page
      // Claude usage page typically shows:
      // - Current session usage with a progress bar
      // - Weekly usage with a progress bar
      // - Extra usage / billing info

      // Extract by looking for percentage patterns in the text
      const percentMatches = pageText.match(/\d+(?:\.\d+)?%/g) || [];
      const dollarMatches = pageText.match(/\$[\d,]+(?:\.\d{2})?/g) || [];
      const resetMatches = pageText.match(/reset[s]?\s+(?:in\s+)?(?:\d+\s+(?:hour|minute|day|week)s?|on\s+\w+)/gi) || [];
      const timeMatches = pageText.match(/(?:resets?\s+(?:in\s+)?)?(?:\d+h\s*\d+m|\d+\s+hours?\s+\d+\s+minutes?|\d+\s+days?)/gi) || [];

      usageData.percentages = percentMatches;
      usageData.dollars = dollarMatches;
      usageData.resets = resetMatches;
      usageData.times = timeMatches;

      // Try structured extraction
      // Look for "Current session" section
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="heading"], [class*="title"]');
      const sections = [];
      headings.forEach(h => {
        const text = h.textContent.trim();
        if (text) {
          const section = {
            heading: text,
            content: '',
          };
          // Get sibling/nearby content
          let next = h.nextElementSibling;
          let contentParts = [];
          for (let i = 0; i < 5 && next; i++) {
            contentParts.push(next.textContent.trim());
            next = next.nextElementSibling;
          }
          section.content = contentParts.join(' | ');
          sections.push(section);
        }
      });
      usageData.sections = sections;

      // Look for progress bars with ARIA labels
      progressBars.forEach(bar => {
        const value = bar.getAttribute('aria-valuenow') || bar.getAttribute('value');
        const max = bar.getAttribute('aria-valuemax') || bar.getAttribute('max');
        const label = bar.getAttribute('aria-label') || bar.getAttribute('aria-labelledby');
        usageData.sections.push({
          type: 'progressbar',
          value,
          max,
          label,
          text: bar.textContent.trim(),
        });
      });

      return usageData;
    });

    // Refresh cookies after successful scrape
    try {
      const updatedCookies = await context.cookies();
      fs.writeFileSync(cookiesFile, JSON.stringify(updatedCookies, null, 2));
    } catch { /* non-critical */ }

    // Parse the raw data into structured format
    const parsed = parseUsageData(data, accountName);
    parsed.accountIndex = accountIndex;
    parsed.accountName = accountName;
    parsed.status = 'ok';
    parsed.lastUpdated = new Date().toISOString();
    parsed.rawText = data.rawText ? data.rawText.substring(0, 2000) : '';

    console.log(`  [Account ${accountIndex}] ✓ Data scraped successfully`);
    return parsed;

  } catch (err) {
    console.error(`  [Account ${accountIndex}] Error:`, err.message);
    return {
      accountIndex,
      accountName,
      status: 'error',
      error: err.message,
      lastUpdated: new Date().toISOString(),
    };
  } finally {
    if (browser) await browser.close();
  }
}

function parseUsageData(data, accountName) {
  const result = {
    session: { percent: null, resetIn: null, label: 'Current Session' },
    weekly:  { percent: null, resetOn: null, label: 'Weekly Limit' },
    extra:   { spent: null, limit: null, balance: null, resetDate: null, label: 'Extra Usage' },
  };

  if (!data || !data.rawText) return result;
  const text = data.rawText;

  // ── Current session % ─────────────────────────────────────────
  const sessionPct = text.match(/current\s+session[^%]*?(\d+(?:\.\d+)?)\s*%/i);
  if (sessionPct) result.session.percent = parseFloat(sessionPct[1]);

  // ── Current session reset: "Resets in 2 hr 42 min" ───────────
  const sessionReset = text.match(/Resets in ([^\n]+)/i);
  if (sessionReset) result.session.resetIn = sessionReset[0].trim();

  // ── Weekly limit % ────────────────────────────────────────────
  // "All models" block on usage page
  const weeklyPct = text.match(/All models[\s\S]{0,200}?(\d+(?:\.\d+)?)\s*%/i)
                 || text.match(/weekly[^%]*?(\d+(?:\.\d+)?)\s*%/i);
  if (weeklyPct) result.weekly.percent = parseFloat(weeklyPct[1]);

  // ── Weekly reset: "Resets Mon 11:00 PM" ──────────────────────
  const weeklyReset = text.match(/Resets (Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^\n]*/i);
  if (weeklyReset) result.weekly.resetOn = weeklyReset[0].trim();

  // ── Extra usage dollar amounts ────────────────────────────────
  const dollars = (text.match(/\$[\d,]+(?:\.\d{1,2})?/g) || []);
  if (dollars[0]) result.extra.spent = dollars[0];
  if (dollars[1]) result.extra.limit = dollars[1];

  // Reset date: "Mar 1" near "Reset date"
  const resetDate = text.match(/([A-Z][a-z]+ \d+)\s*\nReset date/i)
                 || text.match(/Reset date\s*\n([^\n]+)/i);
  if (resetDate) result.extra.resetDate = resetDate[1].trim();

  return result;
}

async function scrapeAll() {
  const accountCount = parseInt(process.env.ACCOUNT_COUNT) || 4;
  console.log(`\nScraping ${accountCount} accounts...`);

  const results = [];

  for (let i = 1; i <= accountCount; i++) {
    const accountName = process.env[`ACCOUNT_${i}_NAME`] || `Account ${i}`;
    console.log(`\nAccount ${i}: ${accountName}`);
    const data = await scrapeAccount(i, accountName);
    results.push(data);
  }

  // Save to file
  const dataDir = path.join(__dirname, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const output = {
    lastUpdated: new Date().toISOString(),
    accounts: results,
  };

  fs.writeFileSync(DATA_FILE, JSON.stringify(output, null, 2));
  console.log(`\n✓ Data saved to ${DATA_FILE}`);

  return output;
}

function loadCachedData() {
  if (!fs.existsSync(DATA_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = { scrapeAll, scrapeAccount, loadCachedData };
