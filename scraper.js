require('dotenv').config();
const path = require('path');
const fs = require('fs');

const DATA_FILE = path.join(__dirname, 'data', 'usage.json');
const SESSIONS_FILE = path.join(__dirname, 'data', 'sessions.json');

function getSessionDir(accountIndex) {
  return path.join(__dirname, 'sessions', `account-${accountIndex}`);
}

function loadSessionKeys() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return {};
}

function saveSessionKey(accountIndex, sessionKey) {
  const sessions = loadSessionKeys();
  sessions[accountIndex] = sessionKey;
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

function buildCookieHeader(cookies) {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

function formatResetIn(isoDate) {
  if (!isoDate) return null;
  const diff = new Date(isoDate) - Date.now();
  if (diff <= 0) return 'Resets soon';
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return hours > 0 ? `Resets in ${hours} hr ${mins} min` : `Resets in ${mins} min`;
}

function formatResetOn(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  const day = d.toLocaleDateString('en-US', { weekday: 'short' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `Resets ${day} ${time}`;
}

async function scrapeAccount(accountIndex, accountName) {
  // Priority 1: sessions.json (set via admin UI - no restart needed)
  // Priority 2: .env ACCOUNT_X_SESSION
  // Priority 3: cookies.json (legacy Playwright)
  let cookieHeader = null;

  const sessionKeys = loadSessionKeys();
  const sessionToken = sessionKeys[accountIndex] || process.env[`ACCOUNT_${accountIndex}_SESSION`];
  if (sessionToken) {
    cookieHeader = `sessionKey=${sessionToken}`;
  } else {
    const sessionDir = getSessionDir(accountIndex);
    const cookiesFile = path.join(sessionDir, 'cookies.json');
    if (!fs.existsSync(cookiesFile)) {
      const msg = `No session found. Add ACCOUNT_${accountIndex}_SESSION to .env (copy from claude.ai DevTools → Cookies → sessionKey)`;
      console.log(`  [Account ${accountIndex}] ${msg}`);
      return { accountIndex, accountName, status: 'no_session', error: msg, lastUpdated: new Date().toISOString() };
    }
    const cookies = JSON.parse(fs.readFileSync(cookiesFile, 'utf8'));
    cookieHeader = buildCookieHeader(cookies);
  }

  try {
    const headers = {
      'Cookie': cookieHeader,
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://claude.ai/settings/usage',
    };

    // Step 1: Get organization UUID
    const orgsResp = await fetch('https://claude.ai/api/organizations', { headers });
    if (orgsResp.status === 401 || orgsResp.status === 403) {
      return {
        accountIndex, accountName, status: 'session_expired',
        error: `Session expired. Re-run: node setup.js ${accountIndex}`,
        lastUpdated: new Date().toISOString(),
      };
    }
    if (!orgsResp.ok) throw new Error(`Organizations API returned ${orgsResp.status}`);

    const orgs = await orgsResp.json();
    const org = Array.isArray(orgs) ? orgs[0] : orgs;
    const orgId = org?.uuid;
    if (!orgId) throw new Error('Could not find organization UUID');

    // Step 2: Get usage data
    const usageResp = await fetch(`https://claude.ai/api/organizations/${orgId}/usage`, { headers });
    if (!usageResp.ok) throw new Error(`Usage API returned ${usageResp.status}`);
    const usage = await usageResp.json();

    const result = {
      accountIndex,
      accountName,
      status: 'ok',
      lastUpdated: new Date().toISOString(),
      session: {
        label: 'Current Session',
        percent: usage.five_hour?.utilization ?? null,
        resetIn: formatResetIn(usage.five_hour?.resets_at),
      },
      weekly: {
        label: 'Weekly Limit',
        percent: usage.seven_day?.utilization ?? null,
        resetOn: formatResetOn(usage.seven_day?.resets_at),\n        resetAt: usage.seven_day?.resets_at || null,
      },
      extra: {
        label: 'Extra Usage',
        spent: usage.extra_usage?.used_credits != null
          ? `$${Number(usage.extra_usage.used_credits).toFixed(2)}`
          : null,
        limit: usage.extra_usage?.monthly_limit != null
          ? `$${usage.extra_usage.monthly_limit}`
          : null,
        balance: null,
        resetDate: null,
        isEnabled: usage.extra_usage?.is_enabled ?? false,
      },
    };

    console.log(`  [Account ${accountIndex}] ✓ session=${result.session.percent}%, weekly=${result.weekly.percent}%`);
    return result;

  } catch (err) {
    console.error(`  [Account ${accountIndex}] Error:`, err.message);
    return { accountIndex, accountName, status: 'error', error: err.message, lastUpdated: new Date().toISOString() };
  }
}

async function scrapeAll() {
  const accountCount = parseInt(process.env.ACCOUNT_COUNT) || 4;
  console.log(`\nFetching ${accountCount} accounts in parallel...`);

  const promises = [];
  for (let i = 1; i <= accountCount; i++) {
    const accountName = process.env[`ACCOUNT_${i}_NAME`] || `Account ${i}`;
    promises.push(scrapeAccount(i, accountName));
  }

  const results = await Promise.all(promises);

  const dataDir = path.join(__dirname, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const output = {
    lastUpdated: new Date().toISOString(),
    accounts: results,
  };

  fs.writeFileSync(DATA_FILE, JSON.stringify(output, null, 2));
  console.log(`✓ Data saved to ${DATA_FILE}`);
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

module.exports = { scrapeAll, scrapeAccount, loadCachedData, saveSessionKey, loadSessionKeys };
