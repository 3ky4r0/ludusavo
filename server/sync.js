const fs = require('fs');
const path = require('path');
const config = require('./config');
const manifest = require('./manifest');
const scanner = require('./scanner');
const backupManager = require('./backup');
const restoreManager = require('./restore');
const gitHubClient = require('./github');

const SYNC_STATES = {
  SYNCED: 'SYNCED',
  LOCAL_ONLY: 'LOCAL_ONLY',
  REMOTE_ONLY: 'REMOTE_ONLY',
  LOCAL_NEWER: 'LOCAL_NEWER',
  REMOTE_NEWER: 'REMOTE_NEWER',
  CONFLICT: 'CONFLICT',
  NOT_FOUND: 'NOT_FOUND'
};

class SyncManager {
  constructor() {
    this.metaCache = new Map(); // gameId -> { sha, meta }
  }

  /**
   * Fetch remote metadata for a game from GitHub
   * @param {string} gameId
   * @param {Map<string, object>|null} remoteFilesMap Optional preloaded repo tree map
   */
  async getRemoteMeta(gameId, remoteFilesMap = null) {
    if (!config.isGitHubConfigured()) {
      return null;
    }
    const remotePath = `saves/${gameId}/meta.json`;

    // Fast path: if remote files map is available, verify existence before network call
    if (remoteFilesMap) {
      if (!remoteFilesMap.has(remotePath)) {
        return null;
      }
      const item = remoteFilesMap.get(remotePath);
      const cached = this.metaCache.get(gameId);
      if (cached && cached.sha === item.sha) {
        return cached.meta;
      }
    }

    const fileRes = await gitHubClient.getFile(remotePath);
    if (!fileRes) {
      return null;
    }
    try {
      const parsed = JSON.parse(fileRes.content.toString('utf8'));
      this.metaCache.set(gameId, { sha: fileRes.sha, meta: parsed });
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Check if local save files match remote metadata mappings exactly by hash and size asynchronously
   */
  async areFilesIdentical(localFiles, remoteMappings) {
    if (!localFiles || !remoteMappings || localFiles.length !== remoteMappings.length) {
      return false;
    }
    const hashUtil = require('./hash');
    for (const localFile of localFiles) {
      try {
        const localHashSha1 = await hashUtil.computeSha1(localFile.absolutePath);
        const match = remoteMappings.find(m => 
          m.fileHash === localHashSha1 && m.size === localFile.size
        );
        if (match) continue;

        const localHashSha256 = await hashUtil.computeFileHash(localFile.absolutePath);
        const matchSha256 = remoteMappings.find(m => 
          m.fileHash === localHashSha256 && m.size === localFile.size
        );
        if (!matchSha256) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  /**
   * Get the actual game modification timestamp of the remote backup (NOT the upload time)
   */
  getRemoteGameTime(remoteMeta) {
    if (remoteMeta.lastModified) {
      const t = new Date(remoteMeta.lastModified).getTime();
      if (t > 0) return t;
    }
    if (remoteMeta.mappings && Array.isArray(remoteMeta.mappings) && remoteMeta.mappings.length > 0) {
      const times = remoteMeta.mappings.map(m => m.mtime || 0).filter(t => t > 0);
      if (times.length > 0) {
        return Math.max(...times);
      }
    }
    return remoteMeta.updatedAt ? new Date(remoteMeta.updatedAt).getTime() : 0;
  }

  /**
   * Determine sync status for a game
   * @param {object} game Manifest game object
   * @param {Map<string, object>|null} remoteFilesMap Optional preloaded repo tree map
   */
  async getGameSyncStatus(game, remoteFilesMap = null) {
    const localScan = scanner.scanGame(game);
    const localMeta = backupManager.getLocalMeta(game.id);
    let remoteMeta = null;

    if (config.isGitHubConfigured()) {
      try {
        remoteMeta = await this.getRemoteMeta(game.id, remoteFilesMap);
      } catch (err) {
        console.warn(`[Sync] Could not check remote for ${game.id}:`, err.message);
      }
    }

    const localFound = Boolean(localScan && localScan.saveFound);
    const remoteFound = Boolean(remoteMeta);

    // Case 1: Not found anywhere
    if (!localFound && !remoteFound) {
      return {
        gameId: game.id,
        gameName: game.name,
        state: SYNC_STATES.NOT_FOUND,
        local: localScan,
        remote: null
      };
    }

    // Case 2: Only exists locally
    if (localFound && !remoteFound) {
      return {
        gameId: game.id,
        gameName: game.name,
        state: SYNC_STATES.LOCAL_ONLY,
        local: localScan,
        remote: null
      };
    }

    // Case 3: Only exists on remote
    if (!localFound && remoteFound) {
      return {
        gameId: game.id,
        gameName: game.name,
        state: SYNC_STATES.REMOTE_ONLY,
        local: localScan,
        remote: remoteMeta
      };
    }

    // Case 4: Exists both locally and remotely
    const localModifiedTime = localScan.lastModified ? new Date(localScan.lastModified).getTime() : 0;
    const remoteGameTime = this.getRemoteGameTime(remoteMeta);

    // 1. First priority: Check if local save files match remote backup by hash/content
    const sha256Match = Boolean(localMeta && localMeta.sha256 && remoteMeta.sha256 && localMeta.sha256.toLowerCase() === remoteMeta.sha256.toLowerCase());
    const contentMatch = sha256Match || (await this.areFilesIdentical(localScan.files, remoteMeta.mappings));

    if (contentMatch) {
      // Content on disk currently matches remote exactly!
      // Check if user played further on this machine after the last backup
      if (localMeta) {
        const localBackupTime = localMeta.updatedAt ? new Date(localMeta.updatedAt).getTime() : 0;
        const localChangedSinceBackup = localModifiedTime > (localBackupTime + 1000);
        if (localChangedSinceBackup) {
          return {
            gameId: game.id,
            gameName: game.name,
            state: SYNC_STATES.LOCAL_NEWER,
            local: localScan,
            remote: remoteMeta
          };
        }
      }
      return {
        gameId: game.id,
        gameName: game.name,
        state: SYNC_STATES.SYNCED,
        local: localScan,
        remote: remoteMeta
      };
    }

    // 2. Content differs! Use local backup anchor if available
    if (localMeta) {
      const localBackupTime = localMeta.updatedAt ? new Date(localMeta.updatedAt).getTime() : 0;
      const localChangedSinceBackup = localModifiedTime > (localBackupTime + 1000);

      if (localChangedSinceBackup) {
        // Both sides have changes since last sync -> CONFLICT
        return {
          gameId: game.id,
          gameName: game.name,
          state: SYNC_STATES.CONFLICT,
          local: localScan,
          remote: remoteMeta
        };
      } else {
        // Local has not changed, remote was updated by another device
        return {
          gameId: game.id,
          gameName: game.name,
          state: SYNC_STATES.REMOTE_NEWER,
          local: localScan,
          remote: remoteMeta
        };
      }
    }

    // 3. No local cached backup anchor (e.g. fresh machine or cache cleared)
    // Compare actual game save modification times (NOT the upload time!):
    if (remoteGameTime > (localModifiedTime + 3000)) {
      return {
        gameId: game.id,
        gameName: game.name,
        state: SYNC_STATES.REMOTE_NEWER,
        local: localScan,
        remote: remoteMeta
      };
    }

    if (localModifiedTime > (remoteGameTime + 3000)) {
      return {
        gameId: game.id,
        gameName: game.name,
        state: SYNC_STATES.LOCAL_NEWER,
        local: localScan,
        remote: remoteMeta
      };
    }

    // Ambiguous difference within tolerance window: mark as CONFLICT for safety
    return {
      gameId: game.id,
      gameName: game.name,
      state: SYNC_STATES.CONFLICT,
      local: localScan,
      remote: remoteMeta
    };
  }

  /**
   * Batch check sync status for games using 1 single GitHub tree API call
   * @param {Array<object>} games List of manifest game objects
   * @returns {Promise<Record<string, object>>} Map of gameId -> sync status
   */
  async getAllGamesSyncStatus(games) {
    let remoteFilesMap = null;
    if (config.isGitHubConfigured()) {
      try {
        remoteFilesMap = await gitHubClient.getRemoteFilesMap();
      } catch (err) {
        console.warn('[Sync] Could not fetch remote tree map:', err.message);
      }
    }

    const results = await Promise.all(games.map(async (game) => {
      try {
        const status = await this.getGameSyncStatus(game, remoteFilesMap);
        return { id: game.id, status };
      } catch (err) {
        return {
          id: game.id,
          status: { state: SYNC_STATES.LOCAL_ONLY, local: scanner.scanGame(game), remote: null }
        };
      }
    }));

    const statusMap = {};
    for (const r of results) {
      if (r) statusMap[r.id] = r.status;
    }
    return statusMap;
  }

  /**
   * Perform backup and upload to GitHub
   */
  async backupAndUpload(game) {
    if (!config.isGitHubConfigured()) {
      throw new Error('Cannot upload: GitHub credentials are not configured in .env');
    }

    // 1. Create local backup ZIP
    const backupRes = await backupManager.createBackup(game);

    // 2. Read zip buffer
    const zipBuffer = fs.readFileSync(backupRes.zipPath);
    const metaBuffer = Buffer.from(JSON.stringify(backupRes.meta, null, 2), 'utf8');

    // 3. Upload to GitHub: saves/{gameId}/latest.zip and saves/{gameId}/meta.json
    const zipRepoPath = `saves/${game.id}/latest.zip`;
    const metaRepoPath = `saves/${game.id}/meta.json`;

    await gitHubClient.uploadOrUpdateFile(
      zipRepoPath,
      zipBuffer,
      `SaveSync backup for ${game.name} (${backupRes.meta.sha256.substring(0, 8)})`
    );

    await gitHubClient.uploadOrUpdateFile(
      metaRepoPath,
      metaBuffer,
      `SaveSync metadata for ${game.name}`
    );

    this.metaCache.delete(game.id);

    return {
      success: true,
      action: 'uploaded',
      meta: backupRes.meta
    };
  }

  /**
   * Download latest backup from GitHub and restore
   */
  async downloadAndRestore(game) {
    if (!config.isGitHubConfigured()) {
      throw new Error('Cannot download: GitHub credentials are not configured in .env');
    }

    const zipRepoPath = `saves/${game.id}/latest.zip`;
    const metaRepoPath = `saves/${game.id}/meta.json`;

    // 1. Fetch remote meta
    const metaFile = await gitHubClient.getFile(metaRepoPath);
    if (!metaFile) {
      throw new Error(`No remote backup found for game ${game.name}`);
    }
    const remoteMeta = JSON.parse(metaFile.content.toString('utf8'));

    // 2. Fetch latest.zip
    const zipFile = await gitHubClient.getFile(zipRepoPath);
    if (!zipFile) {
      throw new Error(`Corrupted remote storage: missing latest.zip for ${game.name}`);
    }

    // 3. Restore safely with SHA-256 validation
    const restoreRes = await restoreManager.restoreBackup(game.id, zipFile.content, remoteMeta.sha256);

    this.metaCache.delete(game.id);

    return {
      success: true,
      action: 'restored',
      meta: restoreRes.meta,
      restoredFiles: restoreRes.restoredFiles
    };
  }

  /**
   * Execute sync for a game
   * @param {object} game
   * @param {'keep_local'|'use_remote'|null} resolution Optional conflict resolution
   */
  async syncGame(game, resolution = null) {
    const status = await this.getGameSyncStatus(game);

    if (resolution === 'keep_local') {
      return await this.backupAndUpload(game);
    }

    if (resolution === 'use_remote') {
      return await this.downloadAndRestore(game);
    }

    switch (status.state) {
      case SYNC_STATES.SYNCED:
        return {
          success: true,
          action: 'none',
          status: 'synced',
          message: 'Already synchronized with remote'
        };

      case SYNC_STATES.LOCAL_ONLY:
      case SYNC_STATES.LOCAL_NEWER:
        return await this.backupAndUpload(game);

      case SYNC_STATES.REMOTE_ONLY:
      case SYNC_STATES.REMOTE_NEWER:
        return await this.downloadAndRestore(game);

      case SYNC_STATES.CONFLICT:
        return {
          success: false,
          status: 'conflict',
          message: 'Conflict detected: Local save and remote save are different.',
          conflict: {
            gameId: game.id,
            gameName: game.name,
            local: status.local,
            remote: status.remote
          }
        };

      case SYNC_STATES.NOT_FOUND:
      default:
        return {
          success: false,
          status: 'not_found',
          message: 'No save found locally or remotely'
        };
    }
  }
}

const syncManager = new SyncManager();
syncManager.SYNC_STATES = SYNC_STATES;
module.exports = syncManager;
