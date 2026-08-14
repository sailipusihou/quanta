'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { parseVersion, isNewer, checkForUpdate } = require('../src/server/update');

test('版本解析与比较', () => {
  assert.deepEqual(parseVersion('0.1.0'), [0, 1, 0]);
  assert.equal(parseVersion('abc'), null);
  assert.equal(isNewer('0.2.0', '0.1.0'), true);
  assert.equal(isNewer('0.1.9', '0.1.10'), false);
  assert.equal(isNewer('1.0.0', '0.9.9'), true);
  assert.equal(isNewer('0.1.0', '0.1.0'), false);
  assert.equal(isNewer('abc', '0.1.0'), false);
});

test('更新检查：无更新源 / 有新版本 / 已是最新', async () => {
  assert.equal((await checkForUpdate({ feedUrl: '', currentVersion: '0.1.0' })).status, 'no-feed');

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ version: '0.2.0', url: 'https://example.com/download' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const newer = await checkForUpdate({ feedUrl: base + '/latest.json', currentVersion: '0.1.0' });
  assert.equal(newer.status, 'update-available');
  assert.equal(newer.version, '0.2.0');
  assert.equal(newer.url, 'https://example.com/download');

  const current = await checkForUpdate({ feedUrl: base + '/latest.json', currentVersion: '0.2.0' });
  assert.equal(current.status, 'up-to-date');

  server.close();
});
