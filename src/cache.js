/**
 * Txukun — Cache API wrapper for model blobs
 *
 * HuggingFace serves model files with `cache-control: no-store`, which
 * prevents the browser HTTP cache from storing them. Transformers.js
 * works around this by writing to the Cache API programmatically
 * (caches.open('transformers-cache')), but our raw fetch() calls for
 * GECToR's ONNX model (85MB) and BERTeus's embedding matrix (74MB)
 * bypass that layer — causing 159MB to re-download on every session.
 *
 * cachedFetch() wraps fetch() with a Cache API backing:
 *   1. Checks the cache first (instant for returning users)
 *   2. Falls back to network on miss
 *   3. Writes the response back to the cache
 *
 * Cache keys include a per-model version tag so we can bust the cache
 * when a specific model is updated on HuggingFace. Bump the tag for
 * only the model that changed — the other model's cache survives.
 */

const CACHE_NAME = 'txukun-cache';

/**
 * Fetch a URL with Cache API backing.
 *
 * @param {string} url - The URL to fetch
 * @param {string} versionTag - Per-model version tag for cache busting.
 *        When the model is updated on HuggingFace, change this tag to
 *        force a re-download. The old cache entry is evicted by the
 *        browser's storage quota management (Cache API is LRU).
 * @returns {Promise<Response>} A Response object (call .arrayBuffer() or .json())
 */
export async function cachedFetch(url, versionTag) {
  // Cache API not available (incognito mode, old browser, Node.js) — plain fetch
  if (!('caches' in globalThis)) {
    return fetch(url);
  }

  let cache;
  try {
    cache = await caches.open(CACHE_NAME);
  } catch {
    // CacheStorage may throw in some privacy modes
    return fetch(url);
  }

  // Cache key includes version tag so we can bust on model updates.
  // The tag is appended as a query param but is only used for cache
  // keying — the actual network request uses the original URL.
  const cacheKey = versionTag ? `${url}?txukun-v=${versionTag}` : url;

  // Try cache first (instant for returning users)
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  // Cache miss — fetch from network
  const response = await fetch(url);

  // Cache successful responses for next time
  if (response.ok) {
    try {
      // Clone before caching — the original is returned to the caller
      await cache.put(cacheKey, response.clone());
    } catch {
      // Caching failed (quota exceeded, etc.) — non-fatal
    }
  }

  return response;
}
