const path = require('path');
const fs = require('fs');

const isPkg = typeof process.pkg !== 'undefined';
const ROOT_DIR = isPkg ? path.dirname(process.execPath) : path.resolve(__dirname, '..');

// Load .env from directory where .exe or project root resides
const envPath = path.join(ROOT_DIR, '.env');
require('dotenv').config({ path: envPath });

const DATA_DIR = path.join(ROOT_DIR, 'data');
const MANIFEST_DIR = path.join(DATA_DIR, 'manifest');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const TEMP_DIR = path.join(ROOT_DIR, 'temp');

// WEB_DIR should point to virtual snapshot if packaged, or local web dir
const WEB_DIR = isPkg ? path.join(__dirname, '..', 'web') : path.join(ROOT_DIR, 'web');

// Ensure external writable directories exist
[DATA_DIR, MANIFEST_DIR, CACHE_DIR, TEMP_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.warn(`[Config] Failed to create dir ${dir}:`, err.message);
    }
  }
});

function reloadEnv() {
  require('dotenv').config({ path: envPath, override: true });
}

module.exports = {
  get PORT() {
    return process.env.PORT || 3000;
  },
  get GITHUB_TOKEN() {
    reloadEnv();
    return process.env.GITHUB_TOKEN || '';
  },
  get GITHUB_OWNER() {
    reloadEnv();
    return process.env.GITHUB_OWNER || '';
  },
  get GITHUB_REPO() {
    reloadEnv();
    return process.env.GITHUB_REPO || '';
  },
  ROOT_DIR,
  DATA_DIR,
  MANIFEST_DIR,
  CACHE_DIR,
  TEMP_DIR,
  WEB_DIR,
  isGitHubConfigured() {
    return Boolean(this.GITHUB_TOKEN && this.GITHUB_OWNER && this.GITHUB_REPO);
  }
};
