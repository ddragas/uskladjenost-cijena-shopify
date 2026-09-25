import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapProduct, item, price, minor, label, itemName, isAvailable } from '../src/mapper.js';

const product = {
  id: 7001,
  title: 'Majica',
  vendor: 'Info Media',
  product_type: 'Odjeća',
  status: 'active',
  variants: [
    { id: 41001, title: 'S / crna', sku: 'MAJ-S-C', barcode: '3859 0000 00001', price: '20.00', compare_at_price: null, inventory_management: 'shopify', inventory_policy: 'deny', inventory_quantity: 3, updated_at: '2026-09-25T10:00:00+02:00' },
    { id: 41002, title: 'L / crna', sku: 'MAJ-L-C', barcode: null, price: '15.90', compare_at_price: '20.00', inventory_management: 'shopify', inventory_policy: 'deny', inventory_quantity: 0, updated_at: '2026-09-25T10:00:00+02:00' },
  ],
};

test('a product with variants becomes one item and one price per variant', () => {
  const rows = mapProduct(product, { merchantId: 'm1', channelCode: 'WEB', currency: 'eur' });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    external_id: '41001',
    item: { merchant_id: 'm1', kind: 'product', name: 'Majica – S / crna', sku: 'MAJ-S-C', barcode: '3859000000001', category: 'Odjeća', brand: 'Info Media', active: true, is_available: true, channel_code: 'WEB', metadata: { shopify_product_id: '7001', shopify_variant_id: '41001' } },
    price: { regular_price_minor: 2000, effective_price_minor: 2000, currency: 'EUR', tax_inclusive: true, special_sale: { active: false }, source_event_id: 'shopify:41001:2000:2000:2026-09-25T10:00:00+02:00', channel_code: 'WEB' },
  });
  assert.equal(rows[1].item.name, 'Majica – L / crna');
  assert.equal(rows[1].item.is_available, false);
  assert.equal('barcode' in rows[1].item, false);
});

test('a compare-at price above the price is a sale; at or below it is not', () => {
  const sale = price({ id: 1, price: '15.90', compare_at_price: '20.00', updated_at: 'u' }, 'EUR', 'WEB');
  assert.equal(sale.regular_price_minor, 2000);
  assert.equal(sale.effective_price_minor, 1590);
  assert.equal(sale.special_sale.active, true);
  assert.equal(sale.source_event_id, 'shopify:1:2000:1590:u');

  const same = price({ id: 1, price: '20.00', compare_at_price: '20.00' });
  assert.equal(same.regular_price_minor, 2000);
  assert.equal(same.effective_price_minor, 2000);
  assert.equal(same.special_sale.active, false);

  const lower = price({ id: 1, price: '20.00', compare_at_price: '10.00' });
  assert.equal(lower.regular_price_minor, 2000);
  assert.equal(lower.special_sale.active, false);

  assert.equal(price({ id: 1, price: '' }), null);
  assert.equal(price({ id: 1, price: 'abc' }), null);
  assert.equal(minor('9.99'), 999);
  assert.equal(minor('12,50'), 1250);
  assert.equal(minor(10), 1000);
  assert.equal(minor('0.005'), 1);
  assert.equal(minor(null), null);
});

test('a default variant is named after the product, a draft product is inactive, stock rules', () => {
  const single = { id: 1, title: 'Deterdžent 3 kg', status: 'draft', variants: [{ id: 9, title: 'Default Title', price: '12.50', inventory_management: null }] };
  const [row] = mapProduct(single, { merchantId: 'm1' });
  assert.equal(row.item.name, 'Deterdžent 3 kg');
  assert.equal(row.item.active, false);
  assert.equal(row.item.is_available, true);
  assert.equal('channel_code' in row.item, false);
  assert.equal(itemName({ title: 'X' }, { title: '' }), 'X');
  assert.equal(isAvailable({ inventory_management: 'shopify', inventory_policy: 'continue', inventory_quantity: 0 }), true);
  assert.equal(isAvailable({ inventory_management: 'shopify', inventory_policy: 'deny', inventory_quantity: 0 }), false);
  assert.deepEqual(mapProduct({ id: 2, title: 'None' }, { merchantId: 'm1' }), []);
  assert.equal(item({ id: 1, title: 'A' }, { id: 2, title: 'B' }, 'm1').name, 'A – B');
});

test('the label comes only when an anchor is owed and known', () => {
  assert.equal(label({ anchor_display: { required: true, label: 'Cijena na dan 10. 9. 2026.: 12,50 €' } }), 'Cijena na dan 10. 9. 2026.: 12,50 €');
  assert.equal(label({ data: { anchor_display: { required: true, label: 'x' } } }), 'x');
  assert.equal(label({ anchor_display: { required: false, label: 'x' } }), null);
  assert.equal(label({ anchor_display: { required: true, label: null, needs_review: true } }), null);
  assert.equal(label({}), null);
  assert.equal(label(null), null);
});
