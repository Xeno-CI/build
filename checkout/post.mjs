// actions/checkout/post.mjs
import path4 from "node:path";
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
  const endpoint = `/api/runner/v1/organizations/${encodeURIComponent(orgPublicId)}/cache/leases`;
  const api = async (route, body) => {
    const response = await fetchImpl(requestUrl(new URL(route, base)), {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${capability}`, "Content-Type": "application/json" },
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
    const lease = await request(mode).catch((error) => {
      if (mode !== "write" || error.status !== 402)
        throw error;
      mode = "read";
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
          const response = await fetchImpl(signedUrl(lease.read_url), { redirect: "error" });
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
      return { lease, mounted, maxBytes, localId, restored, source, downloadMs, downloadBytes };
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
      const response = await fetchImpl(signedUrl(job.lease.write_url), {
        method: "PUT",
        redirect: "error",
        body: createReadStream(archive),
        duplex: "half",
        headers: { "content-length": String(receipt.bytes) }
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

// actions/checkout/post.mjs
var env = process.env;
var here = path4.dirname(fileURLToPath(import.meta.url));
if ((env.HTTPS_PROXY || env.https_proxy) && !process.execArgv.includes("--use-env-proxy")) {
  const child = spawn2(process.execPath, ["--use-env-proxy", ...process.execArgv, ...process.argv.slice(1)], { env, stdio: "inherit" });
  child.once("close", (code) => process.exit(code ?? 1));
} else {
  process.exitCode = await runPost({
    env,
    log: (line) => console.log(line),
    upstream: upstreamRunner(path4.join(here, "upstream", "index.cjs")),
    runtimeFor: (config) => createMacStickyJobRuntime({ ...config, capability: env.XENOCI_CACHE_JOB_CAPABILITY })
  }).catch((error) => {
    console.log(`::warning::${error.message}`);
    return 0;
  });
}
