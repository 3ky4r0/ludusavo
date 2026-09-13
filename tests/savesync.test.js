const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const config = require('../server/config');
const manifest = require('../server/manifest');
const scanner = require('../server/scanner');
const backupManager = require('../server/backup');
const restoreManager = require('../server/restore');
const hashUtil = require('../server/hash');
const syncManager = require('../server/sync');

test('Step 2 & 3: Manifest loader and parser', async () => {
  const games = await manifest.loadManifest();
  assert.ok(games.length > 0, 'Manifest should load games');
  
  const eldenRing = manifest.getGame('elden-ring');
  assert.ok(eldenRing, 'Elden ring should be in manifest');
  assert.strictEqual(eldenRing.name, 'Elden Ring');
  assert.ok(Array.isArray(eldenRing.savePaths), 'savePaths should be array');
});

test('Step 4: Scanner placeholder resolution', () => {
  const pattern = '<home>/Saved Games/TestGame/*';
  const resolved = scanner.resolvePattern(pattern);
  assert.ok(!resolved.includes('<home>'), 'Resolved path should replace placeholder');
  assert.ok(resolved.includes(os.homedir()), 'Resolved path should contain user home');

  const placeholderRoundtrip = scanner.toPlaceholderPath(resolved);
  assert.ok(placeholderRoundtrip.startsWith('<home>'), 'Placeholder conversion should convert back to <home>');
});

test('Step 5 & 6: Backup creation and SHA-256 calculation', async () => {
  const testGame = {
    id: 'test-backup-game',
    name: 'Test Backup Game',
    savePaths: [{ path: '<home>/Saved Games/TestBackupGame/*' }]
  };
  const testDir = path.join(os.homedir(), 'Saved Games', 'TestBackupGame');
  fs.mkdirSync(testDir, { recursive: true });
  const testFile = path.join(testDir, 'save_test.bin');
  fs.writeFileSync(testFile, 'BINARY_SAVE_PAYLOAD_TEST_12345');

  try {
    const backupRes = await backupManager.createBackup(testGame);
    assert.ok(fs.existsSync(backupRes.zipPath), 'latest.zip should exist');
    assert.ok(fs.existsSync(backupRes.metaPath), 'meta.json should exist');
    assert.ok(fs.existsSync(backupRes.mappingPath), 'mapping.yaml should exist in cache');
    assert.ok(backupRes.meta.sha256, 'SHA-256 hash must be computed');
    assert.strictEqual(backupRes.meta.sha256.length, 64, 'SHA-256 hex string length should be 64');

    // Verify Ludusavi ZIP structure
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(backupRes.zipPath);
    const entryNames = zip.getEntries().map(e => e.entryName);
    assert.ok(entryNames.includes('mapping.yaml'), 'Archive must contain root mapping.yaml (Ludusavi standard)');
    assert.ok(entryNames.some(e => e.startsWith('drive-')), 'Archive must contain drive- hierarchy (Ludusavi standard)');

    const manualHash = await hashUtil.computeFileHash(backupRes.zipPath);
    assert.strictEqual(backupRes.meta.sha256, manualHash, 'Calculated hash must match file hash');
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});

test('Step 9: Safe Restore and Integrity Verification', async () => {
  const testGame = {
    id: 'test-restore-game',
    name: 'Test Restore Game',
    savePaths: [{ path: '<home>/Saved Games/TestRestoreGame/*' }]
  };
  const testDir = path.join(os.homedir(), 'Saved Games', 'TestRestoreGame');
  fs.mkdirSync(testDir, { recursive: true });
  const testFile = path.join(testDir, 'save_restore_test.bin');
  const expectedContent = 'VERIFY_RESTORE_INTEGRITY_DATA_ABC';
  fs.writeFileSync(testFile, expectedContent);

  try {
    const backupRes = await backupManager.createBackup(testGame);

    // Delete local save
    fs.unlinkSync(testFile);
    assert.ok(!fs.existsSync(testFile), 'Save file should be deleted');

    // Restore save
    const restoreRes = await restoreManager.restoreBackup(testGame.id, backupRes.zipPath, backupRes.meta.sha256);
    assert.ok(restoreRes.success, 'Restore should succeed');
    assert.ok(fs.existsSync(testFile), 'Save file should be restored');

    const restoredContent = fs.readFileSync(testFile, 'utf8');
    assert.strictEqual(restoredContent, expectedContent, 'Restored content should match original');

    // Test hash mismatch rejection
    await assert.rejects(
      async () => {
        await restoreManager.restoreBackup(testGame.id, backupRes.zipPath, '0000000000000000000000000000000000000000000000000000000000000000');
      },
      /SHA-256 integrity verification failed/,
      'Should reject corrupted archive when hash does not match'
    );
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});

test('Step 10 & 11: Conflict Detection State Evaluation', async () => {
  const mockGame = {
    id: 'mock-conflict-game',
    name: 'Mock Conflict Game',
    savePaths: [{ path: '<home>/Saved Games/MockGame/*' }]
  };

  // When save does not exist locally and no remote exists
  const notFoundStatus = await syncManager.getGameSyncStatus(mockGame);
  assert.strictEqual(notFoundStatus.state, syncManager.SYNC_STATES.NOT_FOUND);

  // When save exists locally but no remote exists
  const testDir = path.join(os.homedir(), 'Saved Games', 'MockGame');
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(path.join(testDir, 'save.dat'), 'MOCK_DATA');

  try {
    const localOnlyStatus = await syncManager.getGameSyncStatus(mockGame);
    assert.strictEqual(localOnlyStatus.state, syncManager.SYNC_STATES.LOCAL_ONLY);
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});

test('Performance Optimization: Async SHA-1 and Batch sync status', async () => {
  const tmpFile = path.join(os.tmpdir(), `test_perf_${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, 'HELLO_PERFORMANCE_TEST_SHA1');

  try {
    const asyncSha1 = await hashUtil.computeSha1(tmpFile);
    const syncSha1 = hashUtil.computeSha1Sync(tmpFile);
    assert.strictEqual(asyncSha1, syncSha1, 'Async and sync SHA-1 must match exactly');

    // Test batch sync status
    const mockGame1 = { id: 'mock-g1', name: 'Mock G1', savePaths: [] };
    const mockGame2 = { id: 'mock-g2', name: 'Mock G2', savePaths: [] };
    const batchRes = await syncManager.getAllGamesSyncStatus([mockGame1, mockGame2]);
    assert.ok(batchRes['mock-g1'], 'Batch status should include mock-g1');
    assert.ok(batchRes['mock-g2'], 'Batch status should include mock-g2');
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});
