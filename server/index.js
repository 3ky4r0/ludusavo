const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const express = require('express');
const config = require('./config');
const manifest = require('./manifest');
const scanner = require('./scanner');
const backupManager = require('./backup');
const restoreManager = require('./restore');
const syncManager = require('./sync');
const gitHubClient = require('./github');

let cachedSteamPath = null;
function getSteamInstallPath() {
  if (cachedSteamPath) return cachedSteamPath;

  try {
    const regOutput = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const match = regOutput.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    if (match && match[1]) {
      const p = match[1].trim().replace(/\//g, '\\');
      if (fs.existsSync(p)) {
        cachedSteamPath = p;
        return p;
      }
    }
  } catch {}

  const relativeCandidates = [
    path.resolve(process.cwd(), '../../..'),
    path.resolve(__dirname, '../../../..'),
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    'D:\\Steam',
    'E:\\Steam'
  ];

  for (const cand of relativeCandidates) {
    if (fs.existsSync(path.join(cand, 'appcache', 'librarycache'))) {
      cachedSteamPath = cand;
      return cand;
    }
  }

  return null;
}

const app = express();

// Enable CORS for Steam Client CEF and localhost apps
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    service: 'SaveSync Steam Daemon',
    status: 'online',
    version: '1.0.0',
    description: 'Headless background API daemon for SaveSync Steam Millennium Plugin'
  });
});

// Ensure manifest is loaded on server startup
(async () => {
  try {
    await manifest.loadManifest();
  } catch (err) {
    console.error('[Server] Failed to load initial manifest:', err.message);
  }
})();

// Helper to sanitize error response
function handleError(res, err, defaultStatus = 500) {
  const status = err.status || defaultStatus;
  let safeMsg = err.message || 'An unexpected error occurred';
  if (config.GITHUB_TOKEN) {
    safeMsg = safeMsg.split(config.GITHUB_TOKEN).join('***REDACTED***');
  }
  res.status(status).json({
    success: false,
    error: safeMsg
  });
}

/**
 * GET /api/status
 * Get overall system and GitHub configuration status
 */
app.get('/api/status', async (req, res) => {
  try {
    let repoStatus = null;
    let rateLimit = null;
    if (config.isGitHubConfigured()) {
      repoStatus = await gitHubClient.checkRepository();
      rateLimit = gitHubClient.rateLimit || await gitHubClient.getRateLimit();
    }

    res.json({
      success: true,
      app: 'SaveSync',
      github: {
        configured: config.isGitHubConfigured(),
        owner: config.GITHUB_OWNER || null,
        repo: config.GITHUB_REPO || null,
        repoStatus: repoStatus,
        rateLimit: rateLimit
      },
      manifest: {
        loaded: manifest.isLoaded,
        gameCount: manifest.games.size,
        lastLoaded: manifest.lastLoaded
      },
      serverTime: new Date().toISOString()
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /api/github/rate-limit
 * Get latest GitHub API rate limit status
 */
app.get('/api/github/rate-limit', async (req, res) => {
  try {
    if (!config.isGitHubConfigured()) {
      return res.json({ success: false, error: 'GitHub not configured' });
    }
    const rateLimit = await gitHubClient.getRateLimit();
    res.json({ success: true, rateLimit });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * POST /api/manifest/update
 * Update Ludusavi manifest from upstream GitHub and re-cache
 */
app.post('/api/manifest/update', async (req, res) => {
  try {
    const result = await manifest.updateFromRemote();
    // Re-cache detected installed games with the new manifest
    const detected = scanner.getDetectedGames(manifest.getAllGames(), true);
    res.json({
      ...result,
      detectedCount: detected.length
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /api/manifest/find
 * Search for a game definition across all 53,000 games in the manifest
 */
app.get('/api/manifest/find', (req, res) => {
  try {
    const { appid, name } = req.query;
    const game = manifest.findGame(appid, name);
    if (!game) {
      return res.status(404).json({ success: false, error: 'Game not found in manifest database' });
    }

    const scan = scanner.scanGame(game);
    const localMeta = backupManager.getLocalMeta(game.id);

    res.json({
      success: true,
      game: {
        id: game.id,
        name: game.name,
        steamId: game.steamId,
        savePaths: game.savePaths,
        installed: scan.installed,
        saveFound: scan.saveFound,
        fileCount: scan.fileCount,
        totalSize: scan.totalSize,
        lastModified: scan.lastModified,
        saveFolder: scan.saveFolder || null,
        localBackup: localMeta
      }
    });
  } catch (err) {
    handleError(res, err);
  }
});


/**
 * GET /api/games
 * Get list of detected games using cache for instant response
 * Pass ?rescan=true to force a full re-scan of the entire manifest
 */
app.get('/api/games', (req, res) => {
  try {
    if (!manifest.isLoaded) {
      return res.status(503).json({ success: false, error: 'Manifest is not loaded yet' });
    }

    const allGames = manifest.getAllGames();
    const forceRescan = req.query.rescan === 'true';
    const detectedScans = scanner.getDetectedGames(allGames, forceRescan);

    const list = detectedScans.map((scan) => {
      const localMeta = backupManager.getLocalMeta(scan.id);
      const gameObj = manifest.getGame(scan.id);
      return {
        id: scan.id,
        name: scan.name,
        steamId: gameObj ? gameObj.steamId : null,
        installed: scan.installed,
        saveFound: scan.saveFound,
        fileCount: scan.fileCount,
        totalSize: scan.totalSize,
        lastModified: scan.lastModified,
        saveFolder: scan.saveFolder || null,
        localBackup: localMeta ? {
          updatedAt: localMeta.updatedAt,
          size: localMeta.size,
          sha256: localMeta.sha256
        } : null
      };
    });

    res.json({
      success: true,
      count: list.length,
      manifestTotal: allGames.length,
      games: list
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /api/cloud-games
 * List all games that have a remote backup on GitHub Cloud
 */
app.get('/api/cloud-games', async (req, res) => {
  try {
    if (!config.isGitHubConfigured()) {
      return res.json({
        success: true,
        count: 0,
        games: [],
        error: 'GitHub not configured'
      });
    }

    const remoteFilesMap = await gitHubClient.getRemoteFilesMap();
    const cloudGameIds = new Set();
    for (const filePath of remoteFilesMap.keys()) {
      const match = filePath.match(/^saves\/([^/]+)\/meta\.json$/);
      if (match) {
        cloudGameIds.add(match[1]);
      }
    }

    const cloudGames = await Promise.all(Array.from(cloudGameIds).map(async (id) => {
      const gameDef = manifest.getGame(id);
      const meta = await syncManager.getRemoteMeta(id, remoteFilesMap);
      const scan = gameDef ? scanner.scanGame(gameDef) : { saveFound: false, installed: false };
      
      return {
        id: id,
        name: (meta && meta.name) || (gameDef && gameDef.name) || id,
        steamId: (meta && meta.steamId) || (gameDef && gameDef.steamId) || null,
        remoteMeta: meta,
        local: scan,
        installed: scan.installed || false,
        saveFound: scan.saveFound || false
      };
    }));

    cloudGames.sort((a, b) => {
      const timeA = new Date(a.remoteMeta?.updatedAt || 0).getTime();
      const timeB = new Date(b.remoteMeta?.updatedAt || 0).getTime();
      return timeB - timeA;
    });

    res.json({
      success: true,
      count: cloudGames.length,
      games: cloudGames
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /api/games/:id
 * Get single game details and scan
 */
app.get('/api/games/:id', (req, res) => {
  const game = manifest.getGame(req.params.id);
  if (!game) {
    return res.status(404).json({ success: false, error: `Game '${req.params.id}' not found in manifest` });
  }

  const scan = scanner.scanGame(game);
  const localMeta = backupManager.getLocalMeta(game.id);

  res.json({
    success: true,
    game: {
      id: game.id,
      name: game.name,
      steamId: game.steamId,
      savePaths: game.savePaths,
      scan: scan,
      localBackup: localMeta
    }
  });
});

/**
 * GET /api/poster/:appId
 * Serve game poster directly from local Steam client files (appcache / userdata grid),
 * with fallback to cached Steam CDN download.
 */
app.get('/api/poster/:appId', async (req, res) => {
  try {
    const rawId = req.params.appId;
    if (!rawId) {
      return res.status(400).json({ success: false, error: 'Missing appId' });
    }

    let numericAppId = /^\d+$/.test(rawId) ? rawId : null;
    let game = null;

    if (!numericAppId) {
      game = manifest.getGame(rawId);
      if (!game) {
        const clean = rawId.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (clean && manifest.nameMap && manifest.nameMap.has(clean)) {
          game = manifest.nameMap.get(clean);
        }
      }
      if (game && game.steamId) {
        numericAppId = String(game.steamId);
      }
    } else {
      game = manifest.steamIdMap ? manifest.steamIdMap.get(numericAppId) : null;
    }

    const idsToSearch = [];
    if (rawId) idsToSearch.push(rawId);
    if (numericAppId && numericAppId !== rawId) idsToSearch.push(numericAppId);

    const steamDir = getSteamInstallPath();

    // 1. Search in local Steam directories (userdata custom grids & appcache)
    if (steamDir) {
      for (const id of idsToSearch) {
        // Priority A: Custom grid in userdata (portrait grid set by user or for non-steam games)
        try {
          const userdataDir = path.join(steamDir, 'userdata');
          if (fs.existsSync(userdataDir)) {
            const users = fs.readdirSync(userdataDir);
            for (const u of users) {
              const gridDir = path.join(userdataDir, u, 'config', 'grid');
              if (fs.existsSync(gridDir)) {
                const customFiles = [
                  path.join(gridDir, `${id}p.jpg`),
                  path.join(gridDir, `${id}p.png`),
                  path.join(gridDir, `${id}.jpg`),
                  path.join(gridDir, `${id}.png`),
                  path.join(gridDir, `${id}_hero.jpg`)
                ];
                for (const cf of customFiles) {
                  if (fs.existsSync(cf)) {
                    res.setHeader('Cache-Control', 'public, max-age=86400');
                    res.setHeader('X-Poster-Source', 'steam-userdata-grid');
                    return res.sendFile(path.resolve(cf));
                  }
                }
              }
            }
          }
        } catch {}

        // Priority B: Official Steam appcache library cache (supports both direct and modern SHA-1 hash subfolders)
        const appDir = path.join(steamDir, 'appcache', 'librarycache', id);
        if (fs.existsSync(appDir)) {
          const targetNames = [
            'library_600x900.jpg',
            'library_capsule.jpg',
            'library_header.jpg',
            'header.jpg'
          ];

          let matchedPath = null;
          // Direct check
          for (const name of targetNames) {
            const direct = path.join(appDir, name);
            if (fs.existsSync(direct)) {
              matchedPath = direct;
              break;
            }
          }

          // Search in modern Steam SHA-1 subdirectories
          if (!matchedPath) {
            try {
              const entries = fs.readdirSync(appDir, { withFileTypes: true });
              const subdirs = entries.filter(e => e.isDirectory()).map(e => path.join(appDir, e.name));
              for (const name of targetNames) {
                for (const subdir of subdirs) {
                  const subPath = path.join(subdir, name);
                  if (fs.existsSync(subPath)) {
                    matchedPath = subPath;
                    break;
                  }
                }
                if (matchedPath) break;
              }
            } catch {}
          }

          if (matchedPath) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.setHeader('X-Poster-Source', 'steam-appcache');
            return res.sendFile(path.resolve(matchedPath));
          }
        }

        // Also check legacy flat files named ${id}_library_600x900.jpg
        const legacyCandidates = [
          path.join(steamDir, 'appcache', 'librarycache', `${id}_library_600x900.jpg`),
          path.join(steamDir, 'appcache', 'librarycache', `${id}_header.jpg`)
        ];
        for (const lp of legacyCandidates) {
          if (fs.existsSync(lp)) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.setHeader('X-Poster-Source', 'steam-appcache-legacy');
            return res.sendFile(path.resolve(lp));
          }
        }
      }
    }

    // 2. Search local SaveSync cache directory
    const posterCacheDir = path.join(config.CACHE_DIR, 'posters');
    for (const id of idsToSearch) {
      const cachedFile = path.join(posterCacheDir, `${id}.jpg`);
      if (fs.existsSync(cachedFile)) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('X-Poster-Source', 'savesync-cache');
        return res.sendFile(path.resolve(cachedFile));
      }
    }

    return res.status(404).json({ success: false, error: 'Poster not found for ' + rawId });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /api/games-status
 * Batch check sync status for all detected games concurrently in one request
 */
app.get('/api/games-status', async (req, res) => {
  try {
    const allGames = manifest.getAllGames();
    const detectedScans = scanner.getDetectedGames(allGames, false);
    const targetGames = detectedScans
      .map(scan => manifest.getGame(scan.id))
      .filter(Boolean);

    const statusMap = await syncManager.getAllGamesSyncStatus(targetGames);

    res.json({
      success: true,
      statuses: statusMap
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /api/games/:id/status
 * Get full sync status (comparing local files and remote GitHub storage)
 */
app.get('/api/games/:id/status', async (req, res) => {
  const game = manifest.getGame(req.params.id);
  if (!game) {
    return res.status(404).json({ success: false, error: `Game '${req.params.id}' not found` });
  }

  try {
    const status = await syncManager.getGameSyncStatus(game);
    res.json({
      success: true,
      ...status
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * POST /api/games/:id/backup
 * Create local backup ZIP and calculate SHA-256
 */
app.post('/api/games/:id/backup', async (req, res) => {
  const game = manifest.getGame(req.params.id);
  if (!game) {
    return res.status(404).json({ success: false, error: `Game '${req.params.id}' not found` });
  }

  try {
    const backupRes = await backupManager.createBackup(game);
    res.json({
      success: true,
      message: `Local backup created successfully for ${game.name}`,
      meta: backupRes.meta
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * POST /api/games/:id/upload
 * Backup and upload directly to GitHub
 */
app.post('/api/games/:id/upload', async (req, res) => {
  const game = manifest.getGame(req.params.id);
  if (!game) {
    return res.status(404).json({ success: false, error: `Game '${req.params.id}' not found` });
  }

  try {
    const result = await syncManager.backupAndUpload(game);
    res.json({
      success: true,
      message: `Uploaded backup to GitHub for ${game.name}`,
      meta: result.meta
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * POST /api/games/:id/restore
 * Restore save from local backup or remote download
 */
app.post('/api/games/:id/restore', async (req, res) => {
  const game = manifest.getGame(req.params.id);
  if (!game) {
    return res.status(404).json({ success: false, error: `Game '${req.params.id}' not found` });
  }

  try {
    let restoreRes;
    const source = (req.body && req.body.source) || 'remote'; // 'remote' or 'local'

    if (source === 'remote') {
      restoreRes = await syncManager.downloadAndRestore(game);
    } else {
      const localMeta = backupManager.getLocalMeta(game.id);
      if (!localMeta) {
        return res.status(404).json({ success: false, error: 'No local backup found for restore' });
      }
      const localZipPath = require('path').join(config.CACHE_DIR, game.id, 'latest.zip');
      restoreRes = await restoreManager.restoreBackup(game.id, localZipPath, localMeta.sha256);
    }

    res.json({
      success: true,
      message: `Restored ${restoreRes.restoredFiles.length} files for ${game.name}`,
      meta: restoreRes.meta,
      restoredFiles: restoreRes.restoredFiles
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /api/games/:id/download-backup
 * Trigger browser file save dialog to download the backup ZIP
 */
app.get('/api/games/:id/download-backup', async (req, res) => {
  const game = manifest.getGame(req.params.id);
  if (!game) {
    return res.status(404).send('Game not found');
  }

  try {
    const backupRes = await backupManager.createBackup(game);
    const downloadFilename = `${game.id}_save_backup.zip`;
    res.download(backupRes.zipPath, downloadFilename);
  } catch (err) {
    res.status(500).send(`Backup failed: ${err.message}`);
  }
});

/**
 * POST /api/games/:id/restore-file
 * Restore save directly from an uploaded ZIP file chosen by the user
 */
app.post('/api/games/:id/restore-file', express.raw({ type: '*/*', limit: '500mb' }), async (req, res) => {
  const game = manifest.getGame(req.params.id);
  if (!game) {
    return res.status(404).json({ success: false, error: `Game '${req.params.id}' not found` });
  }

  try {
    const zipBuffer = req.body;
    if (!zipBuffer || !Buffer.isBuffer(zipBuffer) || zipBuffer.length === 0) {
      return res.status(400).json({ success: false, error: 'No backup zip file data received' });
    }

    const restoreRes = await restoreManager.restoreBackup(game.id, zipBuffer);
    res.json({
      success: true,
      message: `Restored ${restoreRes.restoredFiles.length} file(s) for ${game.name}`,
      restoredFiles: restoreRes.restoredFiles
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * POST /api/games/:id/sync
 * Synchronize single game with remote GitHub repo
 * Optional body: { resolution: 'keep_local' | 'use_remote' }
 */
app.post('/api/games/:id/sync', async (req, res) => {
  const game = manifest.getGame(req.params.id);
  if (!game) {
    return res.status(404).json({ success: false, error: `Game '${req.params.id}' not found` });
  }

  try {
    const resolution = req.body.resolution || null;
    const syncRes = await syncManager.syncGame(game, resolution);
    res.json(syncRes);
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * POST /api/sync
 * Sync all games that have saves or remote backups
 */
app.post('/api/sync', async (req, res) => {
  if (!manifest.isLoaded) {
    return res.status(503).json({ success: false, error: 'Manifest is not loaded' });
  }

  const allGames = manifest.getAllGames();
  const detectedScans = scanner.getDetectedGames(allGames, false);
  const targetGameIds = new Set(detectedScans.map(s => s.id));

  let remoteFilesMap = null;
  if (config.isGitHubConfigured()) {
    try {
      remoteFilesMap = await gitHubClient.getRemoteFilesMap();
      for (const filePath of remoteFilesMap.keys()) {
        const match = filePath.match(/^saves\/([^/]+)\/meta\.json$/);
        if (match) {
          targetGameIds.add(match[1]);
        }
      }
    } catch (err) {
      console.warn('[Sync] Could not fetch remote tree map for sync-all:', err.message);
    }
  }

  const targetGames = Array.from(targetGameIds).map(id => manifest.getGame(id)).filter(Boolean);
  const results = [];
  const conflicts = [];

  for (const game of targetGames) {
    try {
      const status = await syncManager.getGameSyncStatus(game, remoteFilesMap);
      if (status.state === syncManager.SYNC_STATES.NOT_FOUND) {
        continue;
      }

      if (status.state === syncManager.SYNC_STATES.CONFLICT) {
        conflicts.push({
          gameId: game.id,
          gameName: game.name,
          conflict: status
        });
        results.push({
          gameId: game.id,
          name: game.name,
          state: 'conflict'
        });
      } else {
        const syncRes = await syncManager.syncGame(game);
        results.push({
          gameId: game.id,
          name: game.name,
          ...syncRes
        });
      }
    } catch (err) {
      results.push({
        gameId: game.id,
        name: game.name,
        success: false,
        error: err.message
      });
    }
  }

  res.json({
    success: true,
    totalProcessed: results.length,
    conflictsCount: conflicts.length,
    conflicts: conflicts,
    results: results
  });
});

/**
 * GET /api/remote/:id
 * Fetch raw remote meta.json directly from GitHub
 */
app.get('/api/remote/:id', async (req, res) => {
  if (!config.isGitHubConfigured()) {
    return res.status(400).json({ success: false, error: 'GitHub is not configured' });
  }

  try {
    const meta = await syncManager.getRemoteMeta(req.params.id);
    if (!meta) {
      return res.status(404).json({ success: false, error: `No remote backup found for game '${req.params.id}'` });
    }
    res.json({
      success: true,
      gameId: req.params.id,
      meta: meta
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * POST /api/games/:id/open-folder
 * Open local save directory in Windows Explorer
 */
app.post('/api/games/:id/open-folder', (req, res) => {
  const game = manifest.getGame(req.params.id);
  if (!game) {
    return res.status(404).json({ success: false, error: 'Game not found' });
  }

  const scan = scanner.scanGame(game);
  if (!scan || !scan.saveFound || scan.files.length === 0) {
    return res.status(404).json({ success: false, error: 'No save files found for this game' });
  }

  const path = require('path');
  const fs = require('fs');
  const { spawn } = require('child_process');

  const firstFile = scan.files[0].absolutePath;
  const folderToOpen = path.normalize(path.dirname(firstFile));

  if (!fs.existsSync(folderToOpen)) {
    return res.status(404).json({ success: false, error: 'Save folder does not exist on this computer' });
  }

  if (process.platform === 'win32') {
    // Open the folder directly with Windows Explorer
    const child = spawn('explorer.exe', [folderToOpen], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
  } else if (process.platform === 'darwin') {
    const child = spawn('open', [folderToOpen], { detached: true, stdio: 'ignore' });
    child.unref();
  } else {
    const child = spawn('xdg-open', [folderToOpen], { detached: true, stdio: 'ignore' });
    child.unref();
  }

  res.json({ success: true, folder: folderToOpen });
});

/**
 * DELETE /api/games/:id/cloud
 * Delete game save from GitHub cloud repository
 */
app.delete('/api/games/:id/cloud', async (req, res) => {
  try {
    const game = manifest.getGame(req.params.id);
    if (!game) {
      return res.status(404).json({ success: false, error: 'Game not found' });
    }

    const files = await gitHubClient.listFiles(game.id);
    if (!files || files.length === 0) {
      return res.status(404).json({ success: false, error: 'No cloud files found for this game' });
    }

    for (const file of files) {
      await gitHubClient.deleteFile(file.path, file.sha, `Delete cloud backup for ${game.name}`);
    }

    syncManager.metaCache.delete(game.id);
    res.json({ success: true, message: `Cloud backup for ${game.name} deleted successfully` });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /api/games/:id/process-check
 * Check if the game executable is currently active in process list
 */
app.get('/api/games/:id/process-check', (req, res) => {
  const game = manifest.getGame(req.params.id);
  if (!game) {
    return res.status(404).json({ success: false, error: 'Game not found' });
  }

  const slug = game.id.toLowerCase();
  const { execFile } = require('child_process');

  if (process.platform === 'win32') {
    execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (err, stdout) => {
      if (err) return res.json({ success: true, isRunning: false });
      const lines = stdout.toLowerCase().split('\n');
      let found = false;
      let procName = '';
      const cleanSlug = slug.replace(/-/g, '');

      for (const line of lines) {
        const parts = line.split(',');
        if (parts[0]) {
          const name = parts[0].replace(/"/g, '').trim();
          if (name.includes(cleanSlug) || slug.split('-').some(word => word.length >= 5 && name.includes(word))) {
            found = true;
            procName = name;
            break;
          }
        }
      }
      res.json({ success: true, isRunning: found, processName: procName });
    });
  } else {
    res.json({ success: true, isRunning: false });
  }
});

/**
 * GET /api/poster/:appId
 * Proxy and fallback Steam game posters from Steam CDNs with caching
 */
app.get('/api/poster/:appId', async (req, res) => {
  const appId = req.params.appId;
  if (!appId || appId === '0' || !/^\d+$/.test(appId)) {
    return res.status(404).send('Invalid AppId');
  }

  const cdnCandidates = [
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
    `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/library_600x900.jpg`,
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`
  ];

  for (const url of cdnCandidates) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3500) });
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(Buffer.from(buffer));
      }
    } catch {
      // continue to next candidate
    }
  }

  res.status(404).send('Poster not found');
});

/**
 * GET /api/banner/:appId
 * Proxy and fallback horizontal Steam game banners (header.jpg / capsule) with caching
 */
app.get('/api/banner/:appId', async (req, res) => {
  const appId = req.params.appId;
  if (!appId || appId === '0' || !/^\d+$/.test(appId)) {
    return res.status(404).send('Invalid AppId');
  }

  const cdnCandidates = [
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
    `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/header.jpg`,
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_231x87.jpg`
  ];

  for (const url of cdnCandidates) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3500) });
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(Buffer.from(buffer));
      }
    } catch {
      // continue to next candidate
    }
  }

  res.status(404).send('Banner not found');
});


/**
 * POST /api/shutdown
 * Gracefully terminate the SaveSync daemon when Steam exits
 */
app.post('/api/shutdown', (req, res) => {
  res.json({ success: true, message: 'Shutting down SaveSync daemon...' });
  console.log('[Server] Shutdown signal received from Steam plugin. Exiting...');
  setTimeout(() => process.exit(0), 300);
});

// Auto-terminate watchdog: If Steam Client closes, exit SaveSync silently
if (require.main === module) {
  const { execFile } = require('child_process');

  // Automatic Steam Watchdog: exit daemon when Steam is closed
  let steamSeen = false;
  const startSteamWatchdog = () => {
    if (process.platform !== 'win32') return;
    const interval = setInterval(() => {
      // Use execFile instead of exec so cmd.exe is NEVER launched and no window can flash
      execFile('tasklist.exe', ['/FI', 'IMAGENAME eq steam.exe', '/NH'], { windowsHide: true }, (err, stdout) => {
        if (err) return;
        const isSteamRunning = stdout && stdout.toLowerCase().includes('steam.exe');
        if (isSteamRunning) {
          steamSeen = true;
        } else if (steamSeen) {
          console.log('[Server] Steam has closed. Terminating SaveSync daemon...');
          clearInterval(interval);
          process.exit(0);
        }
      });
    }, 30000);
    interval.unref();
  };

  const startServer = (port) => {
    const server = app.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(`===================================================`);
      console.log(` SaveSync Steam Plugin Daemon running at ${url}`);
      console.log(` GitHub Configured: ${config.isGitHubConfigured()}`);
      console.log(` Mode: Headless Background Service (Steam Lifecycle)`);
      console.log(`===================================================`);

      startSteamWatchdog();
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[Server] Port ${port} is in use, trying ${port + 1}...`);
        startServer(port + 1);
      } else {
        console.error('[Server] Listen error:', err.message);
      }
    });
  };

  startServer(config.PORT);
}

module.exports = app;
