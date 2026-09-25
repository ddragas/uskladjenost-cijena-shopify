/** A small in-memory cache with a time to live per entry; labels live here six hours. */
export class TtlCache {
  constructor(defaultTtlMs, now = Date.now) {
    this.defaultTtlMs = defaultTtlMs;
    this.now = now;
    this.entries = new Map();
  }

  /** The cached value, or undefined when absent or expired. A cached null is a value. */
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    if (this.entries.size > 50000) this.sweep();
    return value;
  }

  delete(key) {
    this.entries.delete(key);
  }

  sweep() {
    const now = this.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
  }
}
