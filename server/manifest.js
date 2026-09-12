const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const config = require('./config');

const OFFICIAL_MANIFEST_URL = 'https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/master/data/manifest.yaml';

class ManifestManager {
  constructor() {
    this.games = new Map(); // id -> game object
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
        this.games.clear();
        for (const g of cachedGames) {
          this.games.set(g.id, g);
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
    this.games.clear();
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

      this.games.set(slug, gameObj);
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
