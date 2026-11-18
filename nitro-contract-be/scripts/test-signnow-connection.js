/**
 * Live SignNow credential check. Loads backend .env and:
 *  1) Validates required vars
 *  2) Confirms Basic token matches client_id:client_secret
 *  3) Requests an OAuth access token
 *  4) Fetches the authenticated user + document list
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.error('FAIL: backend .env not found at', envPath);
  process.exit(1);
}
dotenv.config({ path: envPath, override: true });

function mask(value, keep = 4) {
  const s = String(value || '');
  if (s.length <= keep * 2) return s ? `${s.slice(0, 2)}…` : '(empty)';
  return `${s.slice(0, keep)}…${s.slice(-keep)} (len ${s.length})`;
}

function present(name) {
  const v = String(process.env[name] || '').trim();
  return { name, ok: v.length > 0, preview: v ? mask(v) : '(missing)' };
}

async function requestJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, ok: res.ok, json };
}

async function tryToken(baseUrl, basicToken, username, password) {
  const body = new URLSearchParams({
    username,
    password,
    grant_type: 'password',
    scope: '*',
  });
  return requestJson(`${baseUrl.replace(/\/$/, '')}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
}

async function main() {
  console.log('=== SignNow connection test ===');
  console.log('env file:', envPath);

  const required = [
    'SIGNNOW_CLIENT_ID',
    'SIGNNOW_CLIENT_SECRET',
    'SIGNNOW_BASIC_AUTH_TOKEN',
    'SIGNNOW_USERNAME',
    'SIGNNOW_PASSWORD',
  ];
  const checks = required.map(present);
  for (const c of checks) {
    console.log(`  ${c.ok ? 'OK' : 'MISSING'} ${c.name}: ${c.preview}`);
  }
  if (checks.some((c) => !c.ok)) {
    console.error('\nFAIL: missing SignNow env vars');
    process.exit(1);
  }

  const clientId = process.env.SIGNNOW_CLIENT_ID.trim();
  const clientSecret = process.env.SIGNNOW_CLIENT_SECRET.trim();
  const basicToken = process.env.SIGNNOW_BASIC_AUTH_TOKEN.trim();
  const username = process.env.SIGNNOW_USERNAME.trim();
  const password = process.env.SIGNNOW_PASSWORD;
  const configuredBase = (process.env.SIGNNOW_API_BASE_URL || 'https://api.signnow.com').trim();

  const expectedBasic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const basicMatches = expectedBasic === basicToken;
  console.log(`\nBasic token matches client_id:client_secret: ${basicMatches ? 'YES' : 'NO'}`);
  if (!basicMatches) {
    console.log('  Using SIGNNOW_BASIC_AUTH_TOKEN as provided; recomputed token differs.');
  }

  const bases = [configuredBase];
  if (!bases.includes('https://api.signnow.com')) bases.push('https://api.signnow.com');
  if (!bases.includes('https://api-eval.signnow.com')) bases.push('https://api-eval.signnow.com');

  let tokenRes = null;
  let usedBase = null;
  for (const base of bases) {
    console.log(`\nTrying OAuth token: ${base}/oauth2/token`);
    tokenRes = await tryToken(base, basicToken, username, password);
    console.log(`  HTTP ${tokenRes.status}`);
    if (tokenRes.ok && tokenRes.json?.access_token) {
      usedBase = base;
      break;
    }
    const errMsg =
      tokenRes.json?.error_description ||
      tokenRes.json?.error ||
      tokenRes.json?.message ||
      JSON.stringify(tokenRes.json);
    console.log(`  ${errMsg}`);
  }

  if (!usedBase || !tokenRes?.json?.access_token) {
    console.error('\nNOT CONNECTED: could not obtain a SignNow access token.');
    process.exit(1);
  }

  const token = tokenRes.json.access_token;
  console.log('\nCONNECTED: access token received');
  console.log(`  API base: ${usedBase}`);
  console.log(`  token type: ${tokenRes.json.token_type || 'Bearer'}`);
  console.log(`  expires_in: ${tokenRes.json.expires_in ?? '(not returned)'} seconds`);
  console.log(`  scope: ${tokenRes.json.scope || '(not returned)'}`);
  console.log(`  refresh token: ${tokenRes.json.refresh_token ? 'yes' : 'no'}`);

  const userRes = await requestJson(`${usedBase}/user`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  console.log(`\nGET /user → HTTP ${userRes.status}`);
  if (userRes.ok) {
    const u = userRes.json || {};
    console.log(`  email: ${u.email || u.unique_id || '(ok, account loaded)'}`);
    console.log(`  first_name: ${u.first_name || '(n/a)'}`);
    console.log(`  last_name: ${u.last_name || '(n/a)'}`);
    console.log(`  active: ${u.active ?? '(n/a)'}`);
  } else {
    console.log('  user lookup failed:', JSON.stringify(userRes.json));
  }

  const docsRes = await requestJson(`${usedBase}/user/documentsv2`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  console.log(`\nGET /user/documentsv2 → HTTP ${docsRes.status}`);
  if (docsRes.ok) {
    const docs = docsRes.json?.documents || docsRes.json || [];
    const count = Array.isArray(docs) ? docs.length : '(unknown)';
    console.log(`  documents visible: ${count}`);
  } else {
    console.log('  document list failed:', JSON.stringify(docsRes.json));
  }

  if (usedBase !== configuredBase) {
    console.log(
      `\nNOTE: SIGNNOW_API_BASE_URL is ${configuredBase}, but auth succeeded on ${usedBase}.`,
    );
  }

  console.log('\nRESULT: SignNow credentials are valid and the API is reachable.');
}

main().catch((err) => {
  console.error('\nNOT CONNECTED:', err.message);
  process.exit(1);
});
