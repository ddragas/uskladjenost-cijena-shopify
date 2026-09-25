import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWebhookHmac, signWebhook, verifyProxySignature, signProxy, nextPageInfo, toParams } from '../src/shopify.js';

test('a webhook verifies with the right secret and body, and with nothing else', () => {
  const body = Buffer.from('{"id":7001,"title":"Majica"}');
  const header = signWebhook('shpss_secret', body);
  assert.equal(header, createHmac('sha256', 'shpss_secret').update(body).digest('base64'));
  assert.equal(verifyWebhookHmac('shpss_secret', body, header), true);
  assert.equal(verifyWebhookHmac('shpss_secret', body.toString('utf8'), header), true);
  assert.equal(verifyWebhookHmac('shpss_other', body, header), false);
  assert.equal(verifyWebhookHmac('shpss_secret', Buffer.from('{"id":7001,"title":"Majica"} '), header), false);
  assert.equal(verifyWebhookHmac('shpss_secret', body, undefined), false);
  assert.equal(verifyWebhookHmac('shpss_secret', body, ''), false);
  assert.equal(verifyWebhookHmac('shpss_secret', body, 'not base64!'), false);
  assert.equal(verifyWebhookHmac('', body, header), false);
});

test('the app proxy signature is the sorted key=value string with no separator', () => {
  const query = { shop: 'demo.myshopify.com', path_prefix: '/apps/uskladjenost', timestamp: '1700000000', variant_id: '41001' };
  const expected = createHmac('sha256', 'shpss_secret').update('path_prefix=/apps/uskladjenostshop=demo.myshopify.comtimestamp=1700000000variant_id=41001').digest('hex');
  assert.equal(signProxy('shpss_secret', query), expected);
  assert.equal(verifyProxySignature('shpss_secret', { ...query, signature: expected }), true);
  assert.equal(verifyProxySignature('shpss_other', { ...query, signature: expected }), false);
  assert.equal(verifyProxySignature('shpss_secret', { ...query, variant_id: '41002', signature: expected }), false);
  assert.equal(verifyProxySignature('shpss_secret', query), false);
  assert.equal(verifyProxySignature('shpss_secret', { ...query, signature: 'zz' }), false);

  const params = new URLSearchParams({ ...query, signature: expected });
  assert.equal(verifyProxySignature('shpss_secret', params), true);
});

test('a repeated query key is joined by a comma before signing', () => {
  const params = new URLSearchParams('a=1&a=2&b=x&shop=demo.myshopify.com');
  assert.deepEqual(toParams(params), { a: ['1', '2'], b: 'x', shop: 'demo.myshopify.com' });
  const expected = createHmac('sha256', 's').update('a=1,2b=xshop=demo.myshopify.com').digest('hex');
  assert.equal(signProxy('s', params), expected);
  params.set('signature', expected);
  assert.equal(verifyProxySignature('s', params), true);
});

test('the Link header yields the next page_info and nothing on the last page', () => {
  const link = '<https://demo.myshopify.com/admin/api/2024-10/products.json?limit=250&page_info=abc>; rel="previous", <https://demo.myshopify.com/admin/api/2024-10/products.json?limit=250&page_info=def>; rel="next"';
  assert.equal(nextPageInfo(link), 'def');
  assert.equal(nextPageInfo('<https://x/products.json?page_info=abc>; rel="previous"'), null);
  assert.equal(nextPageInfo(''), null);
});
