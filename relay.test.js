const test = require('node:test');
const assert = require('node:assert/strict');
const { getTargetUrl, handleHealth, relay, tokenIsValid } = require('./relay');

test('builds only the approved upstream URL while preserving path and query', () => {
  delete process.env.TARGET_DOMAIN;
  assert.equal(getTargetUrl('/hello?x=1').toString(), 'https://vps.thumbayan.com/hello?x=1');
});

test('rejects non-approved target URLs and absolute-form request URLs', () => {
  process.env.TARGET_DOMAIN = 'https://example.com';
  assert.throws(() => getTargetUrl('/'), /vps\.thumbayan\.com/);
  delete process.env.TARGET_DOMAIN;
  assert.throws(() => getTargetUrl('https://attacker.example/'), /origin-form/);
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

test('requires a relay token and validates it in constant time', () => {
  process.env.RELAY_TOKEN = 'test-secret';
  assert.equal(tokenIsValid({ headers: { 'x-relay-token': 'wrong' } }), false);
  assert.equal(tokenIsValid({ headers: { 'x-relay-token': 'test-secret' } }), true);
  delete process.env.RELAY_TOKEN;
});

test('rejects unauthenticated relay requests before contacting upstream', () => {
  const response = {
    headersSent: false,
    setHeader() {},
    end(body) { this.body = body; },
  };
  const request = {
    url: '/',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    on() { return this; },
    pipe() { throw new Error('upstream should not be contacted'); },
  };
  process.env.RELAY_TOKEN = 'test-secret';
  relay(request, response);
  assert.equal(response.statusCode, 401);
  delete process.env.RELAY_TOKEN;
});
