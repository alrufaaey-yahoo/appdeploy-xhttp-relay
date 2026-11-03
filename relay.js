const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const STRIP_HEADERS = new Set([
  'host',
  'forwarded',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-vercel-id',
  'x-vercel-deployment-url',
  'x-vercel-sc-host',
]);

function getTargetBaseUrl() {
  const value = process.env.TARGET_DOMAIN;
  if (!value) throw new Error('TARGET_DOMAIN is not configured');
  const target = new URL(value.endsWith('/') ? value : `${value}/`);
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error('TARGET_DOMAIN must use http:// or https://');
  }
  return target;
}

function getTargetUrl(requestUrl) {
  return new URL(requestUrl || '/', getTargetBaseUrl());
}

function copyRequestHeaders(source) {
  const headers = {};
  let clientIp;
  for (const [name, value] of Object.entries(source)) {
    const lowerName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerName) || STRIP_HEADERS.has(lowerName)) continue;
    if (lowerName === 'x-real-ip' || lowerName === 'x-forwarded-for') {
      clientIp ||= Array.isArray(value) ? value[0] : value;
      continue;
    }
    headers[name] = value;
  }
  if (clientIp) headers['x-forwarded-for'] = clientIp;
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

  let targetUrl;
  try {
    targetUrl = getTargetUrl(req.url);
  } catch (error) {
    console.error(`Invalid TARGET_DOMAIN: ${error.message}`);
    sendText(res, 500, 'Misconfigured: TARGET_DOMAIN must be a valid HTTP(S) URL');
    return;
  }

  const transport = targetUrl.protocol === 'https:' ? https : http;
  const proxyReq = transport.request(
    targetUrl,
    { method: req.method, headers: copyRequestHeaders(req.headers) },
    (proxyRes) => {
      if (!res.headersSent) {
        res.writeHead(proxyRes.statusCode || 502, copyResponseHeaders(proxyRes.headers));
      }
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
  req.on('aborted', () => proxyReq.destroy(new Error('Client request aborted')));
  req.pipe(proxyReq);
}

module.exports = { copyRequestHeaders, copyResponseHeaders, getTargetUrl, handleHealth, relay };
