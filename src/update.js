'use strict';

// Version check and self-update. The check reads one public file (the
// package.json of this edition's `hub` branch on GitHub) and sends nothing
// else; set WMAD_NO_UPDATE_CHECK=1 to turn it off. Updating is a `git pull`
// in the install folder, so it only works for git clones (which is how the
// skill is installed).

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LATEST_URL = 'https://raw.githubusercontent.com/kk3329188/whatsmyagentdoing/hub/package.json';
const CHECK_EVERY = 30 * 60 * 1000;

function localVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; }
}

function newer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

const state = { latest: null, checkedAt: 0, checking: null };

function fetchLatest() {
  return new Promise((resolve) => {
    const req = https.get(LATEST_URL, { headers: { 'user-agent': 'whatsmyagentdoing' }, timeout: 4000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let body = '';
      res.on('data', (c) => { body += c; if (body.length > 64 * 1024) res.destroy(); });
      res.on('end', () => { try { resolve(JSON.parse(body).version || null); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function checkLatest(force = false) {
  if (process.env.WMAD_NO_UPDATE_CHECK) return null;
  if (process.env.WMAD_LATEST_VERSION) { state.latest = process.env.WMAD_LATEST_VERSION; return state.latest; } // for testing
  if (!force && state.latest && Date.now() - state.checkedAt < CHECK_EVERY) return state.latest;
  if (!state.checking) {
    state.checking = fetchLatest().then((v) => {
      if (v) { state.latest = v; state.checkedAt = Date.now(); }
      state.checking = null;
      return state.latest;
    });
  }
  return state.checking;
}

function canUpdate() {
  return fs.existsSync(path.join(ROOT, '.git'));
}

function info() {
  const version = localVersion();
  return {
    version,
    latest: state.latest,
    updateAvailable: !!(state.latest && newer(state.latest, version)),
    canUpdate: canUpdate(),
  };
}

function update() {
  return new Promise((resolve, reject) => {
    if (!canUpdate()) return reject(new Error(`not a git clone (${ROOT}); reinstall it with git clone to get updates`));
    // A clone of this edition follows the branch it was cloned from. A
    // working copy whose branch tracks nothing keeps its own commits on top
    // of the original project's main instead.
    execFile('git', ['-C', ROOT, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { timeout: 10000 }, (noUpstream) => {
      const args = noUpstream ? ['pull', '--rebase', '--quiet', 'origin', 'main'] : ['pull', '--rebase', '--quiet'];
      execFile('git', ['-C', ROOT, ...args], { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(String(stderr || err.message).trim()));
        resolve(localVersion());
      });
    });
  });
}

module.exports = { localVersion, checkLatest, info, update, newer, ROOT };
