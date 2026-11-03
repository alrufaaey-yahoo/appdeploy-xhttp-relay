const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const net = require('node:net');
const { URL } = require('node:url');

const DEFAULT_TARGET_DOMAIN = 'https://vps.thumbayan.com:443';
const ALLOWED_TARGET_HOST = 'vps.thumbayan.com';
const MAX_BODY_BYTES = 100 * 1024 * 1024;
const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);
const STRIP_HEADERS = new Set([
  'host', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port',
  'x-vercel-id', 'x-vercel-deployment-url', 'x-vercel-sc-host', 'x-relay-token',
]);

function getTargetBaseUrl() {
  const value = process.env.TARGET_DOMAIN || DEFAULT_TARGET_DOMAIN;
  const target = new URL(value.endsWith('/') ? value : `${value}/`);
  if (target.protocol !== 'https:' || target.hostname.toLowerCase() !== ALLOWED_TARGET_HOST) {
    throw new Error(`TARGET_DOMAIN must be https://${ALLOWED_TARGET_HOST}`);
  }
  if (net.isIP(target.hostname)) throw new Error('IP literal targets are not allowed');
  return target;
}

function getTargetUrl(requestUrl) {
  if (!requestUrl || !requestUrl.startsWith('/')) throw new Error('Only origin-form request paths are allowed');
  return new URL(requestUrl, getTargetBaseUrl());
}

function tokenIsValid(req) {
  const expected = process.env.RELAY_TOKEN;
  if (!expected) return process.env.ALLOW_UNAUTHENTICATED_RELAY === 'true';
  const actual = req.headers['x-relay-token'];
  if (typeof actual !== 'string') return false;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function copyRequestHeaders(source, clientAddress) {
  const headers = {};
  for (const [name, value] of Object.entries(source)) {
    const lowerName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerName) || STRIP_HEADERS.has(lowerName)) continue;
    headers[name] = value;
  }
  if (clientAddress) headers['x-forwarded-for'] = clientAddress;
  return headers;
}

function copyResponseHeaders(source) {
  const headers = {};
  for (const [name, value] of Object.entries(source)) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }
  return headers;
}

function sendText(res, statusCode, body) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(body);
}

function handleHealth(req, res) {
  if (req.url === '/healthz' || req.url === '/readyz') {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ status: 'ok' }));
    return true;
  }
  return false;
}

function relay(req, res) {
  if (handleHealth(req, res)) return;
  if (!tokenIsValid(req)) {
    sendText(res, process.env.RELAY_TOKEN ? 401 : 503, process.env.RELAY_TOKEN ? 'Unauthorized' : 'Relay authentication is not configured');
    return;
  }

  const contentLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    sendText(res, 413, 'Payload Too Large');
    return;
  }

  let targetUrl;
  try {
    targetUrl = getTargetUrl(req.url);
  } catch (error) {
    console.error(`Invalid relay request: ${error.message}`);
    sendText(res, 400, 'Invalid relay request');
    return;
  }

  const transport = targetUrl.protocol === 'https:' ? https : http;
  const proxyReq = transport.request(
    targetUrl,
    { method: req.method, headers: copyRequestHeaders(req.headers, req.socket.remoteAddress) },
    (proxyRes) => {
      if (!res.headersSent) res.writeHead(proxyRes.statusCode || 502, copyResponseHeaders(proxyRes.headers));
      proxyRes.pipe(res);
    },
  );

  const timeoutMs = Number(process.env.UPSTREAM_TIMEOUT_MS || 55_000);
  proxyReq.setTimeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 55_000, () => {
    proxyReq.destroy(new Error('Upstream request timed out'));
  });
  proxyReq.on('error', (error) => {
    console.error(`Proxy request error: ${error.message}`);
    if (res.headersSent) res.destroy(error);
    else sendText(res, 502, 'Bad Gateway: Proxy Request Failed');
  });

  let receivedBytes = 0;
  req.on('data', (chunk) => {
    receivedBytes += chunk.length;
    if (receivedBytes > MAX_BODY_BYTES) {
      req.destroy();
      proxyReq.destroy(new Error('Request body too large'));
    }
  });
  req.on('aborted', () => proxyReq.destroy(new Error('Client request aborted')));
  req.pipe(proxyReq);
}

module.exports = { copyRequestHeaders, copyResponseHeaders, getTargetUrl, handleHealth, relay, tokenIsValid };
