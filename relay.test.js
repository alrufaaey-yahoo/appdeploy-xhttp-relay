const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { getTargetUrl, handleHealth, relay } = require('./relay');

test('builds target URLs while preserving path and query', () => {
  process.env.TARGET_DOMAIN = 'https://example.com/base';
  assert.equal(getTargetUrl('/hello?x=1').toString(), 'https://example.com/hello?x=1');
});

test('rejects non-http target URLs', () => {
  process.env.TARGET_DOMAIN = 'ftp://example.com';
  assert.throws(() => getTargetUrl('/'), /http/);
});

test('responds to health checks without contacting upstream', () => {
  const response = {
    headersSent: false,
    setHeader(name, value) { this.headers = { ...(this.headers || {}), [name]: value }; },
    end(body) { this.body = body; },
  };
  assert.equal(handleHealth({ url: '/healthz' }, response), true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { status: 'ok' });
});

test('relays a request to the configured upstream', async (t) => {
  const upstream = http.createServer((req, res) => {
    res.setHeader('x-upstream', 'yes');
    res.end(`${req.method} ${req.url}`);
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => upstream.close());

  process.env.TARGET_DOMAIN = `http://127.0.0.1:${upstream.address().port}`;
  const relayServer = http.createServer(relay);
  await new Promise((resolve) => relayServer.listen(0, '127.0.0.1', resolve));
  t.after(() => relayServer.close());

  const response = await fetch(`http://127.0.0.1:${relayServer.address().port}/probe?ok=1`, { method: 'POST' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-upstream'), 'yes');
  assert.equal(await response.text(), 'POST /probe?ok=1');
});
