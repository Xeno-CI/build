// actions/checkout/main.mjs
import fs4 from "node:fs/promises";
import path4 from "node:path";
import { spawn as spawn2 } from "node:child_process";
import { fileURLToPath } from "node:url";

// actions/checkout/mirror-checkout.mjs
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
var MIRROR_KEY = "git-mirror";
var ROOM_CODES = new Set(["sticky_capacity_full", "sticky_org_full"]);
var UNSUPPORTED = ["ssh-key", "filter"];
var input = (env, name) => String(env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "").trim();
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
function ineligible(env, config) {
  if (!config || !env.XENOCI_CACHE_JOB_CAPABILITY)
    return "not_xenoci_runner";
  const repository = input(env, "repository") || env.GITHUB_REPOSITORY || "";
  if (repository.toLowerCase() !== String(config.repo ?? "").toLowerCase())
    return "other_repository";
  const server = input(env, "github-server-url");
  if (server && server.replace(/\/+$/, "") !== "https://github.com")
    return "github_server_url";
  for (const name of UNSUPPORTED)
    if (input(env, name))
      return name;
  return null;
}
async function emptyTarget(env) {
  const workspace = env.GITHUB_WORKSPACE;
  if (!workspace || !path.isAbsolute(workspace))
    return null;
  const target = path.resolve(workspace, input(env, "path") || ".");
  if (target !== workspace && !target.startsWith(`${workspace}${path.sep}`))
    return null;
  const entries = await fs.readdir(target).catch((error) => error.code === "ENOENT" ? [] : null);
  return entries && entries.length === 0 ? target : null;
}
async function clear(target) {
  for (const name of await fs.readdir(target).catch(() => []))
    await fs.rm(path.join(target, name), { recursive: true, force: true });
}
async function runMain({ env, upstream, openRuntime, saveState, log, now = Date.now, originUrl = (repo) => `https://github.com/${repo}` }) {
  const started = now();
  let config = null;
  try {
    config = JSON.parse(env.XENOCI_STICKY_CONFIG ?? "null");
  } catch {
    config = null;
  }
  const reason = ineligible(env, config);
  const target = reason ? null : await emptyTarget(env);
  const plain = async (why) => {
    const code2 = await upstream(env);
    log(`XENOCI_CHECKOUT cache=off reason=${why} checkout_ms=${now() - started} exit=${code2}`);
    return code2;
  };
  if (reason)
    return plain(reason);
  if (!target)
    return plain("path_not_empty");
  const repository = input(env, "repository") || env.GITHUB_REPOSITORY;
  const token = input(env, "token");
  let runtime, prepared = null, job = null, mode = config.mode === "write" ? "write" : "read";
  try {
    ({ runtime, config: prepared } = await openRuntime(config));
    const begin = (m) => runtime.begin({ key: MIRROR_KEY, kind: "checkout", maxBytes: config.maxBytes, mode: m });
    job = await begin(mode).catch((error) => {
      if (mode !== "write" || error.status !== 403)
        throw error;
      mode = "read";
      return begin("read");
    });
    mode = job.mounted.mode;
  } catch (error) {
    if (ROOM_CODES.has(error.message))
      log("::notice::Git 체크아웃 캐시를 둘 스티키 디스크 자리가 없어 이번 잡은 일반 체크아웃으로 받았어요");
    else if (error.message === "sticky_disks_preparing")
      log("::notice::Git 체크아웃 캐시는 준비 중이라 이번 잡은 일반 체크아웃으로 받았어요");
    else if (error.message !== "not_found")
      log(`::warning::Git 체크아웃 캐시를 쓰지 못해 일반 체크아웃으로 받았어요 (${error.message})`);
    if (prepared?.root)
      await fs.rm(prepared.root, { recursive: true, force: true }).catch(() => {});
    return plain(error.message === "not_found" ? "no_mirror" : error.message);
  }
  await saveState("XENOCI_CHECKOUT_JOB", JSON.stringify({ job, config: prepared }));
  const mirror = path.join(job.mounted.mount, "mirror.git");
  let fetchMs = 0, seeded = false;
  try {
    if (mode === "write") {
      const fetchStarted = now();
      if (await fs.stat(path.join(mirror, "objects")).catch(() => null) === null && (await git(["init", "-q", "--bare", mirror])).code !== 0)
        throw new Error("mirror_init_failed");
      const fetched = await git([
        "--git-dir",
        mirror,
        "-c",
        "gc.auto=0",
        "fetch",
        "--quiet",
        "--no-tags",
        "--prune",
        "--",
        originUrl(repository),
        `+${config.ref}:refs/heads/mirror`
      ], { token });
      fetchMs = now() - fetchStarted;
      if (fetched.code !== 0)
        throw new Error("mirror_fetch_failed");
      await saveState("XENOCI_CHECKOUT_COMMIT", "1");
    }
    const head = await git(["--git-dir", mirror, "rev-parse", "--verify", "--quiet", "refs/heads/mirror^{commit}"]);
    if (head.code !== 0 || !/^[0-9a-f]{40}$/.test(head.stdout))
      throw new Error("mirror_empty");
    const [owner, name] = repository.split("/");
    const setup = [["init", "-q", target], ["-C", target, "remote", "add", "origin", `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`]];
    for (const args of setup)
      if ((await git(args)).code !== 0)
        throw new Error("prepare_failed");
    await fs.writeFile(path.join(target, ".git", "objects", "info", "alternates"), `${path.join(mirror, "objects")}
`);
    if ((await git(["-C", target, "update-ref", "--no-deref", "HEAD", head.stdout])).code !== 0)
      throw new Error("prepare_failed");
    seeded = true;
  } catch (error) {
    await clear(target);
    log(`::warning::Git 체크아웃 캐시를 쓰지 못해 일반 체크아웃으로 받았어요 (${error.message})`);
    return plain(error.message);
  }
  const code = await upstream({ ...env, INPUT_CLEAN: "false" });
  if (code === 0) {
    const repo = target;
    const repacked = await git(["-C", repo, "repack", "-a", "-d", "-q"]);
    if (repacked.code === 0)
      await fs.rm(path.join(repo, ".git", "objects", "info", "alternates"), { force: true });
    const whole = repacked.code === 0 && (await git(["-C", repo, "fsck", "--connectivity-only", "--no-dangling"])).code === 0;
    if (!whole) {
      await clear(target);
      log("::warning::Git 체크아웃 캐시에서 받은 저장소를 정리하지 못해 일반 체크아웃으로 다시 받았어요");
      return plain("dissociate_failed");
    }
    log(`XENOCI_CHECKOUT cache=${mode === "write" ? "update" : "hit"} mirror_fetch_ms=${fetchMs} checkout_ms=${now() - started} exit=0`);
    return 0;
  }
  await clear(target);
  log("::warning::Git 체크아웃 캐시로 받지 못해 일반 체크아웃으로 다시 받았어요");
  return plain(seeded ? "mirror_checkout_failed" : "mirror_failed");
}
function upstreamRunner(script) {
  return (env) => new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { env, stdio: "inherit" });
    child.once("error", () => resolve(1));
    child.once("close", (code) => resolve(code ?? 1));
  });
}
async function runtimeConfig(env, config) {
  const root = await fs.mkdtemp(path.join(env.RUNNER_TEMP || os.tmpdir(), "xenoci-checkout-"));
  let gateway = config.gateway ?? null;
  if (!gateway) {
    const verdict = await fs.readFile(path.join(os.homedir(), ".xenoci-results-url"), "utf8").catch(() => "");
    if (verdict.trim() === "http://artifacts.ci.xeno/")
      gateway = "http://artifacts.ci.xeno/";
  }
  return { ...config, root, gateway, guestLocal: true };
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
  const input2 = await fs3.open(archive, "r"), seen = new Set;
  let offset = 0, total = 0;
  const read = async (size) => {
    const data = Buffer.alloc(size);
    let position = 0;
    while (position < size) {
      const n = await input2.read(data, position, size - position, offset);
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
    const size = (await input2.stat()).size;
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
    await input2.close();
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

// actions/checkout/main.mjs
var env = process.env;
var here = path4.dirname(fileURLToPath(import.meta.url));
if ((env.HTTPS_PROXY || env.https_proxy) && !process.execArgv.includes("--use-env-proxy")) {
  const child = spawn2(process.execPath, ["--use-env-proxy", ...process.execArgv, ...process.argv.slice(1)], { env, stdio: "inherit" });
  child.once("close", (code) => process.exit(code ?? 1));
} else {
  if (env.XENOCI_CACHE_JOB_CAPABILITY)
    console.log(`::add-mask::${env.XENOCI_CACHE_JOB_CAPABILITY}`);
  process.exitCode = await runMain({
    env,
    log: (line) => console.log(line),
    upstream: upstreamRunner(path4.join(here, "upstream", "index.cjs")),
    saveState: (name, value) => fs4.appendFile(env.GITHUB_STATE, `${name}=${value}
`),
    openRuntime: async (config) => {
      const prepared = await runtimeConfig(env, config);
      return { config: prepared, runtime: createMacStickyJobRuntime({ ...prepared, capability: env.XENOCI_CACHE_JOB_CAPABILITY }) };
    }
  }).catch((error) => {
    console.log(`::error::${error.message}`);
    return 1;
  });
}
