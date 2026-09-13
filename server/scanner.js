const fs = require('fs');
const path = require('path');
const os = require('os');

class Scanner {
  constructor() {
    this.directoryPlaceholders = this.getDirectoryPlaceholders();
    this.knownRoots = this.getKnownRoots();
  }

  getDirectoryPlaceholders() {
    const home = os.homedir();
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const localAppDataLow = path.join(home, 'AppData', 'LocalLow');
    const winDocuments = path.join(home, 'Documents');
    const programData = process.env.ProgramData || 'C:\\ProgramData';
    const winDir = process.env.SystemRoot || 'C:\\Windows';
    const winPublic = process.env.PUBLIC || 'C:\\Users\\Public';
    let userName = process.env.USERNAME || '';
    if (!userName) {
      try { userName = os.userInfo().username || ''; } catch { /* ignore */ }
    }

    return {
      '<home>': home,
      '<winDocuments>': winDocuments,
      '<documents>': winDocuments,
      '<appdata>': appData,
      '<winAppData>': appData,
      '<localappdata>': localAppData,
      '<winLocalAppData>': localAppData,
      '<localappdataLow>': localAppDataLow,
      '<winLocalAppDataLow>': localAppDataLow,
      '<winProgramData>': programData,
      '<winDir>': winDir,
      '<winPublic>': winPublic,
      '<osUserName>': userName,
      '<xdgConfig>': appData,
      '<xdgData>': localAppData
    };
  }

  getKnownRoots() {
    const roots = [];
    const home = os.homedir();
    const driveRoot = path.parse(home).root || 'C:\\';

    // Steam roots
    const steamPaths = [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
      'D:\\Steam',
      'E:\\Steam'
    ];
    for (const sp of steamPaths) {
      if (fs.existsSync(sp)) {
        roots.push(sp);
      }
    }

    roots.push(driveRoot);
    return roots;
  }

  // Resolve placeholders into candidate paths or patterns
  resolvePatterns(rawPath) {
    let candidates = [rawPath];

    // 1. Expand <root> placeholder
    if (rawPath.includes('<root>')) {
      const nextCandidates = [];
      for (const cand of candidates) {
        for (const rootPath of this.knownRoots) {
          nextCandidates.push(cand.split('<root>').join(rootPath));
        }
      }
      candidates = nextCandidates;
    }

    // 2. Expand directory placeholders
    candidates = candidates.map(pattern => {
      let resolved = pattern;
      for (const [placeholder, actual] of Object.entries(this.directoryPlaceholders)) {
        if (resolved.includes(placeholder)) {
          resolved = resolved.split(placeholder).join(actual);
        }
      }
      // 3. Expand <storeUserId> to wildcard '*'
      if (resolved.includes('<storeUserId>')) {
        resolved = resolved.split('<storeUserId>').join('*');
      }
      return path.normalize(resolved);
    });

    return Array.from(new Set(candidates));
  }

  // Resolve a single pattern (compatibility helper)
  resolvePattern(rawPath) {
    const list = this.resolvePatterns(rawPath);
    return list[0] || path.normalize(rawPath);
  }

  // Convert an absolute path into a placeholder path for portable storage
  toPlaceholderPath(absolutePath) {
    const normalized = path.normalize(absolutePath);
    // Sort directory placeholders by longest value first
    const sorted = Object.entries(this.directoryPlaceholders)
      .filter(([_, val]) => Boolean(val))
      .sort((a, b) => b[1].length - a[1].length);

    for (const [placeholder, actual] of sorted) {
      if (normalized.toLowerCase().startsWith(path.normalize(actual).toLowerCase())) {
        const sub = normalized.slice(actual.length);
        const cleanSub = sub.startsWith(path.sep) ? sub.slice(1) : sub;
        return `${placeholder}/${cleanSub.split(path.sep).join('/')}`;
      }
    }
    return normalized.split(path.sep).join('/');
  }

  // Find files matching a pattern with optional wildcards
  findFiles(pattern) {
    const results = [];
    const normalizedPattern = path.normalize(pattern);

    // Split pattern into base existing directory and glob rest
    const parts = normalizedPattern.split(path.sep);
    let baseIndex = 0;
    while (baseIndex < parts.length && !parts[baseIndex].includes('*') && !parts[baseIndex].includes('?')) {
      baseIndex++;
    }

    const baseDir = parts.slice(0, baseIndex).join(path.sep) || (path.isAbsolute(normalizedPattern) ? path.parse(normalizedPattern).root : '.');
    const globRemainder = parts.slice(baseIndex);

    if (!fs.existsSync(baseDir)) {
      return results;
    }

    const traverse = (currentDir, remainderIndex) => {
      if (!fs.existsSync(currentDir)) return;

      let stat;
      try {
        stat = fs.statSync(currentDir);
      } catch {
        return;
      }

      if (remainderIndex >= globRemainder.length) {
        if (stat.isFile()) {
          results.push(currentDir);
        } else if (stat.isDirectory()) {
          this.getAllFilesInDir(currentDir, results);
        }
        return;
      }

      const segment = globRemainder[remainderIndex];
      const isWildcard = segment.includes('*') || segment.includes('?');

      if (!stat.isDirectory()) return;

      let entries = [];
      try {
        entries = fs.readdirSync(currentDir);
      } catch {
        return;
      }

      if (segment === '**') {
        traverse(currentDir, remainderIndex + 1);
        for (const entry of entries) {
          const nextPath = path.join(currentDir, entry);
          traverse(nextPath, remainderIndex);
        }
      } else if (isWildcard) {
        const regexStr = '^' + segment.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
        const regex = new RegExp(regexStr, 'i');
        for (const entry of entries) {
          if (regex.test(entry)) {
            const nextPath = path.join(currentDir, entry);
            traverse(nextPath, remainderIndex + 1);
          }
        }
      } else {
        const nextPath = path.join(currentDir, segment);
        if (fs.existsSync(nextPath)) {
          traverse(nextPath, remainderIndex + 1);
        }
      }
    };

    traverse(baseDir, 0);
    return Array.from(new Set(results));
  }

  getAllFilesInDir(dir, results) {
    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const full = path.join(dir, item);
        try {
          const s = fs.statSync(full);
          if (s.isDirectory()) {
            this.getAllFilesInDir(full, results);
          } else if (s.isFile()) {
            results.push(full);
          }
        } catch {
          // ignore inaccessible
        }
      }
    } catch {
      // ignore
    }
  }

  // Check if Ludusavi GUI created a backup folder for this game in ~/ludusavi-backup
  findLudusaviGuiBackup(gameName) {
    const defaultLudusaviBackupDir = path.join(os.homedir(), 'ludusavi-backup');
    if (!fs.existsSync(defaultLudusaviBackupDir)) {
      return null;
    }

    try {
      const items = fs.readdirSync(defaultLudusaviBackupDir);
      // Look for matching game folder (Ludusavi escapes colons to underscores: e.g. "Sekiro_ Shadows Die Twice")
      const safeName = gameName.replace(/[:]/g, '_').toLowerCase();
      for (const item of items) {
        if (item.toLowerCase() === safeName || item.toLowerCase().replace(/[^a-z0-9]/g, '') === gameName.toLowerCase().replace(/[^a-z0-9]/g, '')) {
          const mappingPath = path.join(defaultLudusaviBackupDir, item, 'mapping.yaml');
          if (fs.existsSync(mappingPath)) {
            return {
              folderName: item,
              mappingPath: mappingPath,
              backupDir: path.join(defaultLudusaviBackupDir, item)
            };
          }
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  // Scan a game from manifest
  scanGame(game) {
    if (!game) return null;

    const matchedFiles = [];
    const currentPlatform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';

    for (const item of (game.savePaths || [])) {
      // Check platform constraint if specified
      if (item.when && Array.isArray(item.when)) {
        const matchOS = item.when.some(w => !w.os || w.os.toLowerCase() === currentPlatform);
        if (!matchOS) continue;
      }

      const patterns = this.resolvePatterns(item.path);
      for (const pattern of patterns) {
        const files = this.findFiles(pattern);
        for (const f of files) {
          matchedFiles.push(f);
        }
      }
    }

    const uniqueFiles = Array.from(new Set(matchedFiles));
    let totalSize = 0;
    let latestMtime = 0;
    const fileDetails = [];

    const IGNORED_CONFIGS = new Set(['graphicsconfig.xml', 'remotecache.vdf']);

    for (const filePath of uniqueFiles) {
      const baseName = path.basename(filePath).toLowerCase();
      if (IGNORED_CONFIGS.has(baseName)) {
        continue;
      }
      try {
        const stat = fs.statSync(filePath);
        totalSize += stat.size;
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
        }
        fileDetails.push({
          absolutePath: filePath,
          placeholderPath: this.toPlaceholderPath(filePath),
          size: stat.size,
          mtime: stat.mtimeMs
        });
      } catch {
        // file unreadable or deleted
      }
    }

    const saveFound = fileDetails.length > 0;
    const ludusaviGuiBackup = this.findLudusaviGuiBackup(game.name);

    return {
      id: game.id,
      name: game.name,
      installed: saveFound,
      saveFound: saveFound,
      fileCount: fileDetails.length,
      totalSize: totalSize,
      lastModified: latestMtime > 0 ? new Date(latestMtime).toISOString() : null,
      files: fileDetails,
      ludusaviBackup: ludusaviGuiBackup
    };
  }

  // Scan all games in manifest
  scanAll(games) {
    const results = [];
    for (const game of games) {
      results.push(this.scanGame(game));
    }
    return results;
  }

  // Get detected games using cache for instant response, re-scanning when requested
  getDetectedGames(allGames, forceRescan = false) {
    const config = require('./config');
    const detectedCachePath = path.join(config.CACHE_DIR, 'detected_games.json');

    if (!forceRescan && fs.existsSync(detectedCachePath)) {
      try {
        const cachedIds = JSON.parse(fs.readFileSync(detectedCachePath, 'utf8'));
        const idSet = new Set(cachedIds);
        const targetGames = allGames.filter(g => idSet.has(g.id));
        const results = [];
        for (const game of targetGames) {
          const scan = this.scanGame(game);
          if (scan && scan.saveFound) {
            results.push(scan);
          }
        }
        if (results.length > 0) {
          return results;
        }
      } catch (err) {
        console.warn('[Scanner] Detected games cache read error, rescanning:', err.message);
      }
    }

    // Full scan across manifest
    const detected = [];
    const detectedIds = [];

    for (const game of allGames) {
      const scan = this.scanGame(game);
      if (scan && scan.saveFound) {
        detected.push(scan);
        detectedIds.push(game.id);
      }
    }

    try {
      if (!fs.existsSync(config.CACHE_DIR)) {
        fs.mkdirSync(config.CACHE_DIR, { recursive: true });
      }
      fs.writeFileSync(detectedCachePath, JSON.stringify(detectedIds, null, 2), 'utf8');
      console.log(`[Scanner] Cached ${detectedIds.length} detected games to ${detectedCachePath}.`);
    } catch (err) {
      console.warn('[Scanner] Failed to write detected games cache:', err.message);
    }

    return detected;
  }
}

const scanner = new Scanner();
module.exports = scanner;
