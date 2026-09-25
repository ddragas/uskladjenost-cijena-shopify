/**
 * Shopify product data → API payloads. Pure functions, no I/O, so they are
 * unit-tested on their own. The external id of a variant is its Shopify
 * variant id as a string ("41234567890"); a product with one default
 * variant is one item named after the product.
 */

/** "12.50" → 1250; "" / null / not a number → null. */
export function minor(amount) {
  if (amount === null || amount === undefined || amount === '' || amount === false) return null;
  const text = String(amount).trim().replace(',', '.');
  if (text === '' || Number.isNaN(Number(text))) return null;
  return Math.round(Number(text) * 100);
}

export function externalId(variant) {
  return String(variant.id);
}

/** "Product – Variant title"; a lone default variant carries only the product's title. */
export function itemName(product, variant) {
  const title = String(product.title || '').trim();
  const variantTitle = String(variant.title || '').trim();
  if (variantTitle === '' || variantTitle === 'Default Title') return title.slice(0, 255);
  return `${title} – ${variantTitle}`.slice(0, 255);
}

/** In stock, or sellable regardless of stock (untracked or policy "continue"). */
export function isAvailable(variant) {
  if (!variant.inventory_management) return true;
  if (variant.inventory_policy === 'continue') return true;
  return Number(variant.inventory_quantity ?? 0) > 0;
}

/**
 * The item to PUT /items/{id} for one variant.
 * @returns {Record<string, unknown>}
 */
export function item(product, variant, merchantId, channelCode = null) {
  const out = {
    merchant_id: merchantId,
    kind: 'product',
    name: itemName(product, variant),
    sku: variant.sku ? String(variant.sku) : null,
    barcode: variant.barcode ? String(variant.barcode).replace(/\s+/g, '') : null,
    category: product.product_type ? String(product.product_type).slice(0, 120) : null,
    brand: product.vendor ? String(product.vendor).slice(0, 120) : null,
    active: product.status ? product.status === 'active' : true,
    is_available: isAvailable(variant),
    channel_code: channelCode,
    metadata: { shopify_product_id: String(product.id), shopify_variant_id: String(variant.id) },
  };
  return clean(out);
}

/**
 * The price event for one variant, or null when it has no price. A
 * compare-at price above the price is a sale: regular = compare_at_price,
 * effective = price. Amounts leave in minor units.
 * @returns {Record<string, unknown>|null}
 */
export function price(variant, currency = 'EUR', channelCode = null) {
  const current = minor(variant.price);
  if (current === null) return null;
  const compareAt = minor(variant.compare_at_price);
  const onSale = compareAt !== null && compareAt > current;
  const regular = onSale ? compareAt : current;
  const effective = current;
  return clean({
    regular_price_minor: regular,
    effective_price_minor: effective,
    currency: String(currency || 'EUR').toUpperCase(),
    tax_inclusive: true,
    special_sale: { active: onSale },
    source_event_id: `shopify:${variant.id}:${regular}:${effective}:${variant.updated_at || ''}`,
    channel_code: channelCode,
  });
}

/**
 * Every variant of a product as { external_id, item, price }; a product with
 * no variants yields nothing.
 * @returns {Array<{ external_id: string, item: Record<string, unknown>, price: Record<string, unknown>|null }>}
 */
export function mapProduct(product, { merchantId, channelCode = null, currency = 'EUR' }) {
  return (product.variants || []).map((variant) => ({
    external_id: externalId(variant),
    item: item(product, variant, merchantId, channelCode),
    price: price(variant, currency, channelCode),
  }));
}

/** The one line printed next to the price, from the API's decision; null when nothing is owed. */
export function label(decision) {
  const display = decision?.anchor_display ?? decision?.data?.anchor_display ?? null;
  if (!display || !display.required) return null;
  return typeof display.label === 'string' && display.label !== '' ? display.label : null;
}

function clean(object) {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== null && v !== undefined && v !== ''));
}
