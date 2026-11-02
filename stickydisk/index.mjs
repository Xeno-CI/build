var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// integrations/docker-builder/cache.mjs
import fs3 from "node:fs";
import fsp from "node:fs/promises";
import crypto3 from "node:crypto";
import http2 from "node:http";
import { Transform } from "node:stream";
import { pipeline as pipeline2 } from "node:stream/promises";
function httpGetBody(url, { headers = {}, timeoutMs }) {
  return new Promise((resolve, reject) => {
    if (url.protocol !== "http:")
      return reject(Error("httpGetBody: http only"));
    const req = http2.get(url, { headers, timeout: timeoutMs }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume();
        return reject(Error("cache download redirected"));
      }
      resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (k) => res.headers[String(k).toLowerCase()] ?? null },
        body: Object.assign(res, { cancel: async () => res.destroy() })
      });
    });
    req.on("timeout", () => req.destroy(Error("cache download timed out")));
    req.on("error", reject);
  });
}
async function archiveDigest(file, maxBytes = MAX_ARCHIVE_BYTES) {
  const hash = crypto3.createHash("sha256");
  let bytes = 0;
  for await (const chunk of fs3.createReadStream(file)) {
    bytes += chunk.length;
    if (bytes > maxBytes)
      throw Error("cache archive exceeds capacity");
    hash.update(chunk);
  }
  return { bytes, digest: hash.digest("hex") };
}
function createBuilderCache(config, { fetchImpl = fetch, getBody = null, now = Date.now, maxBytes = MAX_ARCHIVE_BYTES, timeoutMs = 120000 } = {}) {
  const base = new URL(config.origin);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash)
    throw Error("invalid cache origin");
  if (!config.capability || !config.orgPublicId || !config.jobPublicId || !config.repo || !config.ref)
    throw Error("missing job cache grant");
  if (!["read", "write"].includes(config.mode))
    throw Error("invalid cache mode");
  const transport = config.gateway ? new URL(config.gateway) : base;
  if (config.gateway && !/^http:\/\/artifacts\.ci\.xeno(?::\d{2,5})?\/$/.test(transport.href))
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
    if (url.origin === "http://sticky.ci.xeno" && /^\/objects\/[A-Za-z0-9_-]{8,100}$/.test(url.pathname)) {
      if (config.stickyPort)
        url.port = String(config.stickyPort);
      return url;
    }
    if (url.origin !== base.origin || url.pathname !== "/api/runner/v1/cache/blobs")
      throw Error("foreign cache blob origin");
    return new URL(url.pathname + url.search, transport);
  };
  const acquire = async (key, { kind = "sticky", readFallback = true, ...options } = {}) => {
    const request = (mode2) => api("", { kind, repo: config.repo, key, ref: config.ref, mode: mode2, job_id: config.jobPublicId, ...options });
    let mode = config.mode, lease, fallback = null;
    try {
      lease = await request(mode);
    } catch (error) {
      if (!readFallback || mode !== "write" || !["writer_busy", "untrusted_ref", "insufficient_credit"].includes(error.message))
        throw error;
      mode = "read";
      fallback = error.message;
      lease = await request(mode);
    }
    if (!/^lease_[A-Za-z0-9_-]{8,80}$/.test(lease.lease_id) || !Number.isSafeInteger(lease.generation) || lease.generation < 0)
      throw Error("invalid cache lease");
    return { ...lease, mode: lease.mode ?? mode, ...fallback ? { fallback } : {} };
  };
  const restore = async (lease, file) => {
    if (!lease.generation || !lease.read_url)
      return false;
    const url = blobUrl(lease.read_url);
    const viaHttp = getBody ?? (fetchImpl === fetch && url.protocol === "http:" ? httpGetBody : null);
    const response = viaHttp ? await viaHttp(url, { headers: headers(url), timeoutMs }) : await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(timeoutMs), headers: headers(url) });
    if (!response.ok || Number(response.headers.get("content-length")) > maxBytes) {
      await response.body?.cancel();
      throw Error("cache download rejected");
    }
    let bytes = 0;
    try {
      await pipeline2(response.body, new Transform({ transform(chunk, _encoding, done) {
        bytes += chunk.length;
        done(bytes > maxBytes ? Error("cache archive exceeds capacity") : null, chunk);
      } }), fs3.createWriteStream(file, { flags: "wx", mode: 384 }));
      const receipt = await archiveDigest(file, maxBytes);
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
    const receipt = await archiveDigest(file, maxBytes), url = blobUrl(lease.write_url);
    const body = fs3.createReadStream(file);
    try {
      const response = await fetchImpl(url, {
        method: "PUT",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
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
    return api(`/${encodeURIComponent(lease.lease_id)}/commit`, {
      generation: lease.generation,
      bytes: receipt.bytes,
      digest: receipt.sha256,
      ...Number.isSafeInteger(receipt.usedBytes) && receipt.usedBytes >= 0 ? { used_bytes: receipt.usedBytes } : {}
    });
  };
  return { acquire, restore, commit, commitBlock, release: (lease, body = {}) => api(`/${encodeURIComponent(lease.lease_id)}/release`, body) };
}
var MAX_ARCHIVE_BYTES;
var init_cache = __esm(() => {
  MAX_ARCHIVE_BYTES = 1024 ** 3;
});

// integrations/stickydisk/commit-policy.mjs
import fs6 from "node:fs/promises";
import path5 from "node:path";
import { execFile as execFile3 } from "node:child_process";
import { promisify as promisify3 } from "node:util";
function commitMode(input, { warn = () => {} } = {}) {
  const value = String(input ?? "").trim().toLowerCase() || "true";
  if (COMMIT_MODES.includes(value))
    return value;
  warn(`commit: '${String(input).slice(0, 40)}' is not one of ${COMMIT_MODES.join(", ")}; the disk is saved as with 'true'`);
  return "true";
}
async function usedBytes(dir, { statfs = fs6.statfs } = {}) {
  try {
    const s = await statfs(dir);
    const used = (Number(s.blocks) - Number(s.bfree)) * Number(s.bsize);
    return Number.isFinite(used) && used >= 0 ? used : null;
  } catch {
    return null;
  }
}
async function earlierSteps(dirs) {
  let newest = null;
  for (const dir of dirs) {
    for (const name of await fs6.readdir(dir).catch(() => [])) {
      if (!/^Worker_[\w.-]+\.log$/.test(name))
        continue;
      const st = await fs6.stat(path5.join(dir, name)).catch(() => null);
      if (st?.isFile() && (!newest || st.mtimeMs > newest.mtimeMs))
        newest = { file: path5.join(dir, name), mtimeMs: st.mtimeMs };
    }
  }
  if (!newest)
    return { state: "unavailable", failed: 0 };
  const text = await fs6.readFile(newest.file, "utf8").catch(() => null);
  if (text == null)
    return { state: "unavailable", failed: 0 };
  const failed = [...text.matchAll(/\bStep result: (\w+)/g)].filter((m) => /^(failed|cancell?ed)$/i.test(m[1])).length;
  return { state: failed ? "failed" : "ok", failed };
}
function runnerDiagDirs({ home, workspace }) {
  const dirs = [path5.join(home, "actions-runner", "_diag")];
  const at = String(workspace ?? "").indexOf(`${path5.sep}_work${path5.sep}`);
  if (at > 0)
    dirs.push(path5.join(workspace.slice(0, at), "_diag"));
  return [...new Set(dirs)];
}
function decideCommit({ mode = "true", generation, usedAtMount = null, usedNow = null, steps = { state: "unavailable" } }) {
  if (mode === "false")
    return { commit: false, reason: "commit_false" };
  if (mode === "if-missing" && Number(generation) > 0)
    return { commit: false, reason: "exists" };
  if (mode === "on-change" && usedAtMount != null && usedNow != null && Math.abs(usedNow - usedAtMount) <= UNCHANGED_SLACK_BYTES)
    return { commit: false, reason: "unchanged" };
  if (steps.state === "failed")
    return { commit: false, reason: "prior_step_failed" };
  return { commit: true, reason: "" };
}
async function postDecision({
  saved,
  generation,
  mountDir,
  writable = true,
  home,
  workspace,
  log = console.log,
  statfs,
  flush = () => exec2("sync", [], { timeout: 60000 })
}) {
  const mode = saved?.mode ?? "true";
  if (mode === "on-change")
    await flush().catch(() => {});
  const decision = decideCommit({
    mode,
    generation,
    usedAtMount: saved?.usedAtMount ?? null,
    usedNow: mode === "on-change" ? await usedBytes(mountDir, { statfs }) : null,
    steps: await earlierSteps(runnerDiagDirs({ home, workspace }))
  });
  if (writable && !decision.commit)
    log(`::notice::${SKIP_NOTICE[decision.reason]}`);
  return decision;
}
async function mountPolicy(mode, mountDir, { statfs } = {}) {
  return { mode, usedAtMount: mode === "on-change" ? await usedBytes(mountDir, { statfs }) : null };
}
var exec2, COMMIT_MODES, UNCHANGED_SLACK_BYTES = 4096, SKIP_NOTICE;
var init_commit_policy = __esm(() => {
  exec2 = promisify3(execFile3);
  COMMIT_MODES = Object.freeze(["true", "false", "on-change", "if-missing"]);
  SKIP_NOTICE = Object.freeze({
    commit_false: "commit: false 라 스티키 디스크의 변경 사항을 저장하지 않았어요",
    exists: "commit: if-missing 이고 이미 저장된 디스크라 이번 변경은 저장하지 않았어요",
    unchanged: "스티키 디스크 내용이 바뀌지 않아 저장을 건너뛰었어요",
    prior_step_failed: "앞 단계가 실패하거나 취소돼 스티키 디스크를 저장하지 않았어요, 다음 잡은 마지막으로 저장된 디스크로 시작해요"
  });
});

// integrations/stickydisk/mac-block.mjs
import fs7 from "node:fs/promises";
import { execFile as execFile4 } from "node:child_process";
import { promisify as promisify4 } from "node:util";
async function slotDevice(slot, {
  list = () => run("diskutil", ["list", "-plist", "physical"]),
  info = (d) => run("diskutil", ["info", "-plist", d]),
  plist = (xml, key) => run("plutil", ["-extract", key, "raw", "-o", "-", "-"]).catch(() => null)
} = {}) {
  const disks = (await list()).match(/<string>(disk\d+)<\/string>/g)?.map((s) => s.replace(/<\/?string>/g, "")) ?? [];
  const sized = [];
  for (const d2 of [...new Set(disks)]) {
    const xml = await info(d2);
    const size = Number(/<key>TotalSize<\/key>\s*<integer>(\d+)<\/integer>/.exec(xml)?.[1]);
    const system = /<key>OSInternalMedia<\/key>\s*<true\/>/.test(xml);
    if (SLOT_SIZES.includes(size) && !system)
      sized.push(d2);
  }
  sized.sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  const d = sized[slot - 1];
  if (!d)
    throw Error("mac_block_slot_missing");
  return `/dev/${d}`;
}
function createMacBlockDisk({ fetchImpl = fetch, cmd = run, device = slotDevice, log = console.log } = {}) {
  const call = async (signedPath, body) => {
    const url = new URL(signedPath, MAC_BLOCK_PIN);
    if (url.origin !== MAC_BLOCK_PIN || !/^\/block\/(attach|detach)\/[A-Za-z0-9_-]{8,100}$/.test(url.pathname))
      throw Error("mac_block_path_invalid");
    const r = await fetchImpl(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(60000) });
    if (!r.ok) {
      await r.body?.cancel();
      throw Error(`mac_block_${r.status}`);
    }
    return r.json();
  };
  return {
    async attach(lease, mountPath) {
      const started = Date.now(), slot = Number(String(lease.block.slot).split("-s").pop());
      const disk = { slot, mount: mountPath, mounted: false, attached: false, detached: false };
      try {
        await call(lease.block.attach, {});
        disk.attached = true;
        const dev = await device(slot);
        disk.device = dev;
        let hfs = false;
        for (let i = 0;i < 20; i++) {
          const out = await cmd("diskutil", ["list", dev]).catch(() => "");
          if (out) {
            hfs = /Apple_HFS|Journaled HFS/.test(out);
            break;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        if (!hfs)
          await cmd("sudo", ["diskutil", "eraseDisk", "JHFS+", "xenocisticky", "GPT", dev]);
        const part = `${dev}s2`;
        await cmd("sudo", ["diskutil", "unmount", part]).catch(() => "");
        await fs7.mkdir(mountPath, { recursive: true });
        const mount = () => cmd("sudo", ["diskutil", "mount", "-mountPoint", mountPath, part]);
        if (hfs && lease.generation === 0) {
          try {
            await mount();
          } catch {
            await cmd("sudo", ["diskutil", "eraseDisk", "JHFS+", "xenocisticky", "GPT", dev]);
            await cmd("sudo", ["diskutil", "unmount", part]).catch(() => "");
            await mount();
          }
        } else
          await mount();
        if (!(await cmd("mount", [])).split(`
`).some((l) => l.includes(` on ${mountPath} `)))
          throw Error("mac_block_not_mounted");
        disk.mounted = true;
        await cmd("sudo", ["chown", `${process.getuid()}:${process.getgid()}`, mountPath]);
        log(`XENOCI_STICKY_MOUNTED generation=${lease.generation} filesystem=hfs transport=block attach_ms=${Date.now() - started}`);
        return disk;
      } catch (error) {
        if (disk.attached)
          await this.detach(lease, disk, false).catch(() => {});
        throw error;
      }
    },
    async detach(lease, disk, commit) {
      if (disk.detached)
        return { committed: false };
      if (disk.mounted) {
        await cmd("sync", []).catch(() => "");
        const clean = await cmd("sudo", ["diskutil", "unmount", disk.mount]).then(() => true, () => false);
        if (!clean) {
          await cmd("sudo", ["diskutil", "unmount", "force", disk.mount]).catch(() => "");
          commit = false;
          log("XENOCI_STICKY_UNMOUNT forced=true committed=false");
        }
        disk.mounted = false;
      }
      const result = await call(lease.block.detach, { commit: commit && lease.mode === "write" });
      disk.detached = true;
      return result;
    }
  };
}
function createMacBlockRuntime({ cache, slot, disk = createMacBlockDisk() }) {
  if (!/^[a-z0-9-]{3,48}$/.test(String(slot || "")))
    throw Error("mac_block_slot_invalid");
  return {
    async begin({ key, mountPath, inputPath }) {
      const lease = await cache.acquire(key, { transport: "block", fs: "hfs", slot, path: inputPath });
      if (!lease.block) {
        await cache.release(lease);
        return null;
      }
      try {
        return { lease, disk: await disk.attach(lease, mountPath) };
      } catch (error) {
        await cache.release(lease);
        throw error;
      }
    },
    async finish(job, { jobCompleted, succeeded = true }) {
      try {
        const receipt = await disk.detach(job.lease, job.disk, jobCompleted === true && succeeded);
        return receipt.committed ? await cache.commitBlock(job.lease, receipt) : { committed: false };
      } finally {
        await cache.release(job.lease);
      }
    }
  };
}
var exec3, run = async (command, args) => (await exec3(command, args, { timeout: 120000 })).stdout.trim(), MAC_BLOCK_PIN = "http://block.ci.xeno", SLOT_SIZES;
var init_mac_block = __esm(() => {
  exec3 = promisify4(execFile4);
  SLOT_SIZES = Object.freeze([200 * 1024 ** 3, 64 * 1024 ** 3]);
});

// integrations/stickydisk/mac-block-step.mjs
var exports_mac_block_step = {};
__export(exports_mac_block_step, {
  macBlockStep: () => macBlockStep
});
import fs8 from "node:fs/promises";
import path6 from "node:path";
import os2 from "node:os";
async function macBlockStep({ env, config, stateFile, mode = "true" }) {
  const slot = (await fs8.readFile(path6.join(os2.homedir(), ".xenoci-block-slot"), "utf8").catch(() => "")).trim();
  if (!slot)
    return false;
  const mac = createMacBlockRuntime({ cache: createBuilderCache({ ...config, capability: env.XENOCI_CACHE_JOB_CAPABILITY }), slot });
  if (stateFile) {
    const saved = JSON.parse(await fs8.readFile(stateFile, "utf8"));
    if (!saved.macBlock)
      return false;
    try {
      const decision = await postDecision({
        saved: saved.policy,
        generation: saved.job.lease.generation,
        mountDir: saved.job.disk.mount,
        writable: saved.job.lease.mode === "write",
        home: os2.homedir(),
        workspace: env.GITHUB_WORKSPACE
      });
      const receipt = await mac.finish(saved.job, { jobCompleted: true, succeeded: decision.commit });
      console.log(`XENOCI_STICKY_COMMITTED generation=${receipt.generation ?? saved.job.lease.generation} filesystem=hfs committed=${receipt.committed}${decision.reason ? ` reason=${decision.reason}` : ""}`);
    } catch (error) {
      console.log(`::warning::Sticky disk was not saved this time: ${error.message}`);
    }
    await fs8.rm(stateFile, { force: true });
    return true;
  }
  const { INPUT_KEY: key, INPUT_PATH: input } = env;
  if (!key || !input || /[\r\n\0]/.test(input))
    throw new Error("key and path are required");
  const mountPath = path6.resolve(env.GITHUB_WORKSPACE, input.startsWith("~/") ? path6.join(os2.homedir(), input.slice(2)) : input);
  const existing = await fs8.lstat(mountPath).catch((error) => {
    if (error.code !== "ENOENT")
      throw error;
    return null;
  });
  if (existing && (!existing.isDirectory() || (await fs8.readdir(mountPath)).length))
    throw new Error("Sticky disk path must be absent or an empty directory");
  const job = await mac.begin({ key, mountPath, inputPath: input }).catch((error) => {
    console.log(`::warning::Sticky block slot unavailable (${error.message}), using the saved archive`);
    return null;
  });
  if (!job)
    return false;
  const state = path6.join(env.RUNNER_TEMP, "xenoci-sticky-mac-block.json");
  await fs8.writeFile(state, JSON.stringify({ job, macBlock: true, policy: await mountPolicy(mode, job.disk.mount) }), { mode: 384 });
  await fs8.appendFile(env.GITHUB_STATE, `XENOCI_STICKY_STATE=${state}
`);
  return true;
}
var init_mac_block_step = __esm(() => {
  init_mac_block();
  init_cache();
  init_commit_policy();
});

// integrations/stickydisk/index.mjs
import fs9 from "node:fs/promises";
import path7 from "node:path";
import os3 from "node:os";
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
  if (gateway && !/^http:\/\/artifacts\.ci\.xeno(?::\d{2,5})?\/$/.test(transport.href))
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

// integrations/stickydisk/linux-block.mjs
import fs4 from "node:fs/promises";
import { watch } from "node:fs";
import path3 from "node:path";
init_cache();
import net from "node:net";
import { execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";
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
          throw Error(/^[a-z_]{3,40}$/.test(String(value.error)) ? `block_${value.error}` : "block_hostcall_failed");
        finish(null, value);
      } catch (error) {
        finish(error);
      }
    });
    socket.once("end", () => finish(Error("block_hostcall_closed")));
  });
}
function waitForBlockDevice(device, { watchImpl = watch, access = fs4.access } = {}) {
  return new Promise((resolve, reject) => {
    const watcher = watchImpl(path3.dirname(device), check);
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
var SLOT_UNUSABLE = new Set(["block_invalid_slot", "block_slot_busy"]);
function createLinuxBlockDisk({
  runnerTemp = process.env.RUNNER_TEMP,
  run = deviceCommand,
  host,
  port,
  waitDevice = waitForBlockDevice,
  log = console.log,
  slots = [1, 2, 3, 4, 5, 6, 7]
} = {}) {
  const call = (message) => blockHostcall(message, { host, port });
  const attach = async (lease, mountPath) => {
    const started = Date.now();
    for (const n of slots) {
      const file = path3.join(runnerTemp, `xenoci-block-slot-${n}.json`);
      try {
        const handle = await fs4.open(file, "wx", 384);
        try {
          await handle.writeFile(JSON.stringify({ lease: lease.lease_id }));
        } finally {
          await handle.close();
        }
      } catch (error) {
        if (error.code !== "EEXIST")
          throw error;
        continue;
      }
      try {
        return await attachSlot(lease, mountPath, n, file, started);
      } catch (error) {
        if (!SLOT_UNUSABLE.has(error.message))
          throw error;
        await fs4.rm(file, { force: true });
      }
    }
    throw Error("block_slots_full");
  };
  const attachSlot = async (lease, mountPath, slot, slotFile, started) => {
    const disk = { slot, slotFile, mount: mountPath || path3.join(runnerTemp, `xenoci-buildkit-${slot}`), mounted: false, detached: false };
    let hostAttached = false;
    try {
      const attached = await call({ op: "attach", attach: lease.block.attach, slot });
      hostAttached = true;
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
        await run("sudo", ["rmdir", path3.join(disk.mount, "lost+found")]);
      await run("sudo", ["chown", `${uid}:${gid}`, disk.mount]);
      log(`XENOCI_STICKY_MOUNTED generation=${lease.generation} filesystem=ext4 transport=block attach_ms=${Date.now() - started}`);
      return disk;
    } catch (error) {
      if (hostAttached)
        await detach(lease, disk, false);
      else
        await fs4.rm(slotFile, { force: true });
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
    await fs4.rm(disk.slotFile, { force: true });
    if (lease.mode === "read")
      log("::notice::읽기 전용 스티키 디스크의 변경 사항은 저장되지 않고 폐기됩니다");
    return result;
  };
  const park = async (disk) => {
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
    return disk;
  };
  return { attach, detach, park };
}
async function attachRecovering(disk, cache, lease, mountPath, reacquire) {
  try {
    return [lease, await disk.attach(lease, mountPath)];
  } catch (error) {
    if (error.message !== "block_nas_not_found" || !reacquire)
      throw error;
    await cache.release(lease, { base_missing: true });
    const next = await reacquire();
    try {
      return [next, await disk.attach(next, mountPath)];
    } catch (retry) {
      await cache.release(next).catch(() => {});
      throw retry;
    }
  }
}
var STICKY_DEFER_MARKER = "/run/xenoci-image-cache/sticky-defer";
var deferredDir = (home) => path3.join(home, ".xenoci-sticky-deferred");
var stickyDeferAvailable = (marker = STICKY_DEFER_MARKER) => fs4.access(marker).then(() => true, () => false);
async function deferStickyCommit({ job, config, capability, home, disk }) {
  await disk.park(job.disk);
  const dir = deferredDir(home);
  await fs4.mkdir(dir, { recursive: true, mode: 448 });
  const file = path3.join(dir, `${job.lease.lease_id}-${job.disk.slot}.json`);
  await fs4.writeFile(file, JSON.stringify({ job, config, capability }), { mode: 384, flag: "wx" });
  return file;
}
function createLinuxStickyRuntime(config, {
  cache = createBuilderCache({ mode: "write", ...config }),
  disk = createLinuxBlockDisk()
} = {}) {
  return {
    async begin({ key, mountPath, inputPath }) {
      const lease = await cache.acquire(key, { transport: "block", fs: "ext4", path: inputPath });
      if (!lease.block) {
        await cache.release(lease);
        return null;
      }
      try {
        const [l, attached] = await attachRecovering(disk, cache, lease, mountPath, () => cache.acquire(key, { transport: "block", fs: "ext4", path: inputPath }));
        return { lease: l, disk: attached };
      } catch (error) {
        await cache.release(lease).catch(() => {});
        throw error;
      }
    },
    async finish(job, { jobCompleted, succeeded = true }) {
      try {
        const receipt = await disk.detach(job.lease, job.disk, jobCompleted === true && succeeded);
        return receipt.committed ? await cache.commitBlock(job.lease, receipt) : { committed: false };
      } finally {
        await cache.release(job.lease);
      }
    }
  };
}

// integrations/stickydisk/job-grant.mjs
import fs5 from "node:fs/promises";
import path4 from "node:path";
import os from "node:os";
var FILE = ".xenoci-job-grant.json";
async function ensureJobGrant(env = process.env, { home = os.homedir(), fetchImpl = fetch } = {}) {
  const own = (config) => !env.GITHUB_REPOSITORY || String(config?.repo ?? "").toLowerCase() === env.GITHUB_REPOSITORY.toLowerCase();
  const envConfig = (() => {
    try {
      return JSON.parse(env.XENOCI_STICKY_CONFIG ?? "null");
    } catch {
      return null;
    }
  })();
  if (env.XENOCI_STICKY_CONFIG && env.XENOCI_CACHE_JOB_CAPABILITY && own(envConfig))
    return true;
  const file = path4.join(home, FILE);
  try {
    const saved = JSON.parse(await fs5.readFile(file, "utf8"));
    if (saved?.capability && saved?.config && own(saved.config))
      return apply(env, saved);
  } catch {}
  if (!env.ACTIONS_RUNTIME_TOKEN)
    return false;
  const base = (await fs5.readFile(path4.join(home, ".xenoci-results-url"), "utf8").catch(() => "")).trim();
  if (!/^https:\/\/[^/]+\/$/.test(base))
    return false;
  try {
    const response = await fetchImpl(new URL("/api/runner/v1/cache/job-grant", base), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: { authorization: `Bearer ${env.ACTIONS_RUNTIME_TOKEN}`, "content-type": "application/json" },
      body: "{}"
    });
    if (!response.ok) {
      await response.body?.cancel();
      return false;
    }
    const { data } = await response.json();
    if (typeof data?.capability !== "string" || data.config?.origin !== base.replace(/\/$/, ""))
      return false;
    await fs5.writeFile(file, JSON.stringify(data), { mode: 384 }).catch(() => {});
    return apply(env, data);
  } catch {
    return false;
  }
}
function apply(env, { capability, config }) {
  env.XENOCI_CACHE_JOB_CAPABILITY = capability;
  env.XENOCI_STICKY_CONFIG = JSON.stringify(config);
  console.log(`::add-mask::${capability}`);
  return true;
}

// integrations/stickydisk/index.mjs
init_commit_policy();
var env = process.env;
var ROOM = {
  sticky_capacity_full: "지금은 스티키 디스크 자리가 없어요. 이번 잡은 스티키 디스크 없이 진행돼요",
  sticky_org_full: "조직의 스티키 디스크가 최대 용량에 이르렀어요. 이번 잡은 스티키 디스크 없이 진행돼요"
};
var UNPAID = "잔액이 없어 스티키 디스크를 지웠어요, 이번 잡은 스티키 디스크 없이 진행돼요";
var READ_ONLY = { insufficient_credit: "잔액이 없어 스티키 디스크가 읽기 전용입니다, 7일 안에 충전하지 않으면 삭제돼요, 충전하면 다시 쓸 수 있어요" };
ROOM.sticky_job_limit = "한 잡에서 쓸 수 있는 스티키 디스크는 5개까지라 이 디스크 없이 진행돼요";
if ((env.HTTPS_PROXY || env.https_proxy) && !process.execArgv.includes("--use-env-proxy")) {
  const child = spawn(process.execPath, ["--use-env-proxy", ...process.execArgv, ...process.argv.slice(1)], { env, stdio: "inherit" });
  const [code] = await once2(child, "close");
  process.exit(code ?? 1);
}
try {
  await ensureJobGrant(env);
  if (env.STATE_XENOCI_STICKY_STARTED && !env.STATE_XENOCI_STICKY_STATE)
    process.exit(0);
  const config = JSON.parse(env.XENOCI_STICKY_CONFIG ?? "null");
  if (!config || !/^https:\/\/[^/]+$/.test(config.origin ?? "") || !env.XENOCI_CACHE_JOB_CAPABILITY)
    throw new Error("Sticky disks require a XenoCI runner");
  if (process.platform === "darwin" && !config.gateway) {
    const verdict = await fs9.readFile(path7.join(os3.homedir(), ".xenoci-results-url"), "utf8").catch(() => "");
    if (/^http:\/\/artifacts\.ci\.xeno(?::\d{2,5})?\/$/.test(verdict.trim()))
      config.gateway = verdict.trim();
  }
  console.log(`::add-mask::${env.XENOCI_CACHE_JOB_CAPABILITY}`);
  const stateFile = env.STATE_XENOCI_STICKY_STATE;
  const mode = stateFile ? null : commitMode(env.INPUT_COMMIT, { warn: (line) => console.log(`::warning::${line}`) });
  if (process.platform === "linux") {
    const linux = createLinuxStickyRuntime({ ...config, capability: env.XENOCI_CACHE_JOB_CAPABILITY });
    if (stateFile) {
      const saved = JSON.parse(await fs9.readFile(stateFile, "utf8"));
      if (saved.job.disk) {
        const decision = await postDecision({
          saved: saved.policy,
          generation: saved.job.lease.generation,
          mountDir: saved.job.disk.mount,
          writable: saved.job.lease.mode === "write",
          home: os3.homedir(),
          workspace: env.GITHUB_WORKSPACE
        });
        if (!decision.commit) {
          try {
            await linux.finish(saved.job, { jobCompleted: true, succeeded: false });
            console.log(`XENOCI_STICKY_COMMITTED generation=${saved.job.lease.generation} filesystem=ext4 committed=false reason=${decision.reason}`);
            await fs9.rm(stateFile);
          } catch (error) {
            console.log(`::warning::Sticky disk was not released cleanly: ${error.message}`);
          }
          process.exit(0);
        }
        if (await stickyDeferAvailable()) {
          try {
            await deferStickyCommit({ job: saved.job, config, capability: env.XENOCI_CACHE_JOB_CAPABILITY, home: os3.homedir(), disk: createLinuxBlockDisk() });
            console.log(`XENOCI_STICKY_COMMIT deferred=true generation=${saved.job.lease.generation}`);
            await fs9.rm(stateFile);
            process.exit(0);
          } catch (error) {
            console.log(`::notice::Sticky disk commits now (${/^[a-z_]{3,40}$/.test(String(error?.message)) ? error.message : "defer_failed"})`);
          }
        }
        try {
          const receipt = await linux.finish(saved.job, { jobCompleted: true, succeeded: true });
          console.log(`XENOCI_STICKY_COMMITTED generation=${receipt.generation ?? saved.job.lease.generation} filesystem=ext4 committed=${receipt.committed}`);
          await fs9.rm(stateFile);
        } catch (error) {
          console.log(`::warning::Sticky disk was not saved this time: ${error.message}`);
        }
        process.exit(0);
      }
    } else {
      const { INPUT_KEY: key, INPUT_PATH: input } = env;
      if (!key || !input || /[\r\n\0]/.test(input))
        throw new Error("key and path are required");
      const mountPath = path7.resolve(env.GITHUB_WORKSPACE, input.startsWith("~/") ? path7.join(os3.homedir(), input.slice(2)) : input);
      const existing = await fs9.lstat(mountPath).catch((error) => {
        if (error.code !== "ENOENT")
          throw error;
        return null;
      });
      if (existing && (!existing.isDirectory() || (await fs9.readdir(mountPath)).length))
        throw new Error("Sticky disk path must be absent or an empty directory");
      let job;
      try {
        job = await linux.begin({ key, mountPath, inputPath: input });
      } catch (error) {
        await fs9.mkdir(mountPath, { recursive: true });
        await fs9.appendFile(env.GITHUB_STATE, `XENOCI_STICKY_STARTED=true
`);
        if (ROOM[error.message])
          console.log(`::notice::${ROOM[error.message]}`);
        else if (error.message === "sticky_unpaid")
          console.log(`::notice::${UNPAID}`);
        else if (error.message === "sticky_disks_preparing")
          console.log("::notice::스티키 디스크는 준비 중이라 이번 잡은 디스크 없이 돌았습니다");
        else
          console.log("::warning::Sticky disk unavailable, continuing without a saved disk");
        process.exit(0);
      }
      if (job) {
        if (job.lease.fallback === "insufficient_credit")
          console.log(`::notice::${READ_ONLY.insufficient_credit}`);
        const state = path7.join(env.RUNNER_TEMP, `xenoci-sticky-block-${job.disk.slot}.json`);
        await fs9.writeFile(state, JSON.stringify({ job, policy: await mountPolicy(mode, job.disk.mount) }), { mode: 384 });
        await fs9.appendFile(env.GITHUB_STATE, `XENOCI_STICKY_STATE=${state}
`);
        process.exit(0);
      }
    }
  }
  if (process.platform === "darwin" && await fs9.access(path7.join(os3.homedir(), ".xenoci-block-slot")).then(() => true, () => false) && await (await Promise.resolve().then(() => (init_mac_block_step(), exports_mac_block_step))).macBlockStep({ env, config, stateFile, mode }))
    process.exit(0);
  if (stateFile) {
    const { job, mountPath, config: savedConfig, policy } = JSON.parse(await fs9.readFile(stateFile, "utf8"));
    const decision = await postDecision({
      saved: policy,
      generation: job.lease.generation,
      mountDir: job.mounted.mount,
      writable: job.mounted.mode !== "read" && !job.readOnly,
      home: os3.homedir(),
      workspace: env.GITHUB_WORKSPACE
    });
    const runtime = createMacStickyJobRuntime({ ...savedConfig, capability: env.XENOCI_CACHE_JOB_CAPABILITY });
    let receipt = { committed: false };
    try {
      receipt = await runtime.finish(job, { succeeded: decision.commit, jobCompleted: true });
    } catch (error) {
      if (ROOM[error.message])
        console.log(`::notice::${ROOM[error.message]}`);
      else
        console.log(`::warning::Sticky disk was not saved this time: ${error.message}`);
    } finally {
      await runtime.release(job);
      if (await fs9.readlink(mountPath) !== job.mounted.mount)
        throw new Error("Sticky disk path changed; refusing cleanup");
      await fs9.unlink(mountPath);
      await runtime.cleanup(job, { activeLeases: 0 });
      await fs9.rm(savedConfig.root, { recursive: true });
    }
    console.log(`XENOCI_STICKY_COMMITTED generation=${receipt.generation ?? job.lease.generation} filesystem=APFS committed=${receipt.committed}${decision.reason ? ` reason=${decision.reason}` : ""}`);
  } else {
    await fs9.appendFile(env.GITHUB_STATE, `XENOCI_STICKY_STARTED=true
`);
    const { INPUT_KEY: key, INPUT_PATH: input } = env;
    if (!key || !input || /[\r\n\0]/.test(input))
      throw new Error("key and path are required");
    const mountPath = path7.resolve(env.GITHUB_WORKSPACE, input.startsWith("~/") ? path7.join(os3.homedir(), input.slice(2)) : input);
    const existing = await fs9.lstat(mountPath).catch((error) => {
      if (error.code !== "ENOENT")
        throw error;
      return null;
    });
    if (existing) {
      if (!existing.isDirectory() || (await fs9.readdir(mountPath)).length)
        throw new Error("Sticky disk path must be absent or an empty directory");
      await fs9.rmdir(mountPath);
    }
    const root = await fs9.mkdtemp(path7.join(env.RUNNER_TEMP, "xenoci-sticky-"));
    const runtimeConfig = { ...config, root, guestLocal: true }, runtime = createMacStickyJobRuntime({
      ...runtimeConfig,
      capability: env.XENOCI_CACHE_JOB_CAPABILITY,
      log: (line) => console.log(`::warning::${line}`)
    });
    let job;
    try {
      job = await runtime.begin({ key, maxBytes: config.maxBytes, mode: config.mode, mountPath: input });
    } catch (error) {
      await fs9.rm(root, { recursive: true, force: true });
      await fs9.mkdir(mountPath, { recursive: true });
      if (error.message === "sticky_disks_preparing")
        console.log("::notice::스티키 디스크는 준비 중이라 이번 잡은 디스크 없이 돌았습니다");
      else if (ROOM[error.message])
        console.log(`::notice::${ROOM[error.message]}`);
      else if (error.message === "sticky_unpaid")
        console.log(`::notice::${UNPAID}`);
      else
        console.log(`::warning::Sticky disk unavailable, continuing with an empty directory: ${error.message}`);
      process.exit(0);
    }
    await fs9.mkdir(path7.dirname(mountPath), { recursive: true });
    await fs9.symlink(job.mounted.mount, mountPath);
    const state = path7.join(root, "state.json");
    await fs9.writeFile(state, JSON.stringify({ job, mountPath, config: runtimeConfig, policy: await mountPolicy(mode, job.mounted.mount) }), { mode: 384 });
    await fs9.appendFile(env.GITHUB_STATE, `XENOCI_STICKY_STATE=${state}
`);
    if (job.readOnly)
      console.log(`::notice::${READ_ONLY[job.readOnly] ?? READ_ONLY.insufficient_credit}`);
    console.log(`XENOCI_STICKY_MOUNTED generation=${job.lease.generation} filesystem=APFS mode=${job.mounted.mode} restored=${job.restored} source=${job.source} bytes=${job.downloadBytes} download_ms=${job.downloadMs}`);
  }
} catch (error) {
  console.error(`::error::${error.message}${error.cause?.code ? ` (${error.cause.code})` : ""}`);
  process.exitCode = 1;
}
