const http = require('node:http');
const { relay } = require('./relay');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const server = http.createServer(relay);
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

server.listen(port, host, () => {
  console.log(`XHTTP relay listening on http://${host}:${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close((error) => {
    if (error) {
      console.error('Graceful shutdown failed:', error);
      process.exitCode = 1;
    }
    process.exit();
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
