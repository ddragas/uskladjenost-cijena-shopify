/**
 * What the app remembers between webhooks: which variants each product had
 * and what they were called. Shopify's products/delete carries only the
 * product id, and a products/update may have dropped a variant, so this
 * is how those variants are deactivated in the API. One JSON file.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export class ProductState {
  /** @param {string|null} dir null keeps the state in memory only (tests) */
  constructor(dir) {
    this.file = dir ? join(dir, 'products.json') : null;
    this.products = {};
    if (this.file) {
      mkdirSync(dir, { recursive: true });
      try {
        this.products = JSON.parse(readFileSync(this.file, 'utf8')) || {};
      } catch {
        this.products = {};
      }
    }
  }

  /** The variants remembered for a product: { variantId: name }. */
  variants(productId) {
    return { ...(this.products[String(productId)] || {}) };
  }

  remember(productId, variants) {
    this.products[String(productId)] = { ...variants };
    this.save();
  }

  forget(productId) {
    delete this.products[String(productId)];
    this.save();
  }

  save() {
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.products));
    renameSync(tmp, this.file);
  }
}
