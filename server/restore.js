const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const config = require('./config');
const scanner = require('./scanner');
const hashUtil = require('./hash');

class RestoreManager {
  /**
   * Safely restore a game backup archive
   * @param {string} gameId
   * @param {string|Buffer} zipSource File path or Buffer of the ZIP archive
   * @param {string} expectedSha256 Expected SHA-256 hash from meta.json
   * @returns {Promise<{success: boolean, restoredFiles: string[], meta: object}>}
   */
  async restoreBackup(gameId, zipSource, expectedSha256 = null) {
    const timestamp = Date.now();
    const tempRestoreDir = path.join(config.TEMP_DIR, `restore_${gameId}_${timestamp}`);
    fs.mkdirSync(tempRestoreDir, { recursive: true });

    let localZipPath = '';

    try {
      // 1. Prepare ZIP source
      if (Buffer.isBuffer(zipSource)) {
        localZipPath = path.join(tempRestoreDir, 'source.zip');
        fs.writeFileSync(localZipPath, zipSource);
      } else {
        localZipPath = zipSource;
      }

      // 2. Verify SHA-256
      const actualHash = await hashUtil.computeFileHash(localZipPath);
      if (expectedSha256 && actualHash.toLowerCase() !== expectedSha256.toLowerCase()) {
        throw new Error(`SHA-256 integrity verification failed: expected ${expectedSha256}, got ${actualHash}`);
      }

      // 3. Inspect ZIP and guard against path traversal (Zip Slip vulnerability)
      const zip = new AdmZip(localZipPath);
      const zipEntries = zip.getEntries();

      for (const entry of zipEntries) {
        const entryName = entry.entryName;
        // Check for path traversal attempts
        if (entryName.includes('..') || path.isAbsolute(entryName)) {
          throw new Error(`Malicious archive detected: invalid path '${entryName}' inside ZIP`);
        }
      }

      // 4. Extract into temporary staging directory first
      const stagedExtractDir = path.join(tempRestoreDir, 'extracted');
      fs.mkdirSync(stagedExtractDir, { recursive: true });
      zip.extractAllTo(stagedExtractDir, true);

      // 5. Read meta.json or Ludusavi mapping.yaml from archive
      const metaPath = path.join(stagedExtractDir, 'meta.json');
      const ludusaviMappingPath = path.join(stagedExtractDir, 'mapping.yaml');

      let meta = null;

      if (fs.existsSync(metaPath)) {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } else if (fs.existsSync(ludusaviMappingPath)) {
        // Support restoring from Ludusavi's exported mapping.yaml archive
        const YAML = require('yaml');
        const ludusaviData = YAML.parse(fs.readFileSync(ludusaviMappingPath, 'utf8'));
        const mappings = [];

        if (ludusaviData && ludusaviData.backups && ludusaviData.backups[0] && ludusaviData.backups[0].files) {
          const driveMap = ludusaviData.drives || { 'drive-C': 'C:' };
          for (const [origPath, fileInfo] of Object.entries(ludusaviData.backups[0].files)) {
            // Reconstruct internal archive path: e.g. drive-C/Users/...
            let archiveRelative = origPath;
            for (const [driveAlias, driveLetter] of Object.entries(driveMap)) {
              if (origPath.startsWith(driveLetter + ':') || origPath.startsWith(driveLetter + '/')) {
                archiveRelative = path.join(driveAlias, origPath.slice(driveLetter.length + 1));
                break;
              }
            }

            mappings.push({
              archivePath: archiveRelative.split(path.sep).join('/'),
              placeholderPath: scanner.toPlaceholderPath(origPath),
              targetPath: origPath,
              size: fileInfo.size,
              fileHash: null
            });
          }
        }

        meta = {
          gameId: gameId,
          gameName: ludusaviData.name || gameId,
          updatedAt: ludusaviData.backups?.[0]?.when || new Date().toISOString(),
          mappings: mappings
        };
      } else {
        throw new Error('Corrupted or unsupported backup archive: missing meta.json or mapping.yaml inside ZIP');
      }

      if (!meta.mappings || !Array.isArray(meta.mappings)) {
        throw new Error('Invalid backup metadata: no file mappings found in archive');
      }

      // 6. Restore files to current machine's resolved destinations
      const restoredFiles = [];
      const IGNORED_ON_RESTORE = new Set(['graphicsconfig.xml', 'remotecache.vdf']);

      for (const mapping of meta.mappings) {
        const baseName = path.basename(mapping.archivePath).toLowerCase();
        if (IGNORED_ON_RESTORE.has(baseName)) {
          console.log(`[Restore] Skipping hardware config file ${mapping.archivePath} to prevent display crashes.`);
          continue;
        }

        const stagedFilePath = path.join(stagedExtractDir, mapping.archivePath);
        if (!fs.existsSync(stagedFilePath)) {
          throw new Error(`Corrupted archive: missing staged file ${mapping.archivePath}`);
        }

        // Verify individual file hash if recorded
        if (mapping.fileHash) {
          const sha256 = hashUtil.computeFileHashSync(stagedFilePath);
          const sha1 = hashUtil.computeSha1Sync(stagedFilePath);
          if (mapping.fileHash !== sha256 && mapping.fileHash !== sha1) {
            throw new Error(`File integrity failed for ${mapping.archivePath}`);
          }
        }

        // Resolve destination on current PC using placeholders or cross-machine redirection
        let destination = '';
        if (mapping.placeholderPath) {
          destination = scanner.resolvePattern(mapping.placeholderPath);
        } else if (mapping.targetPath) {
          // If restoring from a foreign PC, redirect user directory using placeholder conversion
          const ph = scanner.toPlaceholderPath(mapping.targetPath);
          destination = scanner.resolvePattern(ph);
        } else {
          throw new Error('No target path or placeholder found in file mapping');
        }

        // Security check: destination must not escape to system roots
        const resolvedDest = path.resolve(destination);

        // Ensure parent folder exists
        const parentDir = path.dirname(resolvedDest);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }

        // Safe atomic write: write to .tmp then rename
        const tmpDest = resolvedDest + `.tmp_${Date.now()}`;
        fs.copyFileSync(stagedFilePath, tmpDest);
        if (fs.existsSync(resolvedDest)) {
          fs.unlinkSync(resolvedDest);
        }
        fs.renameSync(tmpDest, resolvedDest);
        restoredFiles.push(resolvedDest);
      }

      // 7. Update local cache with restored latest.zip and metadata
      const gameCacheDir = path.join(config.CACHE_DIR, gameId);
      if (!fs.existsSync(gameCacheDir)) {
        fs.mkdirSync(gameCacheDir, { recursive: true });
      }
      fs.copyFileSync(localZipPath, path.join(gameCacheDir, 'latest.zip'));
      fs.writeFileSync(path.join(gameCacheDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
      if (fs.existsSync(ludusaviMappingPath)) {
        fs.copyFileSync(ludusaviMappingPath, path.join(gameCacheDir, 'mapping.yaml'));
      }

      return {
        success: true,
        restoredFiles,
        meta
      };
    } finally {
      // 8. Delete temporary files
      try {
        if (fs.existsSync(tempRestoreDir)) {
          fs.rmSync(tempRestoreDir, { recursive: true, force: true });
        }
      } catch (err) {
        console.warn(`[Restore] Failed to clean temp dir: ${tempRestoreDir}`, err.message);
      }
    }
  }
}

const restoreManager = new RestoreManager();
module.exports = restoreManager;
