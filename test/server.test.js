import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listen } from '../src/server.js';
import { Sync } from '../src/sync.js';
import { ProductState } from '../src/state.js';
import { TtlCache } from '../src/cache.js';
import { signWebhook, signProxy } from '../src/shopify.js';

/** A stand-in for the API that records every call. */
class FakePc {
  constructor() {
    this.calls = [];
    this.compliance = { data: { anchor_display: { required: true, label: 'Cijena na dan 10. 9. 2026.: 20,00 €' } } };
  }
  async upsertItem(id, data) { this.calls.push(['item', id, data]); return { data: { offer_id: `o-${id}` }, _status: 201 }; }
  async recordPriceByExternal(id, event) { this.calls.push(['price', id, event]); return { _status: 201 }; }
  async complianceByExternal(id, scope) { this.calls.push(['compliance', id, scope]); return this.compliance; }
  async bulkItems(items) { this.calls.push(['bulkItems', items.length]); return { data: items.map((i) => ({ external_id: i.external_id, status: 'created', data: { offer_id: `o-${i.external_id}` } })) }; }
  async bulkPrices(events) { this.calls.push(['bulkPrices', events]); return { summary: { created: events.length, errors: 0 } }; }
}

const config = { merchantId: 'm1', channelCode: 'WEB', currency: 'EUR' };
const secret = 'shpss_secret';

function build() {
  const pc = new FakePc();
  const sync = new Sync({ pc, state: new ProductState(null), cache: new TtlCache(6 * 3600 * 1000), config, log: () => {} });
  return { pc, sync };
}

async function start() {
  const { pc, sync } = build();
  const server = await listen({ sync, apiSecret: secret, log: () => {} }, 0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.address().port}`;
  return { pc, sync, server, base };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

test('a signed products/update sends every variant and its price, a forged one is refused', async () => {
  const { pc, server, base } = await start();
  try {
    const body = JSON.stringify({ id: 7001, title: 'Majica', status: 'active', variants: [{ id: 41001, title: 'S', price: '20.00', compare_at_price: '25.00', updated_at: 'u' }] });
    const forged = await fetch(`${base}/webhooks`, { method: 'POST', body, headers: { 'X-Shopify-Topic': 'products/update', 'X-Shopify-Hmac-Sha256': signWebhook('other', body) } });
    assert.equal(forged.status, 401);
    assert.equal(pc.calls.length, 0);

    const ok = await fetch(`${base}/webhooks`, { method: 'POST', body, headers: { 'X-Shopify-Topic': 'products/update', 'X-Shopify-Hmac-Sha256': signWebhook(secret, body) } });
    assert.equal(ok.status, 200);
    await settle();
    assert.deepEqual(pc.calls.map((c) => c.slice(0, 2)), [['item', '41001'], ['price', '41001']]);
    assert.equal(pc.calls[0][2].name, 'Majica – S');
    assert.equal(pc.calls[1][2].regular_price_minor, 2500);
    assert.equal(pc.calls[1][2].effective_price_minor, 2000);

    const other = await fetch(`${base}/webhooks`, { method: 'POST', body, headers: { 'X-Shopify-Topic': 'orders/create', 'X-Shopify-Hmac-Sha256': signWebhook(secret, body) } });
    assert.deepEqual(await other.json(), { ignored: 'orders/create' });
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('a dropped variant and a deleted product are deactivated from what was remembered', async () => {
  const { pc, sync } = build();
  await sync.product({ id: 7001, title: 'Majica', variants: [{ id: 1, title: 'S', price: '1' }, { id: 2, title: 'L', price: '1' }] });
  pc.calls.length = 0;
  await sync.product({ id: 7001, title: 'Majica', variants: [{ id: 1, title: 'S', price: '1' }] });
  const deactivated = pc.calls.filter((c) => c[0] === 'item' && c[2].active === false);
  assert.equal(deactivated.length, 1);
  assert.equal(deactivated[0][1], '2');
  assert.equal(deactivated[0][2].name, 'Majica – L');
  pc.calls.length = 0;
  assert.equal(await sync.deleted(7001), 1);
  assert.deepEqual(pc.calls.map((c) => [c[0], c[1], c[2].active]), [['item', '1', false]]);
  assert.equal(await sync.deleted(7001), 0);
});

test('the proxy endpoint needs the Shopify signature and caches the label six hours', async () => {
  const { pc, server, base } = await start();
  try {
    const query = { shop: 'demo.myshopify.com', path_prefix: '/apps/uskladjenost', timestamp: '1700000000', variant_id: '41001' };
    const unsigned = await fetch(`${base}/proxy/compliance?${new URLSearchParams(query)}`);
    assert.equal(unsigned.status, 403);

    const signed = new URLSearchParams({ ...query, signature: signProxy(secret, query) });
    const first = await fetch(`${base}/proxy/compliance?${signed}`);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { label: 'Cijena na dan 10. 9. 2026.: 20,00 €' });
    assert.deepEqual(pc.calls, [['compliance', '41001', { channel_code: 'WEB', locale: 'hr' }]]);

    pc.compliance = { data: { anchor_display: { required: false } } };
    const second = await fetch(`${base}/proxy/compliance?${signed}`);
    assert.deepEqual(await second.json(), { label: 'Cijena na dan 10. 9. 2026.: 20,00 €' });
    assert.equal(pc.calls.length, 1);

    const bad = { ...query, variant_id: 'abc' };
    const badId = await fetch(`${base}/proxy/compliance?${new URLSearchParams({ ...bad, signature: signProxy(secret, bad) })}`);
    assert.equal(badId.status, 422);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('the full sync batches items and sends prices with the answered offer ids', async () => {
  const { pc, sync } = build();
  async function* products() {
    yield { id: 1, title: 'A', variants: [{ id: 11, title: 'Default Title', price: '10.00' }, { id: 12, title: 'X', price: '' }] };
    yield { id: 2, title: 'B', variants: [{ id: 21, title: 'Default Title', price: '5.00', compare_at_price: '8.00' }] };
  }
  const summary = await sync.all(products());
  assert.deepEqual(summary, { products: 2, items: 3, prices: 2, errors: 0 });
  assert.deepEqual(pc.calls[0], ['bulkItems', 3]);
  const events = pc.calls[1][1];
  assert.deepEqual(events.map((e) => [e.offer_id, e.regular_price_minor, e.effective_price_minor]), [['o-11', 1000, 1000], ['o-21', 800, 500]]);
  assert.equal('channel_code' in events[0], false);
  assert.deepEqual(sync.state.variants(1), { 11: 'A', 12: 'A – X' });
});
