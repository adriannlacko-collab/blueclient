import { host } from './bridge.js';

/**
 * The player's own background pictures, on the renderer's side (2026-09-21):
 * a blob URL per file, made once from the bytes main hands over and kept for
 * the session — the shell and the Background panel's tiles share it. The
 * renderer's content policy admits blob: pictures and refuses file: ones,
 * which is why a picture travels as bytes and not as a path.
 */
const urls = new Map();      // file -> Promise<string | null>

/** A blob URL for a picture, or null when it cannot be read. */
export function pictureUrl(file) {
  if (!file) return Promise.resolve(null);
  /* The promise is what is kept, so two asks in the same moment (the shell
     and a tile) share one read and one URL. A read that fails is not kept:
     the next ask tries again. */
  if (urls.has(file)) return urls.get(file);
  const work = (async () => {
    const got = await host.backgrounds?.read?.(file).catch(() => null);
    if (!got?.ok || !got.bytes) { urls.delete(file); return null; }
    return URL.createObjectURL(new Blob([got.bytes], { type: got.type || 'image/png' }));
  })();
  urls.set(file, work);
  return work;
}

/** A picture taken out: its URL is let go. */
export function forgetPicture(file) {
  const work = urls.get(file);
  if (!work) return;
  urls.delete(file);
  work.then((url) => { if (url) URL.revokeObjectURL(url); }).catch(() => {});
}
