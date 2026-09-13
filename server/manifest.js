const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const config = require('./config');

const OFFICIAL_MANIFEST_URL = 'https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/master/data/manifest.yaml';

class ManifestManager {
  constructor() {
    this.games = new Map(); // id -> game object
    this.steamIdMap = new Map(); // steamId (string) -> game object
    this.nameMap = new Map(); // cleanName -> game object
    this.normNameMap = new Map(); // normalized name without edition suffixes -> game object
    this.tokenIndex = new Map(); // token keyword -> array of game objects
    this.lastLoaded = null;
    this.isLoaded = false;
    this.processedCachePath = path.join(config.CACHE_DIR, 'manifest_processed.json');
  }

  // Convert name to slug id
  slugify(name) {
    return name
      .toLowerCase()
      .trim()
      .replace(/['":]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  // Clean edition suffixes, trademarks and punctuation for robust matching
  cleanGameTitle(raw) {
    if (!raw) return '';
    return raw
      .toLowerCase()
      .replace(/\b(game of the year edition|goty edition|goty|definitive edition|enhanced edition|special edition|collector's edition|deluxe edition|digital deluxe edition|ultimate edition|gold edition|complete edition|anniversary edition|director's cut|remastered|remake)\b/gi, '')
      .replace(/[®™©]/g, '')
      .replace(/[:\-–—_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Tokenize game title into meaningful search keywords
  getTokens(str) {
    const stopWords = new Set(['the', 'a', 'an', 'of', 'in', 'and', 'for', 'to', 'on', 'at', 'is', 'by']);
    return this.cleanGameTitle(str)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(t => t.length > 1 && !stopWords.has(t));
  }

  // Calculate similarity between target and candidate
  computeSimilarity(target, candidate) {
    const tClean = target.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cClean = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (tClean === cClean) return 1.0;

    const tTokens = this.getTokens(target);
    const cTokens = this.getTokens(candidate);
    if (tTokens.length === 0 || cTokens.length === 0) return 0;

    const tSet = new Set(tTokens);
    const cSet = new Set(cTokens);
    let common = 0;
    for (const t of tSet) {
      if (cSet.has(t)) common++;
    }

    const dice = (2.0 * common) / (tSet.size + cSet.size);

    // Bonus for strong prefix match with close lengths
    const minLen = Math.min(tClean.length, cClean.length);
    const maxLen = Math.max(tClean.length, cClean.length);
    if ((tClean.startsWith(cClean) || cClean.startsWith(tClean)) && (minLen / maxLen >= 0.70)) {
      return Math.max(dice, 0.85);
    }

    return dice;
  }

  // Clear all lookup indexes
  _clearIndexes() {
    this.games.clear();
    this.steamIdMap.clear();
    this.nameMap.clear();
    this.normNameMap.clear();
    this.tokenIndex.clear();
  }

  // Index a game for fast O(1) and intelligent token lookup
  _indexGame(g) {
    this.games.set(g.id, g);
    if (g.steamId) {
      this.steamIdMap.set(String(g.steamId), g);
    }
    const clean = g.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean && !this.nameMap.has(clean)) {
      this.nameMap.set(clean, g);
    }
    const norm = this.cleanGameTitle(g.name).replace(/[^a-z0-9]/g, '');
    if (norm && !this.normNameMap.has(norm)) {
      this.normNameMap.set(norm, g);
    }
    const tokens = this.getTokens(g.name);
    for (const t of tokens) {
      if (t.length >= 3) {
        let list = this.tokenIndex.get(t);
        if (!list) {
          list = [];
          this.tokenIndex.set(t, list);
        }
        if (list.length < 50) {
          list.push(g);
        }
      }
    }
  }

  // Load manifest: Prioritizes pre-processed cache for instant load
  async loadManifest() {
    // 1. Check if pre-processed cache exists (either external in data/cache or bundled inside snapshot)
    const bundledCache = path.join(__dirname, '..', 'data', 'cache', 'manifest_processed.json');
    const targetCache = fs.existsSync(this.processedCachePath) ? this.processedCachePath : (fs.existsSync(bundledCache) ? bundledCache : null);

    if (targetCache) {
      try {
        console.log(`[Manifest] Loading from cache: ${targetCache}...`);
        const cachedRaw = fs.readFileSync(targetCache, 'utf8');
        const cachedGames = JSON.parse(cachedRaw);
        this._clearIndexes();
        for (const g of cachedGames) {
          this._indexGame(g);
        }
        this.lastLoaded = new Date();
        this.isLoaded = true;
        console.log(`[Manifest] Successfully loaded ${this.games.size} games from cache.`);

        // If loaded from bundled, also save to external cache so subsequent updates can write to it
        if (targetCache !== this.processedCachePath && !fs.existsSync(this.processedCachePath)) {
          try {
            if (!fs.existsSync(config.CACHE_DIR)) fs.mkdirSync(config.CACHE_DIR, { recursive: true });
            fs.writeFileSync(this.processedCachePath, cachedRaw, 'utf8');
          } catch {}
        }

        return this.getAllGames();
      } catch (err) {
        console.warn(`[Manifest] Cache read error, falling back to raw manifest:`, err.message);
      }
    }

    // 2. Otherwise load from manifest.json or manifest.yaml
    const jsonPath = path.join(config.MANIFEST_DIR, 'manifest.json');
    const yamlPath = path.join(config.MANIFEST_DIR, 'manifest.yaml');

    let parsed = null;

    if (fs.existsSync(jsonPath)) {
      try {
        const rawContent = fs.readFileSync(jsonPath, 'utf8');
        parsed = JSON.parse(rawContent);
      } catch (err) {
        console.warn(`[Manifest] Failed to parse ${jsonPath}, checking for YAML...`, err.message);
      }
    }

    if (!parsed && fs.existsSync(yamlPath)) {
      try {
        const rawContent = fs.readFileSync(yamlPath, 'utf8');
        parsed = YAML.parse(rawContent);
      } catch (err) {
        console.warn(`[Manifest] Failed to parse ${yamlPath}:`, err.message);
      }
    }

    if (!parsed) {
      console.log('[Manifest] No local manifest found in ' + config.MANIFEST_DIR + '. Downloading official manifest...');
      await this.updateFromRemote();
      return this.getAllGames();
    }

    this.parseAndCacheGames(parsed);
    this.lastLoaded = new Date();
    this.isLoaded = true;
    console.log(`[Manifest] Successfully loaded & cached ${this.games.size} games.`);
    return this.getAllGames();
  }

  // Parse raw Ludusavi structure into standardized objects and write cache
  parseAndCacheGames(rawManifest) {
    this._clearIndexes();
    const slugCounts = new Map();
    const gamesList = [];

    for (const [name, data] of Object.entries(rawManifest)) {
      if (!data) continue;

      let baseSlug = this.slugify(name) || 'game';
      let count = slugCounts.get(baseSlug) || 0;
      let slug = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
      slugCounts.set(baseSlug, count + 1);

      // Extract save paths from 'files' mapping (ignoring pure config paths to avoid display crashes)
      const savePaths = [];
      if (data.files && typeof data.files === 'object') {
        for (const [filePath, rule] of Object.entries(data.files)) {
          const tags = (rule && rule.tags) || [];
          // Skip if rule only contains 'config' and not 'save'
          if (tags.includes('config') && !tags.includes('save')) {
            continue;
          }
          savePaths.push({
            path: filePath,
            tags: tags,
            when: rule?.when || null
          });
        }
      }

      const gameObj = {
        id: slug,
        name: name,
        savePaths: savePaths,
        steamId: data.steam?.id || null
      };

      this._indexGame(gameObj);
      gamesList.push(gameObj);
    }

    // Save pre-processed cache to disk for instant next startups
    try {
      if (!fs.existsSync(config.CACHE_DIR)) {
        fs.mkdirSync(config.CACHE_DIR, { recursive: true });
      }
      fs.writeFileSync(this.processedCachePath, JSON.stringify(gamesList), 'utf8');
      console.log(`[Manifest] Saved pre-processed cache (${gamesList.length} games).`);
    } catch (err) {
      console.warn(`[Manifest] Could not write processed cache:`, err.message);
    }
  }

  getAllGames() {
    return Array.from(this.games.values());
  }

  getGame(id) {
    return this.games.get(id) || null;
  }

  /**
   * Search for a game definition across all 53,000 games in the manifest
   * by steamId or game name using high-precision scoring
   */
  findGame(appId, name) {
    // 1. O(1) Steam AppId Match (100% confidence)
    if (appId && this.steamIdMap.has(String(appId))) {
      return this.steamIdMap.get(String(appId));
    }

    if (!name) return null;

    // 2. O(1) Exact Clean Match (e.g. "Persona 5 Royal" -> "persona5royal")
    const clean = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean && this.nameMap.has(clean)) {
      return this.nameMap.get(clean);
    }

    // 3. O(1) Match after stripping edition suffixes (e.g. GOTY, Remastered, Deluxe)
    const norm = this.cleanGameTitle(name).replace(/[^a-z0-9]/g, '');
    if (norm && this.normNameMap.has(norm)) {
      return this.normNameMap.get(norm);
    }

    // 4. O(1) Slug match
    const slug = this.slugify(name);
    if (slug && this.games.has(slug)) {
      return this.games.get(slug);
    }

    // 5. Intelligent Token Match with Scoring (picks the game with highest similarity)
    const targetTokens = this.getTokens(name);
    if (targetTokens.length === 0) return null;

    const candidateSet = new Set();
    for (const t of targetTokens) {
      const list = this.tokenIndex.get(t);
      if (list) {
        for (const g of list) candidateSet.add(g);
      }
    }

    let bestGame = null;
    let bestScore = 0;

    for (const cand of candidateSet) {
      const score = this.computeSimilarity(name, cand.name);
      if (score > bestScore) {
        bestScore = score;
        bestGame = cand;
      }
    }

    // Require strict similarity threshold (>= 0.70)
    if (bestScore >= 0.70) {
      return bestGame;
    }

    return null;
  }

  // Download official manifest from GitHub and update local cache
  async updateFromRemote() {
    console.log(`[Manifest] Fetching latest manifest from ${OFFICIAL_MANIFEST_URL}...`);
    const response = await fetch(OFFICIAL_MANIFEST_URL, {
      headers: { 'User-Agent': 'SaveSync-Agent' }
    });

    if (!response.ok) {
      throw new Error(`Failed to download manifest: HTTP ${response.status} ${response.statusText}`);
    }

    const yamlText = await response.text();
    const parsed = YAML.parse(yamlText);

    // Save raw files in data/manifest
    const jsonPath = path.join(config.MANIFEST_DIR, 'manifest.json');
    fs.writeFileSync(jsonPath, JSON.stringify(parsed), 'utf8');

    const yamlPath = path.join(config.MANIFEST_DIR, 'manifest.yaml');
    fs.writeFileSync(yamlPath, yamlText, 'utf8');

    // Parse and write processed cache
    this.parseAndCacheGames(parsed);
    this.lastLoaded = new Date();
    this.isLoaded = true;

    return {
      success: true,
      gameCount: this.games.size,
      updatedAt: this.lastLoaded.toISOString()
    };
  }
}

const manifestManager = new ManifestManager();
module.exports = manifestManager;
