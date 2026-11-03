// XenoCI sticky disk delete action. One file, node built-ins only, so the folder works as published (Xeno-CI/build/stickydisk-delete).
// Deletes through the existing API key routes: GET /stickydisks?repo= then DELETE /stickydisks/:id?revision= per disk (the server
// checks the key's organization and permission, meters storage up to the delete and writes an audit row).
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// Same prefix as integrations/docker-builder/cache.mjs builderCacheKey (the repository's Docker builder disks).
const DOCKER_CACHE_PREFIX = 'docker-buildkit-v1:';

export async function deleteStickyDisks(env = process.env, { fetchImpl = fetch, log = console.log } = {}) {
  // The runner passes input `delete-key` as INPUT_DELETE-KEY (upper case, hyphen kept).
  const key = String(env['INPUT_DELETE-KEY'] ?? '').trim();
  const docker = String(env['INPUT_DELETE-DOCKER-CACHE'] ?? 'false').trim().toLowerCase() === 'true';
  const apiKey = String(env['INPUT_API-KEY'] ?? '').trim();
  const repo = String(env.GITHUB_REPOSITORY ?? '');
  if (!key && !docker) throw new Error('delete-key or delete-docker-cache: true is required');
  if (!apiKey) throw new Error('api-key is required (repository secret XENOCI_API_KEY)');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GITHUB_REPOSITORY is not set');
  log(`::add-mask::${apiKey}`);
  const base = new URL('/api/runner/v1', String(env['INPUT_API-URL'] ?? '') || 'https://xenoci.com');
  const call = async (method, path) => {
    const response = await fetchImpl(new URL(base.pathname + path, base), { method, redirect: 'error',
      headers: { authorization: `Bearer ${apiKey}`, 'XenoCI-Error-Format': '2', 'user-agent': 'xenoci-stickydisk-delete' } });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`XenoCI ${method} ${path.split('?')[0]} ${response.status} ${body?.error?.code ?? ''}: ${body?.error?.message ?? ''}`.trim());
    return body;
  };
  const disks = [];
  for (let cursor = null; ;) {
    const page = await call('GET', `/stickydisks?${new URLSearchParams({ repo, limit: '100', ...(cursor ? { cursor } : {}) })}`);
    const rows = Array.isArray(page) ? page : page?.data ?? [];
    disks.push(...rows);
    if (rows.length < 100) break;
    cursor = rows.at(-1).id;
  }
  const targets = disks.filter((d) => d.state !== 'deleted' && ((key && d.key === key) || (docker && String(d.key).startsWith(DOCKER_CACHE_PREFIX))));
  let bytes = 0;
  for (const d of targets) {
    const r = await call('DELETE', `/stickydisks/${encodeURIComponent(d.id)}?revision=${d.generation ?? 0}`);
    bytes += r?.deleted_bytes ?? 0;
    log(`Deleted sticky disk ${d.key} (${d.id}, ${r?.deleted_bytes ?? 0} bytes)`);
  }
  if (!targets.length) log(`::notice::No sticky disk of ${repo} matched${key ? ` key ${key}` : ''}${docker ? `${key ? ' or' : ''} the Docker builder cache` : ''}`);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `deleted=${targets.length}\ndeleted-bytes=${bytes}\n`);
  return { repo, deleted: targets.length, deleted_bytes: bytes };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  deleteStickyDisks().catch((error) => { console.log(`::error::${error.message}`); process.exit(1); });
}
