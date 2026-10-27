var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// integrations/docker-builder/cache.mjs
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
function builderCacheKey(key, image, arch) {
  if (typeof key !== "string" || !key.trim() || key.length > 512 || /[\x00-\x1f]/.test(key))
    throw Error("cache-key is required");
  return `docker-buildkit-v1:${crypto.createHash("sha256").update(JSON.stringify([key, image, arch, "native"])).digest("hex")}`;
}
async function archiveDigest(file, maxBytes = MAX_ARCHIVE_BYTES) {
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) {
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
  const acquire = async (key, { kind = "sticky", ...options } = {}) => {
    const request = (mode2) => api("", { kind, repo: config.repo, key, ref: config.ref, mode: mode2, job_id: config.jobPublicId, ...options });
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
      await pipeline(response.body, new Transform({ transform(chunk, _encoding, done) {
        bytes += chunk.length;
        done(bytes > MAX_ARCHIVE_BYTES ? Error("cache archive exceeds capacity") : null, chunk);
      } }), fs.createWriteStream(file, { flags: "wx", mode: 384 }));
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
    const body = fs.createReadStream(file);
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
var MAX_ARCHIVE_BYTES;
var init_cache = __esm(() => {
  MAX_ARCHIVE_BYTES = 1024 ** 3;
});

// integrations/docker-builder/docker.mjs
import { spawn } from "node:child_process";
import fs2 from "node:fs";
import { pipeline as pipeline2 } from "node:stream/promises";
import { Transform as Transform2 } from "node:stream";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
function validateImages(buildkit, helper) {
  if (!IMAGE.test(buildkit) || !IMAGE.test(helper))
    throw Error("BuildKit and archive helper images must be digest pinned");
}
async function dockerCommand(args, { input, output, env = process.env } = {}) {
  const child = spawn("docker", ["--host", "unix:///var/run/docker.sock", ...args], {
    env: { ...env, DOCKER_HOST: "unix:///var/run/docker.sock", DOCKER_CONTEXT: "" },
    stdio: ["pipe", "pipe", "pipe"],
    signal: AbortSignal.timeout(120000)
  });
  let processError;
  child.once("error", (error) => {
    processError = error;
  });
  const closed = new Promise((resolve, reject) => {
    child.once("close", (code) => {
      if (processError)
        reject(processError);
      else if (code === 0)
        resolve();
      else
        reject(Error(`docker ${args[0]} failed (${code})`));
    });
  });
  child.stderr.resume();
  let stdout = "", bytes = 0;
  const streams = [];
  if (input)
    streams.push(pipeline2(fs2.createReadStream(input), child.stdin));
  else
    child.stdin.end();
  if (output)
    streams.push(pipeline2(child.stdout, new Transform2({ transform(chunk, _encoding, done) {
      bytes += chunk.length;
      done(bytes > MAX_ARCHIVE_BYTES ? Error("cache archive exceeds capacity") : null, chunk);
    } }), fs2.createWriteStream(output, { flags: "wx", mode: 384 })));
  else
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes <= 1024 * 1024)
        stdout += chunk;
      else
        child.kill("SIGTERM");
    });
  try {
    await Promise.all([closed, ...streams]);
  } catch (error) {
    child.kill("SIGTERM");
    await Promise.allSettled([closed, ...streams]);
    throw error;
  }
  return stdout.trim();
}
function createGuestDocker({ run = dockerCommand, env = process.env, platform = process.platform, resolve = lookup } = {}) {
  const command = (args, io) => run(args, { env, ...io });
  const inspect = async (kind, name) => JSON.parse(await command([kind, "inspect", name]))[0];
  const check = async () => {
    if (platform !== "linux" || env.DOCKER_CONTEXT || env.DOCKER_HOST && env.DOCKER_HOST !== "unix:///var/run/docker.sock" || env.DOCKER_TLS_VERIFY)
      throw Error("requires the Linux VM local Docker socket");
    const info = JSON.parse(await command(["info", "--format", "{{json .}}"]));
    if (info.OSType !== "linux")
      throw Error("requires a Linux Docker daemon");
    await command(["buildx", "version"]);
    await command(["compose", "version"]);
    return info.Architecture;
  };
  const ownsVolume = async (s) => {
    const volume2 = await inspect("volume", s.volume);
    if (volume2.Labels?.["im.xenoci.builder-owner"] !== s.owner)
      throw Error("foreign builder volume");
  };
  const volume = async (s) => {
    const existing = await command(["volume", "ls", "--format", "{{.Name}}", "--filter", `name=^${s.volume}$`]);
    if (existing)
      throw Error("builder volume already exists");
    await command(["volume", "create", "--label", `im.xenoci.builder-owner=${s.owner}`, s.volume]);
  };
  const helper = (s, readOnly, args) => [
    "run",
    "--rm",
    "--name",
    `${s.builder}-archive`,
    "--label",
    `im.xenoci.builder-owner=${s.owner}`,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--cap-add",
    "CHOWN",
    "--cap-add",
    "DAC_OVERRIDE",
    "--cap-add",
    "FOWNER",
    "--cap-add",
    "SETFCAP",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "64",
    "--memory",
    "256m",
    "--cpus",
    "1",
    "--mount",
    `type=volume,src=${s.volume},dst=/state${readOnly ? ",readonly" : ""}`,
    "-i",
    "--entrypoint",
    "tar",
    s.helperImage,
    ...args
  ];
  const restore = async (s, file) => {
    await ownsVolume(s);
    await command(helper(s, false, ["--extract", "--xattrs", "--xattrs-include=*", "--file=-", "--directory=/state", "--numeric-owner", "--same-owner", "--same-permissions"]), { input: file });
  };
  const ownsBlockContainer = (s, container) => {
    if (container.Config?.Labels?.["im.xenoci.builder-owner"] !== s.owner || !container.Mounts?.some((m) => m.Type === "bind" && m.Source === s.block.mount && m.Destination === "/var/lib/buildkit"))
      throw Error("foreign BuildKit container");
  };
  const bootstrap = async (s) => {
    const proxyHosts = [...new Set(["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"].filter((k) => env[k]).map((k) => new URL(env[k]).hostname).filter((host) => !isIP(host)))];
    const addresses = new Map(await Promise.all(proxyHosts.map(async (host) => [host, (await resolve(host)).address])));
    const proxyEnv = { ...env };
    for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) {
      if (!env[key])
        continue;
      const url = new URL(env[key]), address = addresses.get(url.hostname);
      if (address) {
        url.hostname = isIP(address) === 6 ? `[${address}]` : address;
        proxyEnv[key] = url.href.replace(/\/$/, "");
      }
    }
    if (s.block) {
      await command([
        "run",
        "-d",
        "--name",
        s.container,
        "--label",
        `im.xenoci.builder-owner=${s.owner}`,
        "--privileged",
        "--mount",
        `type=bind,src=${s.block.mount},dst=/var/lib/buildkit`,
        ...["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"].filter((k) => env[k]).flatMap((k) => ["--env", `${k}=${proxyEnv[k]}`]),
        s.buildkitImage,
        "--oci-worker-snapshotter=native"
      ]);
      ownsBlockContainer(s, await inspect("container", s.container));
      await command(["buildx", "create", "--name", s.builder, "--node", s.node, "--driver", "remote", "--use", `docker-container://${s.container}`]);
      await command(["buildx", "inspect", "--builder", s.builder, "--bootstrap"]);
      return;
    }
    await command([
      "buildx",
      "create",
      "--name",
      s.builder,
      "--node",
      s.node,
      "--driver",
      "docker-container",
      "--driver-opt",
      `image=${s.buildkitImage}`,
      "--buildkitd-flags",
      "--oci-worker-snapshotter=native",
      ...["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"].filter((k) => env[k]).flatMap((k) => ["--driver-opt", `"env.${k}=${proxyEnv[k].replaceAll('"', '""')}"`]),
      "--use",
      "unix:///var/run/docker.sock"
    ]);
    await command(["buildx", "inspect", "--builder", s.builder, "--bootstrap"]);
    const container = await inspect("container", s.container);
    if (!container.Mounts?.some((m) => m.Type === "volume" && m.Name === s.volume && m.Destination === "/var/lib/buildkit"))
      throw Error("unexpected BuildKit state volume");
  };
  const stop = async (s) => {
    if (!s.block)
      await ownsVolume(s);
    const container = await inspect("container", s.container);
    if (s.block)
      ownsBlockContainer(s, container);
    else if (!container.Mounts?.some((m) => m.Name === s.volume && m.Destination === "/var/lib/buildkit"))
      throw Error("foreign BuildKit container");
    await command(["stop", "--time", "30", s.container]);
    const stopped = await inspect("container", s.container);
    if (stopped.State.Running || stopped.State.OOMKilled || ![0, 1].includes(stopped.State.ExitCode))
      throw Error("BuildKit did not stop cleanly");
    if (await command(["ps", "-q", "--filter", `volume=${s.block?.mount ?? s.volume}`]))
      throw Error("builder volume still has writers");
  };
  const archive = async (s, file) => {
    await ownsVolume(s);
    await command(helper(s, true, ["--create", "--xattrs", "--xattrs-include=*", "--format=posix", "--numeric-owner", "--file=-", "--directory=/state", "."]), { output: file });
  };
  const removeHelper = async (s) => {
    const name = `${s.builder}-archive`;
    const existing = await command(["ps", "-aq", "--filter", `name=^${name}$`]);
    if (!existing)
      return;
    const container = await inspect("container", name);
    if (container.Config?.Labels?.["im.xenoci.builder-owner"] !== s.owner)
      throw Error("foreign archive helper");
    await command(["rm", "-f", name]);
    if (await command(["ps", "-aq", "--filter", `name=^${name}$`]))
      throw Error("archive helper remains");
  };
  const removeVolume = async (s) => {
    await ownsVolume(s);
    await command(["volume", "rm", s.volume]);
  };
  const cleanup = async (s) => {
    if (s.block) {
      const containers = await command(["ps", "-aq", "--filter", `name=^${s.container}$`]);
      if (containers) {
        ownsBlockContainer(s, await inspect("container", s.container));
        await command(["rm", "-f", s.container]);
      }
      const builders2 = await command(["buildx", "ls", "--format", "{{.Name}}"]);
      if (builders2.split(`
`).includes(s.builder))
        await command(["buildx", "rm", s.builder]);
      if (await command(["ps", "-aq", "--filter", `volume=${s.block.mount}`]))
        throw Error("owned Docker resources remain");
      return;
    }
    const helpers = await command(["ps", "-aq", "--filter", `label=im.xenoci.builder-owner=${s.owner}`]);
    for (const id of helpers.split(`
`).filter(Boolean))
      await command(["rm", "-f", id]);
    const builders = await command(["buildx", "ls", "--format", "{{.Name}}"]);
    if (builders.split(`
`).includes(s.builder)) {
      const containers = await command(["ps", "-aq", "--filter", `name=^${s.container}$`]);
      if (containers) {
        await ownsVolume(s);
        const container = await inspect("container", s.container);
        if (!container.Mounts?.some((m) => m.Name === s.volume && m.Destination === "/var/lib/buildkit"))
          throw Error("foreign BuildKit container");
      }
      await command(["buildx", "rm", "--keep-state", s.builder]);
    }
    const volumes = await command(["volume", "ls", "--format", "{{.Name}}", "--filter", `label=im.xenoci.builder-owner=${s.owner}`]);
    if (volumes.split(`
`).includes(s.volume))
      await removeVolume(s);
    const left = await command(["ps", "-aq", "--filter", `volume=${s.volume}`]);
    const remainingVolumes = await command(["volume", "ls", "--format", "{{.Name}}", "--filter", `label=im.xenoci.builder-owner=${s.owner}`]);
    const remainingHelpers = await command(["ps", "-aq", "--filter", `label=im.xenoci.builder-owner=${s.owner}`]);
    if (left || remainingVolumes || remainingHelpers)
      throw Error("owned Docker resources remain");
  };
  return { check, volume, restore, bootstrap, stop, archive, removeHelper, removeVolume, cleanup };
}
var IMAGE;
var init_docker = __esm(() => {
  init_cache();
  IMAGE = /^[a-zA-Z0-9][a-zA-Z0-9./:_-]*@sha256:[a-f0-9]{64}$/;
});

// integrations/docker-builder/archive.mjs
import { open } from "node:fs/promises";
function invalid(reason) {
  throw Error(`invalid buildkit archive: ${reason}`);
}
function octal(field) {
  const value = field.toString("latin1").replace(/[\0 ]+$/, "").replace(/^ +/, "");
  if (!/^[0-7]+$/.test(value))
    invalid("numeric header");
  const number = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(number))
    invalid("numeric overflow");
  return number;
}
function text(field) {
  const end = field.indexOf(0);
  if (end !== -1 && field.subarray(end).some((byte) => byte !== 0))
    invalid("header string padding");
  return field.subarray(0, end === -1 ? field.length : end).toString("latin1");
}
function archivePath(value) {
  if (!value || value.length > MAX_PATH_BYTES || value.includes("\x00") || value.startsWith("/"))
    invalid("entry path");
  const parts = value.split("/");
  if (parts.includes("..") || parts.length > 256)
    invalid("entry traversal");
  return parts.filter((part) => part && part !== ".").join("/");
}
function decimal(value) {
  if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)))
    invalid("pax number");
  return Number(value);
}
function paxFields(body, global) {
  const fields = new Map;
  for (let offset = 0;offset < body.length; ) {
    const space = body.indexOf(32, offset);
    if (space < offset + 1 || space - offset > 7)
      invalid("pax record length");
    const length = decimal(body.subarray(offset, space).toString("latin1"));
    const end = offset + length;
    if (length <= space - offset + 3 || end > body.length || body[end - 1] !== 10)
      invalid("pax record bounds");
    const equals = body.indexOf(61, space + 1);
    if (equals <= space + 1 || equals >= end - 1)
      invalid("pax record key");
    const key = body.subarray(space + 1, equals).toString("latin1");
    const value = body.subarray(equals + 1, end - 1).toString("latin1");
    if (key.length > 256 || fields.size >= 256 || fields.has(key))
      invalid("pax key count or duplicate");
    if (!PAX_KEYS.has(key) && !/^SCHILY\.xattr\.[^\0\n=]+$/.test(key))
      invalid("unsupported pax key");
    if (global && ["path", "linkpath", "size"].includes(key))
      invalid("global pax entry override");
    if (["path", "linkpath"].includes(key) && (!value || value.length > MAX_PATH_BYTES || value.includes("\x00")))
      invalid("pax path");
    if (["size", "uid", "gid"].includes(key) && value)
      decimal(value);
    if (["mtime", "atime", "ctime"].includes(key) && value && !/^-?\d+(\.\d+)?$/.test(value))
      invalid("pax timestamp");
    if (key === "hdrcharset" && !["", "BINARY", "ISO-IR 10646 2000 UTF-8"].includes(value))
      invalid("pax charset");
    fields.set(key, value);
    offset = end;
  }
  return fields;
}
async function validateBuildkitArchive(file, { maxBytes = 1073741824, maxFiles = 200000 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(maxFiles) || maxFiles < 0)
    throw TypeError("invalid archive limits");
  const handle = await open(file, "r");
  try {
    let remember = function(name, type) {
      if (!paths.has(name)) {
        nameBytes += name.length;
        if (nameBytes > MAX_NAME_BYTES)
          invalid("path memory capacity");
      }
      paths.set(name, type);
    };
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes)
      invalid("archive capacity or file type");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let cursor = 0, available = 0, bytes = 0, files = 0, headers = 0, nameBytes = 0;
    const paths = new Map;
    let local = null;
    const globals = new Map;
    async function take(length, { collect = false, zero = false, eof = false } = {}) {
      if (length > maxBytes)
        invalid("entry capacity");
      const result = collect ? Buffer.allocUnsafe(length) : null;
      let done = 0;
      while (done < length) {
        if (cursor === available) {
          ({ bytesRead: available } = await handle.read(buffer, 0, buffer.length, null));
          cursor = 0;
          bytes += available;
          if (bytes > maxBytes)
            invalid("archive capacity");
          if (!available) {
            if (eof && done === 0)
              return null;
            invalid("truncated archive");
          }
        }
        const count = Math.min(length - done, available - cursor);
        const chunk = buffer.subarray(cursor, cursor + count);
        if (zero && chunk.some((byte) => byte !== 0))
          invalid("nonzero padding or trailing data");
        if (collect)
          chunk.copy(result, done);
        cursor += count;
        done += count;
      }
      return result;
    }
    for (;; ) {
      const header = await take(BLOCK, { collect: true });
      if (header.every((byte) => byte === 0)) {
        if (local)
          invalid("orphan pax header");
        await take(BLOCK, { zero: true });
        while (await take(BLOCK, { collect: true, zero: true, eof: true })) {}
        return { bytes, files };
      }
      if (++headers > maxFiles * 2 + 16)
        invalid("header count");
      let checksum = 0;
      for (let i = 0;i < BLOCK; i++)
        checksum += i >= 148 && i < 156 ? 32 : header[i];
      if (octal(header.subarray(148, 156)) !== checksum)
        invalid("header checksum");
      if (header.subarray(257, 265).toString("latin1") !== "ustar\x0000" || header.subarray(500).some((byte) => byte !== 0))
        invalid("header format");
      for (const [start, end] of [[100, 108], [108, 116], [116, 124], [136, 148]])
        octal(header.subarray(start, end));
      const size = octal(header.subarray(124, 136));
      const prefix = text(header.subarray(345, 500));
      const rawName = `${prefix ? `${prefix}/` : ""}${text(header.subarray(0, 100))}`;
      archivePath(rawName);
      const rawLink = text(header.subarray(157, 257));
      const type = String.fromCharCode(header[156]);
      if (type === "x" || type === "g") {
        if (local || size === 0 || size > MAX_PAX_BYTES)
          invalid("pax header size or sequence");
        const fields = paxFields(await take(size, { collect: true }), type === "g");
        await take((BLOCK - size % BLOCK) % BLOCK, { zero: true });
        if (type === "x")
          local = fields;
        else {
          for (const [key, value] of fields) {
            if (value === "")
              globals.delete(key);
            else
              globals.set(key, value);
          }
          if (globals.size > 256 || [...globals].reduce((sum, [key, value]) => sum + key.length + value.length, 0) > MAX_PAX_BYTES)
            invalid("global pax capacity");
        }
        continue;
      }
      if (!["\x00", "0", "1", "2", "5"].includes(type))
        invalid("unsupported entry type");
      const attributes = new Map(globals);
      for (const [key, value] of local || []) {
        if (value === "")
          attributes.delete(key);
        else
          attributes.set(key, value);
      }
      local = null;
      const nameValue = attributes.get("path") ?? rawName;
      const name = archivePath(nameValue);
      const link = attributes.get("linkpath") ?? rawLink;
      const payloadSize = attributes.has("size") ? decimal(attributes.get("size")) : size;
      const regular = type === "0" || type === "\x00";
      if (!regular && payloadSize !== 0)
        invalid("non-file payload");
      if (type !== "5" && (!name || nameValue.endsWith("/")))
        invalid("non-directory path");
      if (++files > maxFiles)
        invalid("file count");
      const previous = paths.get(name);
      if (previous && !(previous === "implicit" && type === "5"))
        invalid("duplicate path or directory replacement");
      const parts = name.split("/");
      for (let i = 1;i < parts.length; i++) {
        const ancestor = parts.slice(0, i).join("/");
        const ancestorType = paths.get(ancestor);
        if (ancestorType && ancestorType !== "5" && ancestorType !== "implicit")
          invalid("non-directory ancestor");
        if (!ancestorType)
          remember(ancestor, "implicit");
      }
      if (type === "1" && paths.get(archivePath(link)) !== "0")
        invalid("hardlink target");
      if (type === "2" && (!link || link.length > MAX_PATH_BYTES || link.includes("\x00")))
        invalid("symlink target");
      if (type !== "1" && type !== "2" && link)
        invalid("unexpected link target");
      remember(name, regular ? "0" : type);
      await take(payloadSize);
      await take((BLOCK - payloadSize % BLOCK) % BLOCK, { zero: true });
    }
  } finally {
    await handle.close();
  }
}
var BLOCK = 512, MAX_PAX_BYTES, MAX_PATH_BYTES = 4096, MAX_NAME_BYTES, PAX_KEYS;
var init_archive = __esm(() => {
  MAX_PAX_BYTES = 1024 * 1024;
  MAX_NAME_BYTES = 32 * 1024 * 1024;
  PAX_KEYS = new Set(["path", "linkpath", "size", "uid", "gid", "uname", "gname", "mtime", "atime", "ctime", "hdrcharset"]);
});

// integrations/stickydisk/linux-block.mjs
import fs3 from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
function waitForBlockDevice(device, { watchImpl = watch, access = fs3.access } = {}) {
  return new Promise((resolve, reject) => {
    const watcher = watchImpl(path.dirname(device), check);
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
  log = console.log,
  slots = [1, 2, 3, 4, 5]
} = {}) {
  const call = (message) => blockHostcall(message, { host, port });
  const attach = async (lease, mountPath) => {
    const started = Date.now();
    let slot, slotFile;
    for (const n of slots) {
      const file = path.join(runnerTemp, `xenoci-block-slot-${n}.json`);
      try {
        const handle = await fs3.open(file, "wx", 384);
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
    const disk = { slot, slotFile, mount: mountPath || path.join(runnerTemp, `xenoci-buildkit-${slot}`), mounted: false, detached: false };
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
        await run("sudo", ["rmdir", path.join(disk.mount, "lost+found")]);
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
    await fs3.rm(disk.slotFile);
    if (lease.mode === "read")
      log("::notice::읽기 전용 스티키 디스크의 변경 사항은 저장되지 않고 폐기됩니다");
    return result;
  };
  return { attach, detach };
}
var exec, deviceCommand = async (command, args) => (await exec(command, args, { timeout: 120000 })).stdout.trim();
var init_linux_block = __esm(() => {
  init_cache();
  exec = promisify(execFile);
});

// integrations/docker-builder/runtime.mjs
import fs4 from "node:fs/promises";
import path2 from "node:path";
import crypto2 from "node:crypto";
async function prepareState(parent) {
  if (!parent || !path2.isAbsolute(parent))
    throw Error("RUNNER_TEMP must be absolute");
  const root = await fs4.mkdtemp(path2.join(parent, "xenoci-docker-"));
  const owner = crypto2.randomBytes(16).toString("hex"), builder = `xenoci-${owner}`;
  const state = { root, owner, builder, node: `${builder}0`, container: `buildx_buildkit_${builder}0`, volume: `buildx_buildkit_${builder}0_state` };
  await fs4.writeFile(path2.join(root, "state.json"), JSON.stringify(state), { mode: 384 });
  return state;
}
async function readState(root, parent) {
  if (!path2.isAbsolute(root || "") || path2.dirname(root) !== path2.resolve(parent) || !path2.basename(root).startsWith("xenoci-docker-"))
    throw Error("foreign builder state path");
  if ((await fs4.lstat(root)).isSymbolicLink())
    throw Error("foreign builder state path");
  const state = JSON.parse(await fs4.readFile(path2.join(root, "state.json"), "utf8"));
  if (!/^[a-f0-9]{32}$/.test(state.owner) || state.root !== root || state.builder !== `xenoci-${state.owner}` || state.node !== `${state.builder}0` || state.container !== `buildx_buildkit_${state.node}` || state.volume !== `${state.container}_state`)
    throw Error("invalid builder ownership");
  return state;
}
function createBuilderRuntime({
  docker = createGuestDocker(),
  cache = null,
  validate = validateBuildkitArchive,
  log = console.log,
  block = createLinuxBlockDisk({ log })
} = {}) {
  const setup = async (state, { key, buildkitImage, helperImage }) => {
    validateImages(buildkitImage, helperImage);
    const arch = await docker.check();
    const cacheKey = builderCacheKey(key, buildkitImage, arch);
    Object.assign(state, { buildkitImage, helperImage, cacheKey, restored: false });
    await persist(state);
    if (cache) {
      try {
        state.lease = await cache.acquire(cacheKey, { transport: "block", fs: "ext4", path: `docker-builder:${key}` });
        await persist(state);
      } catch {
        log("::warning::Docker cache unavailable; starting an empty builder");
      }
    }
    if (state.lease?.block) {
      try {
        state.block = await block.attach(state.lease);
      } catch {
        log("::warning::Docker cache disk unavailable; starting an empty builder");
        await cache.release(state.lease).catch(() => {});
        state.lease = null;
      }
      await persist(state);
    }
    if (state.block) {
      state.restored = !!state.lease.block.base;
      await docker.bootstrap(state);
      state.ready = true;
      await persist(state);
      log(`XENOCI_DOCKER_READY restored=${state.restored} mode=${state.lease.mode} transport=block`);
      return state.builder;
    }
    await docker.volume(state);
    const archive = path2.join(state.root, "restore.tar");
    try {
      if (state.lease && await cache.restore(state.lease, archive)) {
        await validate(archive);
        await docker.restore(state, archive);
        state.restored = true;
      }
    } catch {
      log("::warning::Docker cache restore failed; starting an empty builder");
      await docker.removeHelper(state);
      await docker.removeVolume(state);
      await docker.volume(state);
    } finally {
      await fs4.rm(archive, { force: true });
    }
    await docker.bootstrap(state);
    state.ready = true;
    await persist(state);
    log(`XENOCI_DOCKER_READY restored=${state.restored} mode=${state.lease?.mode ?? "cold"}`);
    return state.builder;
  };
  const save = async (state, { succeeded }) => {
    if (state.block) {
      if (!state.ready || state.block.detached)
        return { committed: false };
      try {
        await docker.stop(state);
        const receipt = await block.detach(state.lease, state.block, succeeded === true);
        await persist(state);
        const result = receipt.committed ? await cache.commitBlock(state.lease, receipt) : { committed: false };
        log(`XENOCI_DOCKER_SAVED committed=${result.committed === true} generation=${result.generation ?? state.lease.generation}`);
        return result;
      } catch (error) {
        log(`::warning::Docker cache was not saved (${safeReason(error)}); the previous generation is unchanged`);
        return { committed: false };
      }
    }
    if (!succeeded || !state.ready || !state.lease || state.lease.mode !== "write")
      return { committed: false };
    const archive = path2.join(state.root, "save.tar");
    try {
      await docker.stop(state);
      await docker.archive(state, archive);
      await validate(archive);
      const result = await cache.commit(state.lease, archive);
      log(`XENOCI_DOCKER_SAVED committed=${result.committed === true} generation=${result.generation ?? state.lease.generation}`);
      return result;
    } catch (error) {
      log(`::warning::Docker cache was not saved (${safeReason(error)}); the previous generation is unchanged`);
      return { committed: false };
    } finally {
      await fs4.rm(archive, { force: true });
    }
  };
  const cleanup = async (state) => {
    if (state.block) {
      try {
        await docker.cleanup(state);
        if (!state.block.detached)
          await block.detach(state.lease, state.block, false);
      } finally {
        await persist(state);
        await cache.release(state.lease);
      }
      await fs4.rm(state.root, { recursive: true });
      log("XENOCI_DOCKER_CLEANED");
      return;
    }
    try {
      if (state.lease && cache)
        await cache.release(state.lease);
    } catch {
      log("::warning::Docker cache lease release failed; server expiry remains in effect");
    }
    await docker.cleanup(state);
    await fs4.rm(state.root, { recursive: true });
    if (await fs4.stat(state.root).then(() => true, () => false))
      throw Error("builder temporary files remain");
    log("XENOCI_DOCKER_CLEANED");
  };
  return { setup, save, cleanup };
}
function cacheFromEnvironment(env) {
  if (!env.XENOCI_STICKY_CONFIG || !env.XENOCI_CACHE_JOB_CAPABILITY)
    return null;
  const config = JSON.parse(env.XENOCI_STICKY_CONFIG);
  return createBuilderCache({ ...config, capability: env.XENOCI_CACHE_JOB_CAPABILITY });
}
var persist = (state) => fs4.writeFile(path2.join(state.root, "state.json"), JSON.stringify(state), { mode: 384 }), SAFE_SAVE_REASON, safeReason = (error) => SAFE_SAVE_REASON.test(String(error?.message)) ? error.message : "unclassified failure";
var init_runtime = __esm(() => {
  init_cache();
  init_docker();
  init_archive();
  init_linux_block();
  SAFE_SAVE_REASON = /^(?:BuildKit did not stop cleanly|builder volume still has writers|foreign BuildKit container|foreign builder volume|cache archive exceeds capacity|invalid buildkit archive: [a-z0-9 .,'-]{1,80}|cache lease expired|cache upload rejected|foreign cache blob origin|docker [a-z]+ failed \((?:\d+|null)\)|[a-z_]{3,40})$/;
});

// integrations/stickydisk/job-grant.mjs
import fs5 from "node:fs/promises";
import path3 from "node:path";
import os from "node:os";
async function ensureJobGrant(env = process.env, { home = os.homedir(), fetchImpl = fetch } = {}) {
  if (env.XENOCI_STICKY_CONFIG && env.XENOCI_CACHE_JOB_CAPABILITY)
    return true;
  const file = path3.join(home, FILE);
  try {
    const saved = JSON.parse(await fs5.readFile(file, "utf8"));
    if (saved?.capability && saved?.config)
      return apply(env, saved);
  } catch {}
  if (!env.ACTIONS_RUNTIME_TOKEN)
    return false;
  const base = (await fs5.readFile(path3.join(home, ".xenoci-results-url"), "utf8").catch(() => "")).trim();
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
    await fs5.writeFile(file, JSON.stringify(data), { mode: 384, flag: "wx" }).catch(() => {});
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
var FILE = ".xenoci-job-grant.json";
var init_job_grant = () => {};

// integrations/docker-builder/index.mjs
var exports_docker_builder = {};
import fs6 from "node:fs/promises";
import { spawn as spawn2 } from "node:child_process";
import { once } from "node:events";
var env, input = (name) => env[`INPUT_${name.replaceAll("-", "_").toUpperCase()}`] ?? env[`INPUT_${name.toUpperCase()}`];
var init_docker_builder = __esm(async () => {
  init_runtime();
  init_job_grant();
  env = process.env;
  if ((env.HTTPS_PROXY || env.HTTP_PROXY || env.https_proxy || env.http_proxy) && !process.execArgv.includes("--use-env-proxy")) {
    const child = spawn2(process.execPath, ["--use-env-proxy", ...process.execArgv, ...process.argv.slice(1)], { env, stdio: "inherit" });
    const [code] = await once(child, "close");
    process.exit(code ?? 1);
  }
  try {
    const stage = process.argv[2];
    if (stage !== "prepare")
      await ensureJobGrant(env);
    if (env.XENOCI_CACHE_JOB_CAPABILITY)
      console.log(`::add-mask::${env.XENOCI_CACHE_JOB_CAPABILITY}`);
    if (stage === "start") {
      const state = await prepareState(env.RUNNER_TEMP);
      await fs6.appendFile(env.GITHUB_STATE, `ROOT=${state.root}
`);
      let cache = null;
      try {
        cache = cacheFromEnvironment(env);
      } catch {
        console.log("::warning::Docker cache configuration unavailable; continuing without cache");
      }
      const builder = await createBuilderRuntime({ cache }).setup(state, { key: input("cache-key"), buildkitImage: input("buildkit-image"), helperImage: input("helper-image") });
      await fs6.appendFile(env.GITHUB_OUTPUT, `builder=${builder}
name=${builder}
`);
      await fs6.appendFile(env.GITHUB_ENV, `BUILDX_BUILDER=${builder}
`);
    } else if (stage === "finish") {
      if (!env.STATE_ROOT)
        process.exit(0);
      const state = await readState(env.STATE_ROOT, env.RUNNER_TEMP);
      let cache = null;
      try {
        cache = cacheFromEnvironment(env);
      } catch {
        console.log("::warning::Docker cache configuration unavailable; continuing without cache");
      }
      const runtime = createBuilderRuntime({ cache });
      try {
        await runtime.save(state, { succeeded: true });
      } finally {
        await runtime.cleanup(state);
      }
    } else if (stage === "prepare") {
      const state = await prepareState(env.RUNNER_TEMP);
      await fs6.appendFile(env.GITHUB_STATE, `ROOT=${state.root}
`);
      await fs6.appendFile(env.GITHUB_OUTPUT, `root=${state.root}
`);
    } else {
      const root = env.STATE_ROOT || env.INPUT_ROOT;
      if (!root && stage === "cleanup")
        process.exit(0);
      const state = await readState(root, env.RUNNER_TEMP);
      let cache = null;
      try {
        cache = cacheFromEnvironment(env);
      } catch {
        console.log("::warning::Docker cache configuration unavailable; continuing without cache");
      }
      const runtime = createBuilderRuntime({ cache });
      if (stage === "setup") {
        await fs6.appendFile(env.GITHUB_STATE, `ROOT=${root}
`);
        const builder = await runtime.setup(state, { key: input("cache-key"), buildkitImage: input("buildkit-image"), helperImage: input("helper-image") });
        await fs6.appendFile(env.GITHUB_OUTPUT, `builder=${builder}
`);
        await fs6.appendFile(env.GITHUB_ENV, `BUILDX_BUILDER=${builder}
`);
      } else if (stage === "save")
        await runtime.save(state, { succeeded: true });
      else if (stage === "cleanup")
        await runtime.cleanup(state);
      else
        throw Error("invalid builder stage");
    }
  } catch (error) {
    const safe = /^(?:requires the Linux VM local Docker socket|requires a Linux Docker daemon|BuildKit and archive helper images must be digest pinned|cache-key is required|RUNNER_TEMP must be absolute|foreign builder state path|invalid builder ownership|builder volume already exists|foreign builder volume|unexpected BuildKit state volume|foreign BuildKit container|docker [a-z]+ failed \((?:\d+|null)\))$/;
    const reason = safe.test(error.message) ? error.message : "unclassified failure";
    console.error(`::error::Docker builder operation failed: ${reason}`);
    process.exitCode = 1;
  }
});

// integrations/docker-builder/main.mjs
process.argv[2] = "start";
await init_docker_builder().then(() => exports_docker_builder);
