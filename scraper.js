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

    // Wait for usage data to load (SPA fetches data after page load)
    // Wait until "Loading..." text disappears, meaning React components have data
    try {
      await page.waitForFunction(
        () => {
          const body = document.body.innerText;
          // Check that we have content and "Loading..." is gone
          return body.length > 500 && !body.includes('Loading...\nLoading...\nLoading...');
        },
        { timeout: 20000, polling: 500 }
      );
    } catch {
      // fallback
    }
    await page.waitForTimeout(2000);

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
    session: {
      percent: null,
      resetIn: null,
      label: 'Current Session',
    },
    weekly: {
      percent: null,
      resetOn: null,
      label: 'Weekly Limit',
    },
    extra: {
      spent: null,
      limit: null,
      balance: null,
      resetDate: null,
      label: 'Extra Usage',
    },
  };

  if (!data || !data.rawText) return result;

  const text = data.rawText;

  // Try to extract session usage
  const sessionPatterns = [
    /current\s+session[^%]*?(\d+(?:\.\d+)?)\s*%/i,
    /session[^%]*?(\d+(?:\.\d+)?)\s*%/i,
  ];
  for (const pattern of sessionPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.session.percent = parseFloat(match[1]);
      break;
    }
  }

  // Try to extract weekly usage
  const weeklyPatterns = [
    /weekly[^%]*?(\d+(?:\.\d+)?)\s*%/i,
    /week[^%]*?(\d+(?:\.\d+)?)\s*%/i,
  ];
  for (const pattern of weeklyPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.weekly.percent = parseFloat(match[1]);
      break;
    }
  }

  // Extract percentages from sections
  if (data.sections) {
    data.sections.forEach(section => {
      if (!section.heading) return;
      const heading = section.heading.toLowerCase();
      const content = (section.content || '').toLowerCase();
      const combined = heading + ' ' + content;

      const percentMatch = combined.match(/(\d+(?:\.\d+)?)\s*%/);
      if (percentMatch) {
        const pct = parseFloat(percentMatch[1]);
        if (heading.includes('session') || heading.includes('current')) {
          result.session.percent = pct;
        } else if (heading.includes('week')) {
          result.weekly.percent = pct;
        }
      }

      // Look for reset info
      const resetMatch = combined.match(/reset[s]?\s+(?:in\s+)?(.+?)(?:\||$)/i);
      if (resetMatch) {
        if (heading.includes('session') || heading.includes('current')) {
          result.session.resetIn = resetMatch[1].trim();
        } else if (heading.includes('week')) {
          result.weekly.resetOn = resetMatch[1].trim();
        }
      }
    });
  }

  // Extract dollar amounts for extra usage
  if (data.dollars && data.dollars.length > 0) {
    // First dollar amount is likely spent, second might be limit
    if (data.dollars[0]) {
      result.extra.spent = data.dollars[0];
    }
    if (data.dollars[1]) {
      result.extra.limit = data.dollars[1];
    }
  }

  // Extract reset times
  if (data.resets && data.resets.length > 0) {
    result.session.resetIn = data.resets[0] || null;
    if (data.resets.length > 1) {
      result.weekly.resetOn = data.resets[1] || null;
    }
  }

  // If we have time matches but no resets
  if (!result.session.resetIn && data.times && data.times.length > 0) {
    result.session.resetIn = data.times[0];
  }

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
