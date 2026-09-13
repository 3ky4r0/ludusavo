const crypto = require('crypto');
const fs = require('fs');

/**
 * Compute SHA-256 hash of a buffer or string
 * @param {Buffer|string} data
 * @returns {string} hex digest
 */
function computeHash(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Compute SHA-256 hash of a file stream asynchronously
 * @param {string} filePath
 * @returns {Promise<string>} hex digest
 */
function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Synchronous file hash helper for smaller files (SHA-256)
 * @param {string} filePath
 * @returns {string} hex digest
 */
function computeFileHashSync(filePath) {
  const data = fs.readFileSync(filePath);
  return computeHash(data);
}

/**
 * Compute SHA-1 hash of a file stream asynchronously
 * @param {string} filePath
 * @returns {Promise<string>} hex digest
 */
function computeSha1(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Synchronous SHA-1 file hash for Ludusavi mapping.yaml compatibility
 * @param {string} filePath
 * @returns {string} hex digest
 */
function computeSha1Sync(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha1').update(data).digest('hex');
}

module.exports = {
  computeHash,
  computeFileHash,
  computeFileHashSync,
  computeSha1,
  computeSha1Sync
};
