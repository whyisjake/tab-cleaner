#!/usr/bin/env node
/**
 * Generates a Chrome Web Store refresh token from a Google OAuth client JSON
 * (Desktop app type) and saves the credentials as GitHub Actions secrets for
 * the publish workflow.
 *
 * Usage: node scripts/webstore-auth.js [client_secret_*.json] [--print]
 *
 * With no path, uses the single client_secret_*.json in the project root.
 * --print writes the values to stdout instead of setting GitHub secrets.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const TIMEOUT_MS = 5 * 60 * 1000;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function findClientFile(arg) {
  if (arg) {
    return arg;
  }
  const root = path.join(__dirname, '..');
  const matches = fs.readdirSync(root).filter(name => /^client_secret_.*\.json$/.test(name));
  if (matches.length !== 1) {
    fail(`expected one client_secret_*.json in ${root}, found ${matches.length}. Pass the path explicitly.`);
  }
  return path.join(root, matches[0]);
}

function loadClient(file) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!json.installed) {
    fail('this is not a Desktop app OAuth client. Create one under APIs & Services > Credentials > Create OAuth client ID > Desktop app.');
  }
  const { client_id: clientId, client_secret: clientSecret, auth_uri: authUri, token_uri: tokenUri } = json.installed;
  if (!clientId || !clientSecret) {
    fail('client JSON is missing client_id or client_secret.');
  }
  return { clientId, clientSecret, authUri, tokenUri };
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(command, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' })
    .on('error', () => {})
    .unref();
}

// Runs the loopback OAuth flow and resolves with the authorization code
function getAuthorizationCode(client) {
  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(16).toString('hex');
    let redirectUri;

    const server = http.createServer((req, res) => {
      const params = new URL(req.url, redirectUri).searchParams;
      if (!params.has('code') && !params.has('error')) {
        res.writeHead(404).end();
        return;
      }
      const ok = params.get('state') === state && params.has('code');
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain' });
      res.end(ok ? 'Authorized. You can close this tab.' : 'Authorization failed. Check the terminal.');
      server.close();
      clearTimeout(timer);
      if (params.get('state') !== state) {
        reject(new Error('state mismatch in OAuth redirect'));
      } else if (params.has('error')) {
        reject(new Error(`authorization denied: ${params.get('error')}`));
      } else {
        resolve({ code: params.get('code'), redirectUri });
      }
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error('timed out waiting for authorization'));
    }, TIMEOUT_MS);

    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${server.address().port}`;
      const url = new URL(client.authUri);
      url.search = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        state
      });
      console.log('Sign in with the Google account that owns the extension.');
      console.log(`If the browser doesn't open, visit:\n\n${url}\n`);
      openBrowser(url.toString());
    });
  });
}

async function requestToken(client, params) {
  const response = await fetch(client.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, ...params })
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`token request failed: ${body.error}${body.error_description ? ` (${body.error_description})` : ''}`);
  }
  return body;
}

function setSecret(name, value) {
  const result = spawnSync('gh', ['secret', 'set', name], { input: value, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`gh secret set ${name} failed: ${result.error?.message || result.stderr.trim()}`);
  }
  console.log(`Set ${name}`);
}

async function main() {
  const args = process.argv.slice(2);
  const print = args.includes('--print');
  const client = loadClient(findClientFile(args.find(arg => !arg.startsWith('--'))));

  const { code, redirectUri } = await getAuthorizationCode(client);
  const tokens = await requestToken(client, { code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  if (!tokens.refresh_token) {
    throw new Error('no refresh token returned. Remove the app at https://myaccount.google.com/permissions and run again.');
  }

  // Prove the three values work together before saving them
  await requestToken(client, { refresh_token: tokens.refresh_token, grant_type: 'refresh_token' });
  console.log('Refresh token verified.\n');

  const secrets = {
    CHROME_CLIENT_ID: client.clientId,
    CHROME_CLIENT_SECRET: client.clientSecret,
    CHROME_REFRESH_TOKEN: tokens.refresh_token
  };

  if (print) {
    Object.entries(secrets).forEach(([name, value]) => console.log(`${name}=${value}`));
    return;
  }
  Object.entries(secrets).forEach(([name, value]) => setSecret(name, value));
}

main().catch(error => fail(error.message));
