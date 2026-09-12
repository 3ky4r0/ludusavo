const express = require('express');
const config = require('./config');
const manifest = require('./manifest');
const scanner = require('./scanner');
const backupManager = require('./backup');
const restoreManager = require('./restore');
const syncManager = require('./sync');
const gitHubClient = require('./github');

const app = express();
app.use(express.json());
app.use(express.static(config.WEB_DIR));

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
  let repoStatus = null;
  if (config.isGitHubConfigured()) {
    repoStatus = await gitHubClient.checkRepository();
  }

  res.json({
    success: true,
    app: 'SaveSync',
    github: {
      configured: config.isGitHubConfigured(),
      owner: config.GITHUB_OWNER || null,
      repo: config.GITHUB_REPO || null,
      repoStatus: repoStatus
    },
    manifest: {
      loaded: manifest.isLoaded,
      gameCount: manifest.games.size,
      lastLoaded: manifest.lastLoaded
    },
    serverTime: new Date().toISOString()
  });
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
 * GET /api/games-status
 * Batch check sync status for all detected games concurrently in one request
 */
app.get('/api/games-status', async (req, res) => {
  try {
    const allGames = manifest.getAllGames();
    const detectedScans = scanner.getDetectedGames(allGames, false);

    const results = await Promise.all(detectedScans.map(async (scan) => {
      const gameObj = manifest.getGame(scan.id);
      if (!gameObj) return null;
      try {
        const status = await syncManager.getGameSyncStatus(gameObj);
        return {
          id: scan.id,
          status: status
        };
      } catch (err) {
        return {
          id: scan.id,
          status: { state: 'LOCAL_ONLY', local: scan, remote: null }
        };
      }
    }));

    const statusMap = {};
    for (const r of results) {
      if (r) {
        statusMap[r.id] = r.status;
      }
    }

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
    const source = req.body.source || 'remote'; // 'remote' or 'local'

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
  const results = [];
  const conflicts = [];

  for (const game of allGames) {
    const scan = scanner.scanGame(game);
    // Only attempt sync if save found locally or remote metadata exists
    if (!scan.saveFound && !config.isGitHubConfigured()) {
      continue;
    }

    try {
      const status = await syncManager.getGameSyncStatus(game);
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
    return res.status(404).json({ success: false, error: 'Thư mục save không tồn tại trên máy tính' });
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
 * GET /api/games/:id/process-check
 * Check if the game executable is currently active in process list
 */
app.get('/api/games/:id/process-check', (req, res) => {
  const game = manifest.getGame(req.params.id);
  if (!game) {
    return res.status(404).json({ success: false, error: 'Game not found' });
  }

  const slug = game.id.toLowerCase();
  const { exec } = require('child_process');

  if (process.platform === 'win32') {
    exec('tasklist /FO CSV /NH', (err, stdout) => {
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

if (require.main === module) {
  const startServer = (port) => {
    const server = app.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(`========================================`);
      console.log(` SaveSync running at ${url}`);
      console.log(` GitHub Configured: ${config.isGitHubConfigured()}`);
      console.log(`========================================`);

      // Automatically open in native Desktop App Mode on startup
      if (process.env.NO_OPEN !== '1' && process.env.NODE_ENV !== 'test') {
        try {
          const { exec } = require('child_process');
          const fs = require('fs');
          const path = require('path');

          if (process.platform === 'win32') {
            const candidates = [
              (process.env['LOCALAPPDATA'] || '') + '\\Chromium\\Application\\chrome.exe',
              (process.env['ProgramFiles'] || '') + '\\Google\\Chrome\\Application\\chrome.exe',
              (process.env['ProgramFiles(x86)'] || '') + '\\Google\\Chrome\\Application\\chrome.exe',
              (process.env['LOCALAPPDATA'] || '') + '\\Google\\Chrome\\Application\\chrome.exe',
              (process.env['ProgramFiles(x86)'] || '') + '\\Microsoft\\Edge\\Application\\msedge.exe',
              (process.env['ProgramFiles'] || '') + '\\Microsoft\\Edge\\Application\\msedge.exe',
              (process.env['ProgramFiles'] || '') + '\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
            ];

            let browserPath = candidates.find(p => p && fs.existsSync(p));

            if (!browserPath) {
              const edgeCoreBase = 'C:\\Program Files (x86)\\Microsoft\\EdgeCore';
              if (fs.existsSync(edgeCoreBase)) {
                try {
                  for (const s of fs.readdirSync(edgeCoreBase)) {
                    const p = path.join(edgeCoreBase, s, 'msedge.exe');
                    if (fs.existsSync(p)) { browserPath = p; break; }
                  }
                } catch { /* ignore */ }
              }
            }

            if (browserPath) {
              // Open in standalone native App Mode window (no URL bar, no tabs)
              const profileDir = path.join(process.env.TEMP || 'C:\\temp', 'SaveSync-Profile');
              const { spawn } = require('child_process');
              const child = spawn(browserPath, [
                `--app=${url}`,
                '--window-size=1040,750',
                `--user-data-dir=${profileDir}`
              ], { detached: false, stdio: 'ignore' });

              // When the user closes the app window, exit the server cleanly
              child.on('exit', () => {
                process.exit(0);
              });
            } else {
              exec(`start "" "${url}"`);
            }
          } else if (process.platform === 'darwin') {
            exec(`open -na "Google Chrome" --args --app="${url}"`, (err) => {
              if (err) exec(`open "${url}"`);
            });
          } else {
            exec(`google-chrome --app="${url}"`, (err) => {
              if (err) exec(`xdg-open "${url}"`);
            });
          }
        } catch {
          // ignore browser launch failure
        }
      }
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
