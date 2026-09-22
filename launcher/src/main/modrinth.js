'use strict';

/**
 * Modrinth search.
 *
 * The renderer runs under a CSP with `connect-src 'self'` and
 * `img-src 'self' data:`, so it cannot talk to api.modrinth.com and cannot
 * load a remote icon URL. Rather than punch holes in that policy, every
 * request goes through here and icons come back as data: URIs. The renderer
 * keeps its "no remote anything" guarantee and still gets a live catalogue.
 *
 * Search and icon fetch answer the browser; `file`, `builds` and `build`
 * answer the installer, which needs the one jar that fits a given profile
 * rather than a project page.
 */

const { USER_AGENT: UA } = require('./version');

const API = 'https://api.modrinth.com/v2';

const ICON_MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 12000;

async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{query?: string, loader?: string, version?: string, limit?: number}} opts
 * @returns {Promise<{ok: boolean, hits?: object[], error?: string}>}
 */
async function search({ query = '', loader, version, limit = 30, type = 'mod' } = {}) {
  // Facets narrow the catalogue to jars that can actually load on the profile
  // the user is adding to — a Forge profile should never be offered a
  // Fabric-only mod. A resource pack (2026-09-09) is for the game itself, so
  // it is narrowed by version alone.
  const kind = type === 'resourcepack' ? 'resourcepack' : 'mod';
  const facets = [[`project_type:${kind}`]];
  if (kind === 'mod' && loader && loader !== 'vanilla') facets.push([`categories:${loader}`]);
  if (version) facets.push([`versions:${version}`]);

  const url = new URL(`${API}/search`);
  url.searchParams.set('query', String(query || '').slice(0, 120));
  url.searchParams.set('facets', JSON.stringify(facets));
  url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 50)));
  url.searchParams.set('index', query ? 'relevance' : 'downloads');

  try {
    const res = await get(url);
    if (!res.ok) return { ok: false, error: `Modrinth returned ${res.status}` };

    const body = await res.json();
    const hits = (body.hits || []).map((hit) => ({
      id: hit.project_id,
      slug: hit.slug,
      name: hit.title,
      author: hit.author,
      description: hit.description,
      downloads: hit.downloads,
      follows: hit.follows,
      iconUrl: hit.icon_url || '',
      versions: hit.versions || [],
      loaders: hit.categories || [],
      latestVersion: hit.latest_version || ''
    }));
    return { ok: true, hits };
  } catch (error) {
    const offline = error.name === 'AbortError' || /fetch failed|ENOTFOUND|EAI_AGAIN/i.test(String(error));
    return { ok: false, error: offline ? 'Could not reach Modrinth.' : String(error.message || error) };
  }
}

/** Fetch one project icon and hand it back as a data: URI the CSP allows. */
async function icon(url) {
  if (!/^https:\/\/cdn\.modrinth\.com\//.test(String(url || ''))) return { ok: false };

  try {
    const res = await get(url);
    if (!res.ok) return { ok: false };

    const type = res.headers.get('content-type') || '';
    if (!/^image\//.test(type)) return { ok: false };

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > ICON_MAX_BYTES) return { ok: false };

    return { ok: true, dataUri: `data:${type};base64,${buffer.toString('base64')}` };
  } catch {
    return { ok: false };
  }
}

/**
 * One build of a project, shaped for the installer.
 *
 * The primary file, and what the author declared about the other projects:
 * a dependency carries the project it names and, where the author said which
 * build they built against, that build's id — Iris pins the Sodium it was
 * made for, and game/pairing.js goes to that pin first when the newest of the
 * two refuse each other. A project may also attach sources or a javadoc jar,
 * and those must not end up in the mods folder, so only the primary is kept.
 */
function describe(build) {
  const primary = (build.files || []).find((f) => f.primary) || (build.files || [])[0];
  if (!primary) return null;
  return {
    id: build.id,
    projectId: build.project_id,
    number: build.version_number,
    // release, beta or alpha — what the author called it (2026-09-20).
    type: build.version_type || 'release',
    gameVersions: build.game_versions || [],
    loaders: build.loaders || [],
    file: {
      url: primary.url,
      filename: primary.filename,
      sha1: primary.hashes && primary.hashes.sha1,
      size: primary.size
    },
    dependencies: (build.dependencies || [])
      .filter((d) => d.project_id)
      .map((d) => ({ projectId: d.project_id, versionId: d.version_id || null, type: d.dependency_type }))
  };
}

/** Releases before betas before alphas; the order within each is Modrinth's. */
const CHANNEL = { release: 0, beta: 1, alpha: 2 };

/**
 * Every build of one project that fits a game version and loader, newest
 * first — Modrinth's own order, **releases first** (2026-09-20). A project
 * that has published a release for this exact Minecraft and a beta of the
 * next thing after it used to hand the launcher the beta, because it was
 * newer: every player then ran what the author had not yet called finished.
 * A release for the version asked for is what a player would pick off the
 * page, and the pre-releases are still here, after it, for a Minecraft the
 * author has only reached in beta so far. The settle in mods.js walks the
 * list when the newest build has to give way to an older one.
 *
 * @returns {Promise<{ok: boolean, builds?: object[], error?: string}>}
 */
async function builds({ slug, version, loader }) {
  if (!slug) return { ok: false, error: 'That mod has no Modrinth project attached.' };

  const url = new URL(`${API}/project/${encodeURIComponent(slug)}/version`);
  if (version) url.searchParams.set('game_versions', JSON.stringify([version]));
  if (loader && loader !== 'vanilla') url.searchParams.set('loaders', JSON.stringify([loader]));

  try {
    const res = await get(url);
    if (!res.ok) return { ok: false, error: `Modrinth returned ${res.status}` };
    const list = await res.json();
    const described = (Array.isArray(list) ? list : []).map(describe).filter(Boolean);
    described.sort((a, b) => (CHANNEL[a.type] ?? 1) - (CHANNEL[b.type] ?? 1));
    return { ok: true, builds: described };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

/**
 * The jar to install for one project on one profile.
 *
 * Modrinth lists every build a project ever published, newest first, so the
 * first entry that matches both the game version and the loader is the one to
 * take. Whether that build agrees with the rest of the folder is not a
 * question this answers — see game/pairing.js.
 *
 * @returns {Promise<{ok: boolean, id?: string, projectId?: string, number?: string, file?: object, dependencies?: object[], error?: string}>}
 */
async function file({ slug, version, loader }) {
  const found = await builds({ slug, version, loader });
  if (!found.ok) return found;
  const build = found.builds[0];
  if (!build) {
    // No build at all, or none with a downloadable file: to the installer
    // those are the same answer. `noBuild` marks it as an ANSWER rather than
    // a failure (2026-09-22), which is what lets `resolveFile` tell a
    // withdrawn build from an unreachable Modrinth and refuse to put a jar
    // the author has taken down back in the folder from memory.
    return { ok: false, noBuild: true, error: `No build for Minecraft ${version} on ${loader}` };
  }
  return { ok: true, ...build };
}

/**
 * One build by its Modrinth id — the way a pinned dependency is named.
 * Nothing about the game version is asked here; the caller checks that the
 * build it was pointed at fits the profile before trusting it.
 */
async function build(id) {
  if (!/^[A-Za-z0-9]{1,16}$/.test(String(id || ''))) return { ok: false, error: 'Not a Modrinth build id.' };

  try {
    const res = await get(`${API}/version/${encodeURIComponent(id)}`);
    if (!res.ok) return { ok: false, error: `Modrinth returned ${res.status}` };
    const found = describe(await res.json());
    if (!found) return { ok: false, error: 'That build has no downloadable file.' };
    return { ok: true, ...found };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

/**
 * One project's listing — for the icon, mostly. The launcher's own
 * performance stack ships without icon addresses, and a mod added before
 * addresses were kept has none either; the slug is enough to find it.
 */
async function project(slug) {
  if (!/^[a-z0-9_-]{1,64}$/i.test(String(slug || ''))) return { ok: false };

  try {
    const res = await get(`${API}/project/${encodeURIComponent(slug)}`);
    if (!res.ok) return { ok: false, error: `Modrinth returned ${res.status}` };

    const body = await res.json();
    return { ok: true, iconUrl: body.icon_url || '', name: body.title || '' };
  } catch {
    return { ok: false };
  }
}

/**
 * Which builds a set of jars are, by their sha1 (2026-09-16, for Import
 * profiles): Modrinth's `version_files` answers a map of hash to build for
 * every hash it knows and says nothing about the rest. Asked in batches of
 * a hundred; a jar not on Modrinth simply has no entry.
 */
async function byHashes(hashes) {
  const list = [...new Set((hashes || []).filter((h) => /^[0-9a-f]{40}$/i.test(String(h))).map((h) => String(h).toLowerCase()))];
  const versions = {};
  try {
    for (let at = 0; at < list.length; at += 100) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let res;
      try {
        res = await fetch(`${API}/version_files`, {
          method: 'POST',
          headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ hashes: list.slice(at, at + 100), algorithm: 'sha1' }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) return { ok: false, error: `Modrinth returned ${res.status}` };
      const body = await res.json();
      for (const [hash, build] of Object.entries(body || {})) {
        const found = describe(build);
        if (found) versions[hash.toLowerCase()] = found;
      }
    }
    return { ok: true, versions };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

/** Several projects at once, by id: id → { slug, name, iconUrl }. */
async function projects(ids) {
  const list = [...new Set((ids || []).filter((id) => /^[A-Za-z0-9]{1,16}$/.test(String(id || ''))))];
  if (!list.length) return { ok: true, projects: {} };
  try {
    const url = new URL(`${API}/projects`);
    url.searchParams.set('ids', JSON.stringify(list));
    const res = await get(url);
    if (!res.ok) return { ok: false, error: `Modrinth returned ${res.status}` };
    const out = {};
    for (const p of await res.json()) {
      if (p && p.id) out[p.id] = { slug: p.slug || '', name: p.title || '', iconUrl: p.icon_url || '' };
    }
    return { ok: true, projects: out };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

module.exports = { search, icon, file, builds, build, project, byHashes, projects };
