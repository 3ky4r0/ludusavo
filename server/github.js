const config = require('./config');

class GitHubClient {
  constructor() {
    this.baseUrl = 'https://api.github.com';
    this.cachedDefaultBranch = null;
    this._filesMapCache = null;
    this._filesMapCacheTime = 0;
    this.rateLimit = null;
  }

  updateRateLimitFromHeaders(headers) {
    if (!headers) return;
    const limit = headers.get('x-ratelimit-limit');
    const remaining = headers.get('x-ratelimit-remaining');
    const reset = headers.get('x-ratelimit-reset');
    const used = headers.get('x-ratelimit-used');

    if (limit !== null && remaining !== null) {
      const resetEpoch = reset ? parseInt(reset, 10) : null;
      let resetTime = null;
      let resetMinutes = null;
      if (resetEpoch) {
        resetTime = new Date(resetEpoch * 1000).toISOString();
        resetMinutes = Math.max(0, Math.round((resetEpoch * 1000 - Date.now()) / 60000));
      }

      this.rateLimit = {
        limit: parseInt(limit, 10),
        remaining: parseInt(remaining, 10),
        used: used ? parseInt(used, 10) : (parseInt(limit, 10) - parseInt(remaining, 10)),
        reset: resetEpoch,
        resetTime,
        resetMinutes,
        updatedAt: new Date().toISOString()
      };
    }
  }

  async getRateLimit() {
    if (!config.isGitHubConfigured()) {
      return null;
    }

    try {
      const res = await this.request('https://api.github.com/rate_limit', { method: 'GET' });
      const data = await res.json();
      if (data && data.rate) {
        const resetEpoch = data.rate.reset;
        let resetTime = null;
        let resetMinutes = null;
        if (resetEpoch) {
          resetTime = new Date(resetEpoch * 1000).toISOString();
          resetMinutes = Math.max(0, Math.round((resetEpoch * 1000 - Date.now()) / 60000));
        }
        this.rateLimit = {
          limit: data.rate.limit,
          remaining: data.rate.remaining,
          used: data.rate.used,
          reset: resetEpoch,
          resetTime,
          resetMinutes,
          updatedAt: new Date().toISOString()
        };
      }
    } catch {
      // Silently fall back to cached rateLimit
    }

    return this.rateLimit || null;
  }

  getHeaders() {
    if (!config.GITHUB_TOKEN) {
      throw new Error('GitHub token is not configured in .env');
    }
    return {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${config.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SaveSync-Agent'
    };
  }

  sanitizeError(err) {
    if (!err || !err.message) return err;
    let safeMsg = err.message;
    if (config.GITHUB_TOKEN) {
      safeMsg = safeMsg.split(config.GITHUB_TOKEN).join('***REDACTED_TOKEN***');
    }
    const safeErr = new Error(safeMsg);
    safeErr.status = err.status;
    return safeErr;
  }

  async request(endpoint, options = {}) {
    if (!config.isGitHubConfigured()) {
      const err = new Error('GitHub credentials (GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO) are missing or incomplete');
      err.status = 400;
      throw err;
    }

    const url = endpoint.startsWith('http')
      ? endpoint
      : `${this.baseUrl}/repos/${config.GITHUB_OWNER}/${config.GITHUB_REPO}${endpoint}`;

    const headers = {
      ...this.getHeaders(),
      ...(options.headers || {})
    };

    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers
      });
    } catch (networkErr) {
      throw this.sanitizeError(new Error(`Network error connecting to GitHub: ${networkErr.message}`));
    }

    if (response && response.headers) {
      this.updateRateLimitFromHeaders(response.headers);
    }

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        // ignore
      }

      if (response.status === 401) {
        throw new Error('GitHub authentication failed: Invalid or expired personal access token');
      } else if (response.status === 404) {
        const notFoundErr = new Error(`Resource or repository '${config.GITHUB_OWNER}/${config.GITHUB_REPO}' not found on GitHub (404)`);
        notFoundErr.status = 404;
        throw notFoundErr;
      } else if (response.status === 403) {
        if (response.headers.get('x-ratelimit-remaining') === '0') {
          throw new Error('GitHub API rate limit exceeded. Please try again later.');
        }
        throw new Error(`GitHub permission denied (403): ${errorBody || 'Check token repository permissions'}`);
      } else {
        throw this.sanitizeError(new Error(`GitHub API error (${response.status}): ${errorBody}`));
      }
    }

    return response;
  }

  /**
   * Check repository accessibility and authentication
   */
  async checkRepository() {
    try {
      const res = await this.request('', { method: 'GET' });
      const data = await res.json();
      this.cachedDefaultBranch = data.default_branch || 'main';
      return {
        accessible: true,
        private: data.private,
        fullName: data.full_name,
        defaultBranch: data.default_branch
      };
    } catch (err) {
      return {
        accessible: false,
        error: err.message
      };
    }
  }

  /**
   * Fetch complete repository tree in a single API call
   * @param {string|null} branch Optional branch name
   * @returns {Promise<{tree: Array<{path: string, mode: string, type: string, sha: string, size?: number}>}>}
   */
  async getTree(branch = null) {
    try {
      let branchName = branch || this.cachedDefaultBranch || 'main';
      const res = await this.request(`/git/trees/${encodeURIComponent(branchName)}?recursive=1`, {
        method: 'GET'
      });
      return await res.json();
    } catch (err) {
      if (err.status === 404 || err.status === 409) {
        return { tree: [] };
      }
      throw err;
    }
  }

  /**
   * Get a map of all files in the repository: path -> { path, sha, size }
   * Cached for 15 seconds to avoid redundant tree fetches
   */
  async getRemoteFilesMap(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this._filesMapCache && (now - this._filesMapCacheTime < 15000)) {
      return this._filesMapCache;
    }

    const treeData = await this.getTree();
    const map = new Map();
    if (treeData && Array.isArray(treeData.tree)) {
      for (const item of treeData.tree) {
        if (item.type === 'blob') {
          map.set(item.path, item);
        }
      }
    }
    this._filesMapCache = map;
    this._filesMapCacheTime = now;
    return map;
  }

  /**
   * Invalidate files map cache (e.g. after upload or delete)
   */
  invalidateCache() {
    this._filesMapCache = null;
    this._filesMapCacheTime = 0;
  }

  /**
   * Check if file exists in the repository
   * @param {string} repoPath e.g. "saves/elden-ring/meta.json"
   */
  async fileExists(repoPath) {
    try {
      const cleanPath = repoPath.replace(/^\/+/, '');
      const res = await this.request(`/contents/${encodeURIComponent(cleanPath).replace(/%2F/g, '/')}`, {
        method: 'GET'
      });
      const data = await res.json();
      return {
        exists: true,
        sha: data.sha,
        size: data.size
      };
    } catch (err) {
      if (err.status === 404) {
        return { exists: false, sha: null };
      }
      throw err;
    }
  }

  /**
   * Get file content from repository
   * @param {string} repoPath
   * @returns {Promise<{content: Buffer, sha: string, size: number} | null>}
   */
  async getFile(repoPath) {
    const cleanPath = repoPath.replace(/^\/+/, '');
    try {
      const res = await this.request(`/contents/${encodeURIComponent(cleanPath).replace(/%2F/g, '/')}`, {
        method: 'GET'
      });
      const data = await res.json();

      if (data.content && data.encoding === 'base64') {
        const buf = Buffer.from(data.content, 'base64');
        return {
          content: buf,
          sha: data.sha,
          size: data.size
        };
      } else if (data.download_url) {
        // Large files via download_url
        const downloadRes = await fetch(data.download_url, {
          headers: this.getHeaders()
        });
        if (!downloadRes.ok) {
          throw new Error(`Failed to download raw file from GitHub: ${downloadRes.status}`);
        }
        const arrayBuf = await downloadRes.arrayBuffer();
        return {
          content: Buffer.from(arrayBuf),
          sha: data.sha,
          size: data.size
        };
      }
      return null;
    } catch (err) {
      if (err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Upload a new file to GitHub repository
   */
  async uploadFile(repoPath, contentBuffer, message) {
    const cleanPath = repoPath.replace(/^\/+/, '');
    const url = `/contents/${encodeURIComponent(cleanPath).replace(/%2F/g, '/')}`;
    const base64Content = Buffer.isBuffer(contentBuffer)
      ? contentBuffer.toString('base64')
      : Buffer.from(contentBuffer).toString('base64');

    const res = await this.request(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message || `Upload ${cleanPath}`,
        content: base64Content
      })
    });
    this.invalidateCache();
    return await res.json();
  }

  /**
   * Update an existing file on GitHub repository
   */
  async updateFile(repoPath, contentBuffer, sha, message) {
    const cleanPath = repoPath.replace(/^\/+/, '');
    const url = `/contents/${encodeURIComponent(cleanPath).replace(/%2F/g, '/')}`;
    const base64Content = Buffer.isBuffer(contentBuffer)
      ? contentBuffer.toString('base64')
      : Buffer.from(contentBuffer).toString('base64');

    const res = await this.request(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message || `Update ${cleanPath}`,
        content: base64Content,
        sha: sha
      })
    });
    this.invalidateCache();
    return await res.json();
  }

  /**
   * Upload or update file automatically handling existing sha
   */
  async uploadOrUpdateFile(repoPath, contentBuffer, message) {
    const existInfo = await this.fileExists(repoPath);
    if (existInfo.exists && existInfo.sha) {
      return await this.updateFile(repoPath, contentBuffer, existInfo.sha, message);
    } else {
      return await this.uploadFile(repoPath, contentBuffer, message);
    }
  }

  /**
   * Delete a file from repository
   */
  async deleteFile(repoPath, sha, message) {
    const cleanPath = repoPath.replace(/^\/+/, '');
    const url = `/contents/${encodeURIComponent(cleanPath).replace(/%2F/g, '/')}`;

    const res = await this.request(url, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message || `Delete ${cleanPath}`,
        sha: sha
      })
    });
    this.invalidateCache();
    return await res.json();
  }
}

const gitHubClient = new GitHubClient();
module.exports = gitHubClient;
