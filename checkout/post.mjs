// actions/checkout/post.mjs
import path5 from "node:path";
import { spawn as spawn2 } from "node:child_process";
import { fileURLToPath } from "node:url";

// actions/checkout/mirror-checkout.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
var ROOM_CODES = new Set(["sticky_capacity_full", "sticky_org_full"]);
function git(args, { cwd, env = {}, token = "" } = {}) {
  const extra = { GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1", ...env };
  if (token) {
    const n = Number(extra.GIT_CONFIG_COUNT ?? 0);
    Object.assign(extra, {
      GIT_CONFIG_COUNT: String(n + 1),
      [`GIT_CONFIG_KEY_${n}`]: "http.https://github.com/.extraheader",
      [`GIT_CONFIG_VALUE_${n}`]: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`
    });
  }
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, env: { ...process.env, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.resume();
    child.once("error", () => resolve({ code: 127, stdout: "" }));
    child.once("close", (code) => resolve({ code, stdout: Buffer.concat(out).toString("utf8").trim() }));
  });
}
async function runPost({ env, upstream, runtimeFor, log }) {
  const code = await upstream(env);
  if (!env.STATE_XENOCI_CHECKOUT_JOB)
    return code;
  let state;
  try {
    state = JSON.parse(env.STATE_XENOCI_CHECKOUT_JOB);
  } catch {
    return code;
  }
  const runtime = runtimeFor(state.config);
  const { job } = state;
  try {
    let receipt = { committed: false };
    try {
      if (env.STATE_XENOCI_CHECKOUT_COMMIT === "1" && job.mounted.mode === "write") {
        const mirror = path.join(job.mounted.mount, "mirror.git");
        await git(["--git-dir", mirror, "gc", "--auto", "--quiet"]);
        receipt = await runtime.finish(job, { succeeded: true, jobCompleted: true });
      } else
        await runtime.finish(job, { succeeded: false, jobCompleted: true });
    } catch (error) {
      if (ROOM_CODES.has(error.message))
        log("::notice::Git 체크아웃 캐시를 둘 스티키 디스크 자리가 없어 이번 미러는 저장하지 않았어요");
      else
        log(`::warning::Git 체크아웃 캐시를 이번에는 저장하지 못했어요 (${error.message})`);
    }
    log(`XENOCI_CHECKOUT_SAVED committed=${receipt.committed === true} generation=${receipt.generation ?? job.lease.generation}`);
  } finally {
    await runtime.release(job).catch(() => {});
    await runtime.cleanup(job, { activeLeases: 0 }).catch(() => {});
    if (state.config.root)
      await fs.rm(state.config.root, { recursive: true, force: true }).catch(() => {});
  }
  return code;
}
function upstreamRunner(script) {
  return (env) => new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { env, stdio: "inherit" });
    child.once("error", () => resolve(1));
    child.once("close", (code) => resolve(code ?? 1));
  });
}

// server/ci/runner2-cache-runtime.js
import fs3 from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path3 from "node:path";
import crypto2 from "node:crypto";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

// server/ci/runner2-cache-mac.js
import fs2 from "node:fs/promises";
import path2 from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execute = promisify(execFile);
var identifier = (value) => {
  if (typeof value !== "string" || !/^(disk|lease)_[A-Za-z0-9_-]{8,80}$/.test(value))
    throw new Error("invalid cache resource id");
  return value;
};
function createMacCacheAdapter({ root, run = execute, platform = process.platform, guestLocal = false }) {
  if (platform !== "darwin")
    throw new Error("APFS cache adapter requires macOS");
  if (!path2.isAbsolute(root))
    throw new Error("APFS cache root must be absolute");
  const diskPath = (diskId, generation) => {
    identifier(diskId);
    if (!Number.isSafeInteger(generation) || generation < 0)
      throw new Error("invalid cache generation");
    return path2.join(root, `${diskId}.${generation}.sparsebundle`);
  };
  const leasePath = (leaseId) => path2.join(root, identifier(leaseId));
  const command = (exe, args) => run(exe, args, { timeout: 120000, maxBuffer: 1024 * 1024, env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: root } });
  const create = async ({ diskId, maxBytes, generation = 0 }) => {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 32 * 1024 ** 2)
      throw new Error("APFS capacity must be at least 32 MiB");
    const target = diskPath(diskId, generation);
    await fs2.mkdir(root, { recursive: true, mode: 448 });
    await command("/usr/bin/hdiutil", ["create", "-size", `${Math.ceil(maxBytes / 512)}b`, "-fs", "APFS", "-type", "SPARSEBUNDLE", "-volname", "XenoCI Cache", target]);
    return { path: target };
  };
  const attach = async ({ diskId, generation, leaseId, mode }) => {
    if (!["read", "write"].includes(mode))
      throw new Error("invalid cache lease mode");
    const owned = leasePath(leaseId), image = path2.join(owned, "cache.sparsebundle"), mount = path2.join(owned, "mount");
    await fs2.mkdir(owned, { mode: 448 });
    await fs2.mkdir(mount);
    try {
      await command("/bin/cp", ["-c", "-R", diskPath(diskId, generation), image]);
      await command("/usr/bin/hdiutil", ["attach", "-nobrowse", "-noautoopen", "-mountpoint", mount, ...mode === "read" ? ["-readonly"] : [], image]);
      return { diskId, generation, leaseId, mode, image, mount };
    } catch (error) {
      const { stdout } = await command("/sbin/mount", []);
      if (!stdout.includes(` on ${mount} (`))
        await fs2.rm(owned, { recursive: true, force: true });
      throw error;
    }
  };
  const detach = async (lease) => {
    if (lease.mount !== path2.join(leasePath(lease.leaseId), "mount"))
      throw new Error("foreign cache mount");
    await command("/usr/bin/hdiutil", ["detach", lease.mount]);
    const { stdout } = await command("/sbin/mount", []);
    if (stdout.includes(` on ${lease.mount} (`))
      throw new Error("cache mount still active");
  };
  const measure = async (image) => {
    let bytes = 0;
    const digest = crypto.createHash("sha256");
    const walk = async (directory, relative = "") => {
      for (const name of (await fs2.readdir(directory)).sort()) {
        const full = path2.join(directory, name), rel = path2.join(relative, name), stat = await fs2.lstat(full);
        if (stat.isSymbolicLink())
          throw new Error("cache image contains symlink");
        if (stat.isDirectory())
          await walk(full, rel);
        else if (stat.isFile()) {
          const data = await fs2.readFile(full);
          bytes += data.length;
          digest.update(`${rel}\x00${data.length}\x00`);
          digest.update(data);
        } else
          throw new Error("cache image contains special file");
      }
    };
    await walk(image);
    return { bytes, digest: digest.digest("hex") };
  };
  const publish = async (lease, { stopped, jobCompleted = false }) => {
    if (lease.mode !== "write" || stopped !== true && !(guestLocal && jobCompleted === true))
      throw new Error("writer must have a stopped guest or completed guest-local job before publishing");
    if (lease.image !== path2.join(leasePath(lease.leaseId), "cache.sparsebundle"))
      throw new Error("foreign cache image");
    await detach(lease);
    const measured = await measure(lease.image), target = diskPath(lease.diskId, lease.generation + 1);
    await fs2.mkdir(`${target}.claim`);
    try {
      await fs2.rename(lease.image, target);
    } finally {
      await fs2.rmdir(`${target}.claim`);
    }
    await fs2.rm(leasePath(lease.leaseId), { recursive: true });
    return { generation: lease.generation + 1, ...measured, path: target };
  };
  const release = async (lease) => {
    await detach(lease);
    await fs2.rm(leasePath(lease.leaseId), { recursive: true });
    return { unmounted: true };
  };
  const remove = async ({ diskId, activeLeases }) => {
    identifier(diskId);
    if (activeLeases !== 0)
      throw new Error("active cache lease cannot be evicted");
    const { stdout } = await command("/sbin/mount", []);
    if (stdout.includes(root))
      throw new Error("cache mount exists; refuse image deletion");
    for (const name of await fs2.readdir(root))
      if (name.startsWith(`${diskId}.`) && name.endsWith(".sparsebundle"))
        await fs2.rm(path2.join(root, name), { recursive: true });
    return { deleted: true, activeLeases: 0 };
  };
  return { create, attach, publish, release, remove, measure };
}

// server/ci/runner2-cache-runtime.js
function httpGetResponse(url, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = (new URL(url).protocol === "https:" ? https : http).get(url, { headers }, (res) => {
      const out = new Headers;
      for (const [k, v] of Object.entries(res.headers))
        if (v != null)
          out.set(k, Array.isArray(v) ? v.join(", ") : String(v));
      resolve(new Response([204, 304].includes(res.statusCode) ? (res.resume(), null) : Readable.toWeb(res), { status: res.statusCode, headers: out }));
    });
    req.once("error", reject);
  });
}
var fileName = /^(?:Info\.plist|Info\.bckup|token|bands\/[a-f0-9]+)$/;
var digestFile = async (name) => {
  const digest = crypto2.createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(name)) {
    bytes += chunk.length;
    digest.update(chunk);
  }
  return { digest: digest.digest("hex"), bytes };
};
async function packMacCacheImage(image, target) {
  const output = createWriteStream(target, { flags: "wx", mode: 384 });
  let streamError = null;
  output.on("error", (error) => {
    streamError ??= error;
  });
  const write = async (data) => {
    if (streamError)
      throw streamError;
    if (!output.write(data))
      await once(output, "drain");
  };
  try {
    await write(Buffer.from("XCIAPFS1"));
    for (const name of (await fs3.readdir(image)).sort()) {
      if (name === "lock")
        continue;
      if (name === "bands") {
        const stat = await fs3.lstat(path3.join(image, name));
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new Error("unsafe sparsebundle bands");
      }
      const names = name === "bands" ? (await fs3.readdir(path3.join(image, name))).sort().map((band) => `bands/${band}`) : [name];
      for (const relative of names) {
        if (!fileName.test(relative))
          throw new Error(`unexpected sparsebundle file: ${JSON.stringify(relative.slice(0, 80))}`);
        const full = path3.join(image, relative), stat = await fs3.lstat(full);
        if (!stat.isFile() || stat.isSymbolicLink())
          throw new Error("unsafe sparsebundle file");
        const header = Buffer.alloc(12), nameBuffer = Buffer.from(relative);
        header.writeUInt32BE(nameBuffer.length);
        header.writeBigUInt64BE(BigInt(stat.size), 4);
        await write(header);
        await write(nameBuffer);
        let read = 0;
        for await (const chunk of createReadStream(full)) {
          read += chunk.length;
          await write(chunk);
        }
        if (read !== stat.size)
          throw new Error("sparsebundle changed while archiving");
      }
    }
    const finished = once(output, "finish");
    output.end();
    await finished;
    return await digestFile(target);
  } catch (error) {
    if (!output.closed) {
      const closed = new Promise((resolve) => output.once("close", resolve));
      output.destroy();
      await closed;
    }
    await fs3.rm(target, { force: true });
    throw error;
  }
}
async function restoreMacCacheImage(archive, target, maxBytes) {
  const input = await fs3.open(archive, "r"), seen = new Set;
  let offset = 0, total = 0;
  const read = async (size) => {
    const data = Buffer.alloc(size);
    let position = 0;
    while (position < size) {
      const n = await input.read(data, position, size - position, offset);
      if (!n.bytesRead)
        throw new Error("truncated sparsebundle archive");
      position += n.bytesRead;
      offset += n.bytesRead;
    }
    return data;
  };
  await fs3.mkdir(target, { mode: 448 });
  try {
    if (!(await read(8)).equals(Buffer.from("XCIAPFS1")))
      throw new Error("invalid sparsebundle archive");
    const size = (await input.stat()).size;
    while (offset < size) {
      const header = await read(12), length = header.readUInt32BE(), bytes = Number(header.readBigUInt64BE(4));
      if (!Number.isSafeInteger(bytes) || length < 1 || length > 128 || total + bytes > maxBytes)
        throw new Error("oversized sparsebundle archive");
      const relative = (await read(length)).toString();
      if (!fileName.test(relative) || seen.has(relative))
        throw new Error("unsafe sparsebundle archive path");
      seen.add(relative);
      total += bytes;
      if (relative.startsWith("bands/"))
        await fs3.mkdir(path3.join(target, "bands"), { recursive: true, mode: 448 });
      const output = await fs3.open(path3.join(target, relative), "wx", 384);
      try {
        let left = bytes;
        while (left) {
          const chunk = await read(Math.min(left, 1024 * 1024));
          await output.writeFile(chunk);
          left -= chunk.length;
        }
      } finally {
        await output.close();
      }
    }
    if (!seen.has("Info.plist"))
      throw new Error("sparsebundle metadata missing");
    return { bytes: total };
  } catch (error) {
    await fs3.rm(target, { recursive: true, force: true });
    throw error;
  } finally {
    await input.close();
  }
}
function createMacStickyJobRuntime({
  origin,
  orgPublicId,
  capability,
  jobPublicId,
  repo,
  ref,
  root,
  gateway = null,
  fetchImpl = fetch,
  downloadImpl = fetchImpl === fetch ? httpGetResponse : fetchImpl,
  guestLocal = false,
  adapter = createMacCacheAdapter({ root, guestLocal }),
  log = () => {}
}) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.username || base.password || !path3.isAbsolute(root))
    throw new Error("invalid cache runtime configuration");
  const transport = gateway ? new URL(gateway) : base;
  if (gateway && transport.href !== "http://artifacts.ci.xeno/")
    throw new Error("invalid internal cache gateway");
  const requestUrl = (url) => new URL(url.pathname + url.search, transport);
  const viaHeaders = (url, headers = {}) => gateway && url.origin === transport.origin ? { ...headers, "x-xeno-cache-origin": base.origin } : headers;
  const endpoint = `/api/runner/v1/organizations/${encodeURIComponent(orgPublicId)}/cache/leases`;
  const api = async (route, body) => {
    const url = requestUrl(new URL(route, base));
    const response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      headers: viaHeaders(url, { Authorization: `Bearer ${capability}`, "Content-Type": "application/json" }),
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const e = await response.json();
      throw Object.assign(new Error(e.error?.code ?? "cache_http_error"), { status: response.status });
    }
    return (await response.json()).data;
  };
  const signedUrl = (value) => {
    const url = new URL(value, base);
    if (url.username || url.password)
      throw new Error("foreign cache blob origin");
    if (url.href.startsWith("http://sticky.ci.xeno/objects/"))
      return url;
    if (url.origin !== base.origin)
      throw new Error("foreign cache blob origin");
    return requestUrl(url);
  };
  const begin = async ({ key, maxBytes, mode = "write", kind = "sticky", mountPath = null }) => {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 32 * 1024 ** 2)
      throw new Error("invalid cache image capacity");
    const request = (m) => api(endpoint, { kind, repo, key, ref, mode: m, job_id: jobPublicId, ...typeof mountPath === "string" && mountPath ? { path: mountPath } : {} });
    let readOnly = null;
    const lease = await request(mode).catch((error) => {
      if (mode !== "write" || error.status !== 402 || error.message === "sticky_unpaid")
        throw error;
      mode = "read";
      readOnly = error.message;
      return request("read");
    });
    const localId = `disk_${crypto2.createHash("sha256").update(`${orgPublicId}\x00${repo}\x00${kind === "sticky" ? "" : `${kind}\x00`}${key}`).digest("hex")}`;
    await fs3.mkdir(root, { recursive: true, mode: 448 });
    const archive = path3.join(root, `${lease.lease_id}.download`), image = path3.join(root, `${localId}.${lease.generation}.sparsebundle`);
    let restored = false, source = "empty", downloadMs = 0, downloadBytes = 0;
    try {
      if (lease.generation > 0 && lease.read_url) {
        const started = Date.now();
        try {
          const readUrl = signedUrl(lease.read_url);
          const response = await downloadImpl(readUrl, { redirect: "error", headers: viaHeaders(readUrl) });
          if (!response.ok || Number(response.headers.get("content-length")) > maxBytes * 2) {
            await response.body?.cancel();
            throw new Error(`cache image download ${response.status}`);
          }
          await pipeline(response.body, createWriteStream(archive, { flags: "wx", mode: 384 }));
          const receipt = await digestFile(archive);
          if (`"${receipt.digest}"` !== response.headers.get("etag") || lease.digest && receipt.digest !== lease.digest)
            throw new Error("cache image digest mismatch");
          await restoreMacCacheImage(archive, image, maxBytes);
          restored = true;
          source = response.headers.get("x-xeno-sticky") || "server";
          downloadBytes = receipt.bytes;
          downloadMs = Date.now() - started;
        } catch (error) {
          log(`sticky image unavailable, starting empty: ${error.message}`);
          await fs3.rm(archive, { force: true });
          await fs3.rm(image, { recursive: true, force: true });
        }
      }
      if (!restored)
        await adapter.create({ diskId: localId, maxBytes, generation: lease.generation });
      const mounted = await adapter.attach({ diskId: localId, generation: lease.generation, leaseId: lease.lease_id, mode });
      return { lease, mounted, maxBytes, localId, restored, source, downloadMs, downloadBytes, readOnly };
    } catch (error) {
      await api(`${endpoint}/${encodeURIComponent(lease.lease_id)}/release`, {});
      await adapter.remove({ diskId: localId, activeLeases: 0 });
      throw error;
    } finally {
      await fs3.rm(archive, { force: true });
    }
  };
  const finish = async (job, { succeeded, stopped, jobCompleted = false }) => {
    if (stopped !== true && !(guestLocal && jobCompleted === true))
      throw new Error("guest must be stopped or guest-local job completed before sticky finalization");
    if (!succeeded || job.mounted.mode === "read") {
      await adapter.release(job.mounted);
      return { committed: false };
    }
    const published = await adapter.publish(job.mounted, { stopped, jobCompleted }), archive = path3.join(root, `${job.lease.lease_id}.upload`);
    try {
      const receipt = await packMacCacheImage(published.path, archive);
      if (receipt.bytes > job.maxBytes)
        throw new Error("cache image exceeds reserved capacity");
      const writeUrl = signedUrl(job.lease.write_url);
      const response = await fetchImpl(writeUrl, {
        method: "PUT",
        redirect: "error",
        body: createReadStream(archive),
        duplex: "half",
        headers: viaHeaders(writeUrl, { "content-length": String(receipt.bytes) })
      });
      if (!response.ok)
        throw new Error(`cache image upload failed ${response.status}`);
      return await api(`${endpoint}/${encodeURIComponent(job.lease.lease_id)}/commit`, { generation: job.lease.generation, ...receipt });
    } finally {
      await fs3.rm(archive, { force: true });
    }
  };
  const release = async (job) => api(`${endpoint}/${encodeURIComponent(job.lease.lease_id)}/release`, {});
  const cleanup = async (job, { activeLeases }) => adapter.remove({ diskId: job.localId, activeLeases });
  return { begin, finish, release, cleanup };
}

// integrations/stickydisk/linux-block.mjs
import fs5 from "node:fs/promises";
import { watch } from "node:fs";
import path4 from "node:path";
import os from "node:os";
import net from "node:net";
import { execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";

// integrations/docker-builder/cache.mjs
import fs4 from "node:fs";
import fsp from "node:fs/promises";
import crypto3 from "node:crypto";
import { Transform } from "node:stream";
import { pipeline as pipeline2 } from "node:stream/promises";
var MAX_ARCHIVE_BYTES = 1024 ** 3;
async function archiveDigest(file, maxBytes = MAX_ARCHIVE_BYTES) {
  const hash = crypto3.createHash("sha256");
  let bytes = 0;
  for await (const chunk of fs4.createReadStream(file)) {
    bytes += chunk.length;
    if (bytes > maxBytes)
      throw Error("cache archive exceeds capacity");
    hash.update(chunk);
  }
  return { bytes, digest: hash.digest("hex") };
}
function createBuilderCache(config, { fetchImpl = fetch, now = Date.now } = {}) {
  const base = new URL(config.origin);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash)
    throw Error("invalid cache origin");
  if (!config.capability || !config.orgPublicId || !config.jobPublicId || !config.repo || !config.ref)
    throw Error("missing job cache grant");
  if (!["read", "write"].includes(config.mode))
    throw Error("invalid cache mode");
  const transport = config.gateway ? new URL(config.gateway) : base;
  if (config.gateway && transport.href !== "http://artifacts.ci.xeno/")
    throw Error("invalid cache gateway");
  const endpoint = `/api/runner/v1/organizations/${encodeURIComponent(config.orgPublicId)}/cache/leases`;
  const headers = (url, extra = {}) => config.gateway && url.origin === transport.origin ? { ...extra, "x-xeno-cache-origin": base.origin } : extra;
  const api = async (suffix, body) => {
    const url = new URL(endpoint + suffix, transport);
    const response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(60000),
      headers: headers(url, { authorization: `Bearer ${config.capability}`, "content-type": "application/json" }),
      body: JSON.stringify(body)
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(Error(value.error?.code || "cache_http_error"), { status: response.status });
    return value.data;
  };
  const blobUrl = (value) => {
    const url = new URL(value, base);
    if (url.username || url.password || url.hash)
      throw Error("foreign cache blob origin");
    if (url.origin === "http://sticky.ci.xeno" && /^\/objects\/[A-Za-z0-9_-]{8,100}$/.test(url.pathname))
      return url;
    if (url.origin !== base.origin || url.pathname !== "/api/runner/v1/cache/blobs")
      throw Error("foreign cache blob origin");
    return new URL(url.pathname + url.search, transport);
  };
  const acquire = async (key, options = {}) => {
    const request = (mode2) => api("", { kind: "sticky", repo: config.repo, key, ref: config.ref, mode: mode2, job_id: config.jobPublicId, ...options });
    let mode = config.mode, lease;
    try {
      lease = await request(mode);
    } catch (error) {
      if (mode !== "write" || !["writer_busy", "untrusted_ref", "insufficient_credit"].includes(error.message))
        throw error;
      mode = "read";
      lease = await request(mode);
    }
    if (!/^lease_[A-Za-z0-9_-]{8,80}$/.test(lease.lease_id) || !Number.isSafeInteger(lease.generation) || lease.generation < 0)
      throw Error("invalid cache lease");
    return { ...lease, mode: lease.mode ?? mode };
  };
  const restore = async (lease, file) => {
    if (!lease.generation || !lease.read_url)
      return false;
    const url = blobUrl(lease.read_url);
    const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(120000), headers: headers(url) });
    if (!response.ok || Number(response.headers.get("content-length")) > MAX_ARCHIVE_BYTES) {
      await response.body?.cancel();
      throw Error("cache download rejected");
    }
    let bytes = 0;
    try {
      await pipeline2(response.body, new Transform({ transform(chunk, _encoding, done) {
        bytes += chunk.length;
        done(bytes > MAX_ARCHIVE_BYTES ? Error("cache archive exceeds capacity") : null, chunk);
      } }), fs4.createWriteStream(file, { flags: "wx", mode: 384 }));
      const receipt = await archiveDigest(file);
      if (!lease.digest || receipt.digest !== lease.digest || response.headers.get("etag") !== `"${receipt.digest}"`)
        throw Error("cache digest mismatch");
      return true;
    } catch (error) {
      await fsp.rm(file, { force: true });
      throw error;
    }
  };
  const commit = async (lease, file) => {
    if (lease.mode !== "write" || !lease.write_url)
      return { committed: false };
    if (!(Date.parse(lease.expires_at) > now()))
      throw Error("cache lease expired");
    const receipt = await archiveDigest(file), url = blobUrl(lease.write_url);
    const body = fs4.createReadStream(file);
    try {
      const response = await fetchImpl(url, {
        method: "PUT",
        redirect: "error",
        signal: AbortSignal.timeout(120000),
        headers: headers(url, { "content-length": String(receipt.bytes) }),
        body,
        duplex: "half"
      });
      await response.body?.cancel();
      if (!response.ok)
        throw Error("cache upload rejected");
    } finally {
      body.destroy();
    }
    return api(`/${encodeURIComponent(lease.lease_id)}/commit`, { generation: lease.generation, ...receipt });
  };
  const commitBlock = (lease, receipt) => {
    if (lease.mode !== "write" || receipt.committed !== true)
      return { committed: false };
    return api(`/${encodeURIComponent(lease.lease_id)}/commit`, { generation: lease.generation, bytes: receipt.bytes, digest: receipt.sha256 });
  };
  return { acquire, restore, commit, commitBlock, release: (lease) => api(`/${encodeURIComponent(lease.lease_id)}/release`, {}) };
}

// integrations/stickydisk/linux-block.mjs
var exec = promisify2(execFile2);
var deviceCommand = async (command, args) => (await exec(command, args, { timeout: 120000 })).stdout.trim();
function blockHostcall(message, { host = "10.0.2.102", port = 80 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let data = "";
    const finish = (error, value) => {
      socket.destroy();
      if (error)
        reject(error);
      else
        resolve(value);
    };
    socket.setTimeout(60000, () => finish(Error("block_hostcall_timeout")));
    socket.once("error", reject);
    socket.once("connect", () => socket.write(`${JSON.stringify(message)}
`));
    socket.on("data", (chunk) => {
      data += chunk;
      if (data.length > 65536)
        return finish(Error("block_hostcall_response_too_large"));
      if (!data.includes(`
`))
        return;
      try {
        const value = JSON.parse(data.slice(0, data.indexOf(`
`)));
        if (value.ok !== true)
          throw Error("block_hostcall_failed");
        finish(null, value);
      } catch (error) {
        finish(error);
      }
    });
    socket.once("end", () => finish(Error("block_hostcall_closed")));
  });
}
function waitForBlockDevice(device, { watchImpl = watch, access = fs5.access } = {}) {
  return new Promise((resolve, reject) => {
    const watcher = watchImpl(path4.dirname(device), check);
    const timer = setTimeout(() => finish(Error("block_device_timeout")), 1e4);
    function finish(error) {
      clearTimeout(timer);
      watcher.close();
      if (error)
        reject(error);
      else
        resolve();
    }
    function check() {
      access(device).then(() => finish(), (error) => {
        if (error.code !== "ENOENT")
          finish(error);
      });
    }
    watcher.once("error", finish);
    check();
  });
}
function createLinuxBlockDisk({
  runnerTemp = process.env.RUNNER_TEMP,
  run = deviceCommand,
  host,
  port,
  waitDevice = waitForBlockDevice,
  log = console.log
} = {}) {
  const call = (message) => blockHostcall(message, { host, port });
  const attach = async (lease, mountPath) => {
    const started = Date.now();
    let slot, slotFile;
    for (let n = 1;n <= 5; n++) {
      const file = path4.join(runnerTemp, `xenoci-block-slot-${n}.json`);
      try {
        const handle = await fs5.open(file, "wx", 384);
        try {
          await handle.writeFile(JSON.stringify({ lease: lease.lease_id }));
        } finally {
          await handle.close();
        }
        slot = n;
        slotFile = file;
        break;
      } catch (error) {
        if (error.code !== "EEXIST")
          throw error;
      }
    }
    if (!slot)
      throw Error("block_slots_full");
    const disk = { slot, slotFile, mount: mountPath || path4.join(runnerTemp, `xenoci-buildkit-${slot}`), mounted: false, detached: false };
    try {
      const attached = await call({ op: "attach", attach: lease.block.attach, slot });
      if (attached.serial !== `xsticky${slot}`)
        throw Error("block_serial_invalid");
      const device = `/dev/disk/by-id/virtio-${attached.serial}`;
      await waitDevice(device);
      let type;
      try {
        type = await run("sudo", ["blkid", "-o", "value", "-s", "TYPE", device]);
      } catch (error) {
        if (error.code !== 2)
          throw error;
        type = "";
      }
      const uid = await run("id", ["-u"]), gid = await run("id", ["-g"]);
      if (type.trim() === "ext4")
        await run("sudo", ["resize2fs", "-f", device]);
      else
        await run("sudo", ["mkfs.ext4", "-m0", "-E", `root_owner=${uid}:${gid},nodiscard,lazy_itable_init=1,lazy_journal_init=1`, "-F", device]);
      await run("sudo", ["mkdir", "-p", disk.mount]);
      await run("sudo", ["mount", "-t", "ext4", device, disk.mount]);
      disk.mounted = true;
      if (type.trim() !== "ext4")
        await run("sudo", ["rmdir", path4.join(disk.mount, "lost+found")]);
      await run("sudo", ["chown", `${uid}:${gid}`, disk.mount]);
      log(`XENOCI_STICKY_MOUNTED generation=${lease.generation} filesystem=ext4 transport=block attach_ms=${Date.now() - started}`);
      return disk;
    } catch (error) {
      await detach(lease, disk, false);
      throw error;
    }
  };
  const detach = async (lease, disk, commit) => {
    if (disk.detached)
      return { committed: false };
    if (disk.mounted) {
      await run("sudo", ["sync", "-f", disk.mount]);
      for (let attempt = 0;; attempt++) {
        try {
          await run("sudo", ["umount", disk.mount]);
          break;
        } catch (error) {
          if (attempt === 2)
            throw error;
        }
      }
      disk.mounted = false;
    }
    const result = await call({ op: "detach", detach: lease.block.detach, slot: disk.slot, commit: commit && lease.mode === "write" });
    disk.detached = true;
    await fs5.rm(disk.slotFile);
    if (lease.mode === "read")
      log("::notice::읽기 전용 스티키 디스크의 변경 사항은 저장되지 않고 폐기됩니다");
    return result;
  };
  return { attach, detach };
}
function createLinuxCheckoutRuntime(config, {
  cacheFor = (mode) => createBuilderCache({ ...config, mode }),
  disk = createLinuxBlockDisk()
} = {}) {
  return {
    async begin({ key, kind = "checkout", mode = "read" }) {
      const cache = cacheFor(mode);
      const lease = await cache.acquire(key, { kind, transport: "block", fs: "ext4" });
      if (!lease.block) {
        await cache.release(lease);
        throw Error("block_unavailable");
      }
      let attached;
      try {
        attached = await disk.attach(lease, path4.join(process.env.RUNNER_TEMP || os.tmpdir(), "xenoci-checkout-mirror"));
      } catch (error) {
        await cache.release(lease);
        throw error;
      }
      return { lease, disk: attached, mounted: { mode: lease.mode, mount: attached.mount } };
    },
    async finish(job, { succeeded }) {
      const receipt = await disk.detach(job.lease, job.disk, succeeded === true);
      return receipt.committed ? cacheFor(job.lease.mode).commitBlock(job.lease, receipt) : { committed: false };
    },
    release: (job) => cacheFor(job.lease.mode).release(job.lease),
    async cleanup(job) {
      if (!job.disk.detached)
        await disk.detach(job.lease, job.disk, false);
    }
  };
}

// actions/checkout/post.mjs
var env = process.env;
var here = path5.dirname(fileURLToPath(import.meta.url));
if ((env.HTTPS_PROXY || env.https_proxy) && !process.execArgv.includes("--use-env-proxy")) {
  const child = spawn2(process.execPath, ["--use-env-proxy", ...process.execArgv, ...process.argv.slice(1)], { env, stdio: "inherit" });
  child.once("close", (code) => process.exit(code ?? 1));
} else {
  process.exitCode = await runPost({
    env,
    log: (line) => console.log(line),
    upstream: upstreamRunner(path5.join(here, "upstream", "index.cjs")),
    runtimeFor: (config) => (process.platform === "linux" ? createLinuxCheckoutRuntime : createMacStickyJobRuntime)({ ...config, capability: env.XENOCI_CACHE_JOB_CAPABILITY })
  }).catch((error) => {
    console.log(`::warning::${error.message}`);
    return 0;
  });
}
