// integrations/stickydisk/index.mjs
import fs3 from "node:fs/promises";
import path3 from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { once as once2 } from "node:events";

// server/ci/runner2-cache-runtime.js
import fs2 from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path2 from "node:path";
import crypto2 from "node:crypto";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

// server/ci/runner2-cache-mac.js
import fs from "node:fs/promises";
import path from "node:path";
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
  if (!path.isAbsolute(root))
    throw new Error("APFS cache root must be absolute");
  const diskPath = (diskId, generation) => {
    identifier(diskId);
    if (!Number.isSafeInteger(generation) || generation < 0)
      throw new Error("invalid cache generation");
    return path.join(root, `${diskId}.${generation}.sparsebundle`);
  };
  const leasePath = (leaseId) => path.join(root, identifier(leaseId));
  const command = (exe, args) => run(exe, args, { timeout: 120000, maxBuffer: 1024 * 1024, env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: root } });
  const create = async ({ diskId, maxBytes, generation = 0 }) => {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 32 * 1024 ** 2)
      throw new Error("APFS capacity must be at least 32 MiB");
    const target = diskPath(diskId, generation);
    await fs.mkdir(root, { recursive: true, mode: 448 });
    await command("/usr/bin/hdiutil", ["create", "-size", `${Math.ceil(maxBytes / 512)}b`, "-fs", "APFS", "-type", "SPARSEBUNDLE", "-volname", "XenoCI Cache", target]);
    return { path: target };
  };
  const attach = async ({ diskId, generation, leaseId, mode }) => {
    if (!["read", "write"].includes(mode))
      throw new Error("invalid cache lease mode");
    const owned = leasePath(leaseId), image = path.join(owned, "cache.sparsebundle"), mount = path.join(owned, "mount");
    await fs.mkdir(owned, { mode: 448 });
    await fs.mkdir(mount);
    try {
      await command("/bin/cp", ["-c", "-R", diskPath(diskId, generation), image]);
      await command("/usr/bin/hdiutil", ["attach", "-nobrowse", "-noautoopen", "-mountpoint", mount, ...mode === "read" ? ["-readonly"] : [], image]);
      return { diskId, generation, leaseId, mode, image, mount };
    } catch (error) {
      const { stdout } = await command("/sbin/mount", []);
      if (!stdout.includes(` on ${mount} (`))
        await fs.rm(owned, { recursive: true, force: true });
      throw error;
    }
  };
  const detach = async (lease) => {
    if (lease.mount !== path.join(leasePath(lease.leaseId), "mount"))
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
      for (const name of (await fs.readdir(directory)).sort()) {
        const full = path.join(directory, name), rel = path.join(relative, name), stat = await fs.lstat(full);
        if (stat.isSymbolicLink())
          throw new Error("cache image contains symlink");
        if (stat.isDirectory())
          await walk(full, rel);
        else if (stat.isFile()) {
          const data = await fs.readFile(full);
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
    if (lease.image !== path.join(leasePath(lease.leaseId), "cache.sparsebundle"))
      throw new Error("foreign cache image");
    await detach(lease);
    const measured = await measure(lease.image), target = diskPath(lease.diskId, lease.generation + 1);
    await fs.mkdir(`${target}.claim`);
    try {
      await fs.rename(lease.image, target);
    } finally {
      await fs.rmdir(`${target}.claim`);
    }
    await fs.rm(leasePath(lease.leaseId), { recursive: true });
    return { generation: lease.generation + 1, ...measured, path: target };
  };
  const release = async (lease) => {
    await detach(lease);
    await fs.rm(leasePath(lease.leaseId), { recursive: true });
    return { unmounted: true };
  };
  const remove = async ({ diskId, activeLeases }) => {
    identifier(diskId);
    if (activeLeases !== 0)
      throw new Error("active cache lease cannot be evicted");
    const { stdout } = await command("/sbin/mount", []);
    if (stdout.includes(root))
      throw new Error("cache mount exists; refuse image deletion");
    for (const name of await fs.readdir(root))
      if (name.startsWith(`${diskId}.`) && name.endsWith(".sparsebundle"))
        await fs.rm(path.join(root, name), { recursive: true });
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
    for (const name of (await fs2.readdir(image)).sort()) {
      if (name === "lock")
        continue;
      if (name === "bands") {
        const stat = await fs2.lstat(path2.join(image, name));
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new Error("unsafe sparsebundle bands");
      }
      const names = name === "bands" ? (await fs2.readdir(path2.join(image, name))).sort().map((band) => `bands/${band}`) : [name];
      for (const relative of names) {
        if (!fileName.test(relative))
          throw new Error(`unexpected sparsebundle file: ${JSON.stringify(relative.slice(0, 80))}`);
        const full = path2.join(image, relative), stat = await fs2.lstat(full);
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
    await fs2.rm(target, { force: true });
    throw error;
  }
}
async function restoreMacCacheImage(archive, target, maxBytes) {
  const input = await fs2.open(archive, "r"), seen = new Set;
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
  await fs2.mkdir(target, { mode: 448 });
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
        await fs2.mkdir(path2.join(target, "bands"), { recursive: true, mode: 448 });
      const output = await fs2.open(path2.join(target, relative), "wx", 384);
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
    await fs2.rm(target, { recursive: true, force: true });
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
  if (base.protocol !== "https:" || base.username || base.password || !path2.isAbsolute(root))
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
  const begin = async ({ key, maxBytes, mode = "write", kind = "sticky" }) => {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 32 * 1024 ** 2)
      throw new Error("invalid cache image capacity");
    const request = (m) => api(endpoint, { kind, repo, key, ref, mode: m, job_id: jobPublicId });
    let readOnly = null;
    const lease = await request(mode).catch((error) => {
      if (mode !== "write" || error.status !== 402)
        throw error;
      mode = "read";
      readOnly = error.message;
      return request("read");
    });
    const localId = `disk_${crypto2.createHash("sha256").update(`${orgPublicId}\x00${repo}\x00${kind === "sticky" ? "" : `${kind}\x00`}${key}`).digest("hex")}`;
    await fs2.mkdir(root, { recursive: true, mode: 448 });
    const archive = path2.join(root, `${lease.lease_id}.download`), image = path2.join(root, `${localId}.${lease.generation}.sparsebundle`);
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
          await fs2.rm(archive, { force: true });
          await fs2.rm(image, { recursive: true, force: true });
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
      await fs2.rm(archive, { force: true });
    }
  };
  const finish = async (job, { succeeded, stopped, jobCompleted = false }) => {
    if (stopped !== true && !(guestLocal && jobCompleted === true))
      throw new Error("guest must be stopped or guest-local job completed before sticky finalization");
    if (!succeeded || job.mounted.mode === "read") {
      await adapter.release(job.mounted);
      return { committed: false };
    }
    const published = await adapter.publish(job.mounted, { stopped, jobCompleted }), archive = path2.join(root, `${job.lease.lease_id}.upload`);
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
      await fs2.rm(archive, { force: true });
    }
  };
  const release = async (job) => api(`${endpoint}/${encodeURIComponent(job.lease.lease_id)}/release`, {});
  const cleanup = async (job, { activeLeases }) => adapter.remove({ diskId: job.localId, activeLeases });
  return { begin, finish, release, cleanup };
}

// integrations/stickydisk/index.mjs
var env = process.env;
var ROOM = {
  sticky_capacity_full: "지금은 스티키 디스크 자리가 없어요. 이번 잡은 스티키 디스크 없이 진행돼요",
  sticky_org_full: "조직의 스티키 디스크가 최대 용량에 이르렀어요. 이번 잡은 스티키 디스크 없이 진행돼요"
};
var READ_ONLY = { insufficient_credit: "잔액이 없어 스티키 디스크가 읽기 전용입니다, 충전하면 다시 쓸 수 있어요" };
if ((env.HTTPS_PROXY || env.https_proxy) && !process.execArgv.includes("--use-env-proxy")) {
  const child = spawn(process.execPath, ["--use-env-proxy", ...process.execArgv, ...process.argv.slice(1)], { env, stdio: "inherit" });
  const [code] = await once2(child, "close");
  process.exit(code ?? 1);
}
try {
  if (env.STATE_XENOCI_STICKY_STARTED && !env.STATE_XENOCI_STICKY_STATE)
    process.exit(0);
  const config = JSON.parse(env.XENOCI_STICKY_CONFIG ?? "null");
  if (!config || !/^https:\/\/[^/]+$/.test(config.origin ?? "") || !env.XENOCI_CACHE_JOB_CAPABILITY)
    throw new Error("Sticky disks require a XenoCI runner");
  if (!config.gateway) {
    const verdict = await fs3.readFile(path3.join(os.homedir(), ".xenoci-results-url"), "utf8").catch(() => "");
    if (verdict.trim() === "http://artifacts.ci.xeno/")
      config.gateway = "http://artifacts.ci.xeno/";
  }
  console.log(`::add-mask::${env.XENOCI_CACHE_JOB_CAPABILITY}`);
  const stateFile = env.STATE_XENOCI_STICKY_STATE;
  if (stateFile) {
    const { job, mountPath, config: savedConfig } = JSON.parse(await fs3.readFile(stateFile, "utf8"));
    const runtime = createMacStickyJobRuntime({ ...savedConfig, capability: env.XENOCI_CACHE_JOB_CAPABILITY });
    let receipt = { committed: false };
    try {
      receipt = await runtime.finish(job, { succeeded: true, jobCompleted: true });
    } catch (error) {
      if (ROOM[error.message])
        console.log(`::notice::${ROOM[error.message]}`);
      else
        console.log(`::warning::Sticky disk was not saved this time: ${error.message}`);
    } finally {
      await runtime.release(job);
      if (await fs3.readlink(mountPath) !== job.mounted.mount)
        throw new Error("Sticky disk path changed; refusing cleanup");
      await fs3.unlink(mountPath);
      await runtime.cleanup(job, { activeLeases: 0 });
      await fs3.rm(savedConfig.root, { recursive: true });
    }
    console.log(`XENOCI_STICKY_COMMITTED generation=${receipt.generation ?? job.lease.generation} filesystem=APFS committed=${receipt.committed}`);
  } else {
    await fs3.appendFile(env.GITHUB_STATE, `XENOCI_STICKY_STARTED=true
`);
    const { INPUT_KEY: key, INPUT_PATH: input } = env;
    if (!key || !input || /[\r\n\0]/.test(input))
      throw new Error("key and path are required");
    const mountPath = path3.resolve(env.GITHUB_WORKSPACE, input.startsWith("~/") ? path3.join(os.homedir(), input.slice(2)) : input);
    const existing = await fs3.lstat(mountPath).catch((error) => {
      if (error.code !== "ENOENT")
        throw error;
      return null;
    });
    if (existing) {
      if (!existing.isDirectory() || (await fs3.readdir(mountPath)).length)
        throw new Error("Sticky disk path must be absent or an empty directory");
      await fs3.rmdir(mountPath);
    }
    const root = await fs3.mkdtemp(path3.join(env.RUNNER_TEMP, "xenoci-sticky-"));
    const runtimeConfig = { ...config, root, guestLocal: true }, runtime = createMacStickyJobRuntime({
      ...runtimeConfig,
      capability: env.XENOCI_CACHE_JOB_CAPABILITY,
      log: (line) => console.log(`::warning::${line}`)
    });
    let job;
    try {
      job = await runtime.begin({ key, maxBytes: config.maxBytes, mode: config.mode });
    } catch (error) {
      await fs3.rm(root, { recursive: true, force: true });
      await fs3.mkdir(mountPath, { recursive: true });
      if (error.message === "sticky_disks_preparing")
        console.log("::notice::스티키 디스크는 준비 중이라 이번 잡은 디스크 없이 돌았습니다");
      else if (ROOM[error.message])
        console.log(`::notice::${ROOM[error.message]}`);
      else
        console.log(`::warning::Sticky disk unavailable, continuing with an empty directory: ${error.message}`);
      process.exit(0);
    }
    await fs3.mkdir(path3.dirname(mountPath), { recursive: true });
    await fs3.symlink(job.mounted.mount, mountPath);
    const state = path3.join(root, "state.json");
    await fs3.writeFile(state, JSON.stringify({ job, mountPath, config: runtimeConfig }), { mode: 384 });
    await fs3.appendFile(env.GITHUB_STATE, `XENOCI_STICKY_STATE=${state}
`);
    if (job.readOnly)
      console.log(`::notice::${READ_ONLY[job.readOnly] ?? READ_ONLY.insufficient_credit}`);
    console.log(`XENOCI_STICKY_MOUNTED generation=${job.lease.generation} filesystem=APFS mode=${job.mounted.mode} restored=${job.restored} source=${job.source} bytes=${job.downloadBytes} download_ms=${job.downloadMs}`);
  }
} catch (error) {
  console.error(`::error::${error.message}${error.cause?.code ? ` (${error.cause.code})` : ""}`);
  process.exitCode = 1;
}
