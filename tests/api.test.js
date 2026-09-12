const test = require('node:test');
const assert = require('node:assert');
const app = require('../server/index');

test('REST API: GET /api/status', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://localhost:${port}/api/status`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.app, 'SaveSync');
    assert.strictEqual(typeof data.github.configured, 'boolean');
    assert.strictEqual(data.manifest.loaded, true);
  } finally {
    server.close();
  }
});

test('REST API: GET /api/games', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://localhost:${port}/api/games`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.games));
    assert.ok(data.games.length > 0);
  } finally {
    server.close();
  }
});

test('REST API: GET /api/games/:id for valid and invalid id', async () => {
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // Valid game
    const validRes = await fetch(`http://localhost:${port}/api/games/elden-ring`);
    assert.strictEqual(validRes.status, 200);
    const validData = await validRes.json();
    assert.strictEqual(validData.success, true);
    assert.strictEqual(validData.game.id, 'elden-ring');

    // Invalid game
    const invalidRes = await fetch(`http://localhost:${port}/api/games/non-existent-game-slug-9999`);
    assert.strictEqual(invalidRes.status, 404);
  } finally {
    server.close();
  }
});
