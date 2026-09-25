/**
 * The HTTP app: Shopify webhooks in, the app-proxy compliance endpoint
 * out. Plain node:http, no framework.
 *
 *   POST /webhooks              products/create, products/update, products/delete (topic from X-Shopify-Topic)
 *   GET  /proxy/compliance      ?variant_id=… behind the App Proxy; answers { label }
 *   GET  /health
 */
import { createServer } from 'node:http';
import { verifyWebhookHmac, verifyProxySignature } from './shopify.js';

const TOPICS = new Set(['products/create', 'products/update', 'products/delete']);

/**
 * @param {{ sync: import('./sync.js').Sync, apiSecret: string, webhookSecret?: string, log?: (line: string) => void }} deps
 *   apiSecret signs the App Proxy; webhookSecret signs the webhooks (the app's API secret for
 *   webhooks made through the API, the shop's notifications secret for ones made in the admin).
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createHandler({ sync, apiSecret, webhookSecret = apiSecret, log = console.log }) {
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
      if (req.method === 'POST' && url.pathname.startsWith('/webhooks')) return webhook(req, res, url);
      if (req.method === 'GET' && url.pathname === '/proxy/compliance') return proxy(req, res, url);
      return json(res, 404, { error: 'not_found' });
    } catch (error) {
      log(`error ${req.method} ${url.pathname}: ${error.stack || error.message}`);
      return json(res, 500, { error: 'internal' });
    }
  };

  async function webhook(req, res, url) {
    const raw = await readBody(req, 5 * 1024 * 1024);
    if (!verifyWebhookHmac(webhookSecret, raw, req.headers['x-shopify-hmac-sha256'])) return json(res, 401, { error: 'bad_hmac' });
    const topic = String(req.headers['x-shopify-topic'] || url.pathname.replace(/^\/webhooks\/?/, ''));
    if (!TOPICS.has(topic)) return json(res, 200, { ignored: topic });
    let payload;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      return json(res, 400, { error: 'bad_json' });
    }
    // Shopify wants the 200 within five seconds; the API calls run after the answer.
    json(res, 200, { received: topic });
    const work = topic === 'products/delete' ? sync.deleted(payload.id) : sync.product(payload);
    await work.catch((error) => log(`${topic} ${payload.id}: ${error.message}`));
  }

  async function proxy(req, res, url) {
    if (!verifyProxySignature(apiSecret, url.searchParams)) return json(res, 403, { error: 'bad_signature' });
    const variantId = url.searchParams.get('variant_id');
    if (!variantId || !/^\d{1,20}$/.test(variantId)) return json(res, 422, { error: 'variant_id' });
    const label = await sync.label(variantId);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return json(res, 200, { label });
  }
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/** The listening server, for bin/server.js and tests. */
export function listen(deps, port, host = '0.0.0.0') {
  const server = createServer(createHandler(deps));
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
