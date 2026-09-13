const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const config = require('./config');
const scanner = require('./scanner');
const hashUtil = require('./hash');

const YAML = require('yaml');

class BackupManager {
  /**
   * Helper to format path into Ludusavi archive path and drive mapping
   */
  getLudusaviArchivePath(absPath) {
    const normalized = path.normalize(absPath);
    const parsed = path.parse(normalized);
    let driveKey;
    let driveRoot;
    let relativePath;

    if (process.platform === 'win32') {
      const letterMatch = parsed.root.match(/^[a-zA-Z]/);
      const letter = letterMatch ? letterMatch[0].toUpperCase() : 'C';
      driveKey = `drive-${letter}`;
      driveRoot = `${letter}:`;
      relativePath = normalized.slice(parsed.root.length).split(path.sep).join('/');
    } else {
      driveKey = 'drive-0';
      driveRoot = '/';
      relativePath = normalized.replace(/^\/+/, '').split(path.sep).join('/');
    }

    return {
      driveKey,
      driveRoot,
      archivePath: `${driveKey}/${relativePath}`,
      yamlPath: normalized.split(path.sep).join('/')
    };
  }

  /**
   * Create a backup archive for a game
   * @param {object} game Manifest game object
   * @returns {Promise<{zipPath: string, metaPath: string, mappingPath: string, meta: object}>}
   */
  async createBackup(game) {
    if (!game) {
      throw new Error('Game definition is required for backup');
    }

    // 1. Scan game save files
    const scanResult = scanner.scanGame(game);
    if (!scanResult || !scanResult.saveFound || scanResult.files.length === 0) {
      throw new Error(`No save files found for game: ${game.name}`);
    }

    // 2. Prepare game cache directory and temp staging
    const gameCacheDir = path.join(config.CACHE_DIR, game.id);
    if (!fs.existsSync(gameCacheDir)) {
      fs.mkdirSync(gameCacheDir, { recursive: true });
    }

    const timestamp = Date.now();
    const tempBackupDir = path.join(config.TEMP_DIR, `backup_${game.id}_${timestamp}`);
    fs.mkdirSync(tempBackupDir, { recursive: true });

    const zipTempPath = path.join(tempBackupDir, 'latest.zip');
    const finalZipPath = path.join(gameCacheDir, 'latest.zip');
    const finalMetaPath = path.join(gameCacheDir, 'meta.json');
    const finalMappingPath = path.join(gameCacheDir, 'mapping.yaml');

    try {
      // 3. Build Ludusavi drives and files mapping
      const drives = {};
      const ludusaviFiles = {};
      const fileMappings = [];

      // Compute file hashes asynchronously in parallel without blocking the event loop
      const fileSha1Promises = scanResult.files.map(file => hashUtil.computeSha1(file.absolutePath));
      const fileSha1List = await Promise.all(fileSha1Promises);

      for (let i = 0; i < scanResult.files.length; i++) {
        const file = scanResult.files[i];
        const fileSha1 = fileSha1List[i];
        const info = this.getLudusaviArchivePath(file.absolutePath);
        drives[info.driveKey] = info.driveRoot;

        ludusaviFiles[info.yamlPath] = {
          hash: fileSha1,
          size: file.size
        };

        fileMappings.push({
          archivePath: info.archivePath,
          placeholderPath: file.placeholderPath,
          targetPath: file.absolutePath,
          size: file.size,
          mtime: file.mtime,
          fileHash: fileSha1
        });
      }

      if (Object.keys(drives).length === 0) {
        drives['drive-C'] = 'C:';
      }

      const ludusaviMapping = {
        name: game.name,
        drives: drives,
        backups: [
          {
            name: '.',
            when: new Date().toISOString(),
            os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux',
            files: ludusaviFiles,
            registry: { hash: null },
            children: []
          }
        ]
      };

      const yamlContent = YAML.stringify(ludusaviMapping);

      const meta = {
        gameId: game.id,
        gameName: game.name,
        fileCount: fileMappings.length,
        size: scanResult.totalSize,
        lastModified: scanResult.lastModified,
        updatedAt: new Date().toISOString(),
        mappings: fileMappings,
        drives: drives
      };

      // 4. Create ZIP stream following Ludusavi directory structure
      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipTempPath);
        const archive = archiver('zip', {
          zlib: { level: 6 } // Balanced standard compression (much faster than level 9 with nearly identical size)
        });

        output.on('close', resolve);
        archive.on('error', reject);

        archive.pipe(output);

        // Append Ludusavi mapping.yaml at root of ZIP
        archive.append(yamlContent, { name: 'mapping.yaml' });

        // Append self-contained meta.json for backward compatibility
        archive.append(JSON.stringify(meta, null, 2), { name: 'meta.json' });

        // Append each save file to archive under its drive alias folder (e.g. drive-C/Users/...)
        for (let i = 0; i < scanResult.files.length; i++) {
          const file = scanResult.files[i];
          const mapping = fileMappings[i];
          archive.file(file.absolutePath, { name: mapping.archivePath });
        }

        archive.finalize();
      });

      // 5. Calculate SHA-256 of the created ZIP archive
      const zipHash = await hashUtil.computeFileHash(zipTempPath);
      const zipStat = fs.statSync(zipTempPath);

      meta.sha256 = zipHash;
      meta.zipSize = zipStat.size;

      // 6. Atomically copy zip and metadata to cache
      fs.copyFileSync(zipTempPath, finalZipPath);
      fs.writeFileSync(finalMetaPath, JSON.stringify(meta, null, 2), 'utf8');
      fs.writeFileSync(finalMappingPath, yamlContent, 'utf8');

      return {
        zipPath: finalZipPath,
        metaPath: finalMetaPath,
        mappingPath: finalMappingPath,
        meta: meta
      };
    } finally {
      // 7. Cleanup temp directory
      try {
        if (fs.existsSync(tempBackupDir)) {
          fs.rmSync(tempBackupDir, { recursive: true, force: true });
        }
      } catch (err) {
        console.warn(`[Backup] Failed to clean temp dir: ${tempBackupDir}`, err.message);
      }
    }
  }

  /**
   * Get cached local backup metadata if available
   */
  getLocalMeta(gameId) {
    const metaPath = path.join(config.CACHE_DIR, gameId, 'meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const backupManager = new BackupManager();
module.exports = backupManager;
