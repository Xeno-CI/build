#!/usr/bin/env node
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

// ../../../tmp/tmp.H2EvQNWTmr/cli/lib.mjs
var exports_lib = {};
__export(exports_lib, {
  ALWAYS_EXCLUDED: () => ALWAYS_EXCLUDED,
  CLIENT_VERSION: () => CLIENT_VERSION,
  DEFAULT_API_URL: () => DEFAULT_API_URL,
  DEFAULT_IGNORE: () => DEFAULT_IGNORE,
  UPLOAD_MAX_BYTES: () => UPLOAD_MAX_BYTES,
  XenociError: () => XenociError,
  buildManifest: () => buildManifest,
  createClient: () => createClient,
  defaultProject: () => defaultProject,
  detectBuildMeta: () => detectBuildMeta,
  exitCodeOf: () => exitCodeOf,
  failureExcerpt: () => failureExcerpt,
  follow: () => follow,
  listFiles: () => listFiles,
  parseGitignore: () => parseGitignore,
  uploadFolder: () => uploadFolder
});
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
function errorDetail(body, text, status) {
  if (!body || typeof body !== "object") {
    const plain = /^\s*</.test(String(text)) ? "" : String(text || "").trim().slice(0, 300);
    return {
      code: plain && /^[a-z][a-z0-9_]{1,63}$/.test(plain) ? plain : status === 404 ? "not_found" : `http_${status}`,
      message: plain || null,
      retryable: status >= 500 || status === 429 ? true : null,
      retry_after_s: null,
      fault: status >= 500 ? "platform" : null,
      next: [],
      docs: null,
      request_id: null
    };
  }
  const env = body.error && typeof body.error === "object" ? body.error : body.error_detail && typeof body.error_detail === "object" ? { code: body.error, ...body.error_detail } : null;
  const code = env?.code ?? (typeof body.error === "string" ? body.error : body.code ?? body.message ?? "error");
  const isCode = /^[a-z][a-z0-9_]{1,63}$/.test(String(code));
  const fallback = status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status === 404 ? "not_found" : status === 429 ? "rate_limited" : `http_${status}`;
  return {
    code: isCode ? String(code) : fallback,
    message: env?.message ?? (typeof body.message === "string" ? body.message : isCode ? null : String(code)),
    retryable: env?.retryable ?? null,
    retry_after_s: env?.retry_after_s ?? null,
    fault: env?.fault ?? null,
    next: Array.isArray(env?.next) ? env.next : [],
    docs: env?.docs ?? null,
    request_id: env?.request_id ?? body.request_id ?? null,
    ...body.items ? { items: body.items } : {},
    ...env?.failure ? { failure: env.failure } : {}
  };
}
function createClient({ key = process.env.XENOCI_API_KEY, url = process.env.XENOCI_API_URL || DEFAULT_API_URL, fetchImpl = fetch, agent = "cli" } = {}) {
  if (!key)
    throw new Error("XENOCI_API_KEY를 설정해 주세요 (API 키: https://xenoci.com/app/api-keys)");
  const base = url.replace(/\/$/, "") + "/api/ci/v1";
  async function request(route, { method = "GET", body, raw, contentType, idempotency } = {}) {
    const headers = { Authorization: `Bearer ${key}`, "XenoCI-Error-Format": "2", "User-Agent": `xenoci-${agent}/${CLIENT_VERSION}` };
    if (body !== undefined)
      headers["Content-Type"] = "application/json";
    if (raw !== undefined)
      headers["Content-Type"] = contentType || "application/gzip";
    if (idempotency)
      headers["Idempotency-Key"] = idempotency;
    const response = await fetchImpl(base + route, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const text = await response.text();
    if (!response.ok) {
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {}
      throw new XenociError(response.status, parsed, text, response.headers?.get?.("x-request-id") ?? null);
    }
    if (!text)
      return {};
    try {
      return JSON.parse(text);
    } catch {
      return { log: text };
    }
  }
  const id = (value) => encodeURIComponent(String(value ?? ""));
  const qs = (query) => {
    const p = new URLSearchParams;
    for (const [k, v] of Object.entries(query || {}))
      if (v != null && v !== "")
        p.set(k, String(v));
    const t = p.toString();
    return t ? `?${t}` : "";
  };
  return {
    request,
    pool: () => request("/pool"),
    rentals: () => request("/rentals"),
    rental: (rentalId) => request(`/rentals/${id(rentalId)}`),
    build: (buildId) => request(`/builds/${id(buildId)}`),
    builds: (query) => request(`/builds${qs(query)}`),
    cancel: (buildId) => request(`/builds/${id(buildId)}/cancel`, { method: "POST" }),
    log: (buildId, offset = 0) => request(`/builds/${id(buildId)}/log?offset=${offset}`),
    wait: (buildId, seconds = 2) => request(`/builds/${id(buildId)}/wait?timeout=${seconds}`),
    submit: (body, idempotency = randomUUID()) => request("/builds", { method: "POST", body, idempotency }),
    upload: (dir, options) => uploadFolder({ request }, dir, options),
    catalog: () => request("/catalog"),
    quote: (body) => request("/quote", { method: "POST", body }),
    orders: (status) => request(`/orders${qs({ status })}`),
    order: (no) => request(`/orders/${id(no)}`),
    createOrder: (body, idempotency = randomUUID()) => request("/orders", { method: "POST", body, idempotency }),
    waitOrder: (no, seconds = 60) => request(`/orders/${id(no)}/wait?timeout=${seconds}`),
    rental: (rentalId) => request(`/rentals/${id(rentalId)}`),
    resetMacs: (body, idempotency) => request("/rentals/reset", { method: "POST", body, idempotency }),
    resetMac: (rentalId, body = {}, idempotency) => request(`/rentals/${id(rentalId)}/reset`, { method: "POST", body, idempotency }),
    setXcode: (body, idempotency) => request("/rentals/xcode", { method: "POST", body, idempotency }),
    setMacXcode: (rentalId, body, idempotency) => request(`/rentals/${id(rentalId)}/xcode`, { method: "POST", body, idempotency }),
    updateMac: (rentalId, body, idempotency) => request(`/rentals/${id(rentalId)}`, { method: "PATCH", body, idempotency }),
    job: (jobId) => request(`/jobs/${id(jobId)}`),
    extendQuote: (rentalId, hours) => request(`/rentals/${id(rentalId)}/extend/quote`, { method: "POST", body: { hours } }),
    extend: (rentalId, hours, idempotency = randomUUID()) => request(`/rentals/${id(rentalId)}/extend`, { method: "POST", body: { hours }, idempotency }),
    extendMany: (rentalIds, hours, idempotency = randomUUID()) => request("/rentals/extend", { method: "POST", body: { rental_ids: rentalIds, hours }, idempotency }),
    waitlist: () => request("/waitlist"),
    joinWaitlist: (body) => request("/waitlist", { method: "POST", body }),
    leaveWaitlist: (entryId) => request(`/waitlist/${id(entryId)}`, { method: "DELETE" }),
    secrets: () => request("/secrets"),
    putSecret: (name, value) => request(`/secrets/${id(name)}`, { method: "PUT", body: { value } }),
    deleteSecret: (name) => request(`/secrets/${id(name)}`, { method: "DELETE" }),
    account: () => request("/me"),
    errors: (query) => request(`/errors${qs(query)}`)
  };
}
async function follow(client, id, { onLog = () => {}, signal } = {}) {
  let offset = 0;
  for (;; ) {
    if (signal?.aborted)
      throw new Error("aborted");
    const state = await client.wait(id, 2);
    const build = state.build || state;
    const log = await client.log(id, offset);
    if (log.log)
      onLog(log.log);
    offset = log.next_offset ?? offset;
    if (TERMINAL.includes(build.state)) {
      const tail = await client.log(id, offset);
      if (tail.log)
        onLog(tail.log);
      return build;
    }
  }
}
function failureExcerpt(log, lines = 60) {
  const all = String(log || "").split(`
`);
  const patterns = [/^(.+?):(\d+):(?:(\d+):)? (?:fatal )?error: (.*)$/, /error: /i, /\*\* (BUILD|TEST|ARCHIVE) FAILED \*\*/, /^(fatal|error)\b|Error:|FAILED|Traceback|panic:/];
  let index = -1, match = null;
  for (const re of patterns) {
    index = all.findIndex((line) => re.test(line));
    if (index >= 0) {
      match = all[index].match(patterns[0]);
      break;
    }
  }
  if (index < 0)
    return { found: false, start_line: Math.max(1, all.length - lines + 1), end_line: all.length, text: all.slice(-lines).join(`
`) };
  const start = Math.max(0, index - Math.floor(lines / 3)), end = Math.min(all.length, start + lines);
  return {
    found: true,
    start_line: start + 1,
    end_line: end,
    error_line: index + 1,
    ...match ? { file: match[1], line: Number(match[2]), message: match[4] } : { message: all[index].trim() },
    text: all.slice(start, end).join(`
`)
  };
}
function globToRegExp(glob) {
  let re = "";
  for (let i = 0;i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else
          re += ".*";
      } else
        re += "[^/]*";
    } else if (c === "?")
      re += "[^/]";
    else if (c === "[") {
      const end = glob.indexOf("]", i);
      if (end === -1)
        re += "\\[";
      else {
        re += glob.slice(i, end + 1).replace(/^\[!/, "[^");
        i = end;
      }
    } else if (c === "\\" && i + 1 < glob.length)
      re += "\\" + glob[++i];
    else
      re += c.replace(/[.+^${}()|]/g, "\\$&");
  }
  return re;
}
function parseGitignore(text) {
  const rules = [];
  for (let line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#"))
      continue;
    line = line.replace(/(?<!\\)\s+$/, "");
    let negate = false;
    if (line.startsWith("!")) {
      negate = true;
      line = line.slice(1);
    } else if (line.startsWith("\\!") || line.startsWith("\\#"))
      line = line.slice(1);
    const dirOnly = line.endsWith("/");
    if (dirOnly)
      line = line.slice(0, -1);
    if (!line)
      continue;
    const anchored = line.includes("/");
    if (line.startsWith("/"))
      line = line.slice(1);
    const body = globToRegExp(line);
    rules.push({ negate, dirOnly, re: new RegExp(anchored ? `^${body}$` : `(?:^|/)${body}$`) });
  }
  return rules;
}
function ignored(stack, rel, isDir) {
  let result = false;
  for (const { base, rules } of stack) {
    const sub = base ? rel.startsWith(base + "/") ? rel.slice(base.length + 1) : null : rel;
    if (sub == null)
      continue;
    for (const rule of rules)
      if ((!rule.dirOnly || isDir) && rule.re.test(sub))
        result = !rule.negate;
  }
  return result;
}
async function gitFiles(root) {
  try {
    const top = (await run("git", ["-C", root, "rev-parse", "--show-toplevel"], { maxBuffer: 1 << 20 })).stdout.trim();
    if (path.resolve(top) !== path.resolve(root))
      return null;
    const { stdout } = await run("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { maxBuffer: 1 << 30 });
    return stdout.split("\x00").filter(Boolean);
  } catch {
    return null;
  }
}
async function walkFiles(root) {
  const out = [];
  const base = fs.existsSync(path.join(root, ".gitignore")) ? [] : [{ base: "", rules: parseGitignore(DEFAULT_IGNORE.join(`
`)) }];
  async function walk(dir, rel, stack) {
    let rules = stack;
    const ignoreFile = path.join(dir, ".gitignore");
    if (fs.existsSync(ignoreFile))
      rules = [...stack, { base: rel, rules: parseGitignore(fs.readFileSync(ignoreFile, "utf8")) }];
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const isDir = entry.isDirectory();
      if (ALWAYS_EXCLUDED.includes(entry.name) || ignored(rules, childRel, isDir))
        continue;
      if (isDir)
        await walk(path.join(dir, entry.name), childRel, rules);
      else if (entry.isFile())
        out.push(childRel);
    }
  }
  await walk(root, "", base);
  return out;
}
async function listFiles(root) {
  const files = await gitFiles(root) || await walkFiles(root);
  return files.filter((rel) => !rel.split("/").some((part) => ALWAYS_EXCLUDED.includes(part))).filter((rel) => {
    try {
      return fs.lstatSync(path.join(root, rel)).isFile();
    } catch {
      return false;
    }
  }).sort();
}
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    fs.createReadStream(file).on("data", (c) => hash.update(c)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });
}
async function buildManifest(root) {
  const files = await listFiles(root);
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile(root), "utf8"));
  } catch {}
  const next = {};
  const manifest = [];
  let total = 0;
  let index = 0;
  async function worker() {
    while (index < files.length) {
      const rel = files[index++];
      const st = fs.statSync(path.join(root, rel));
      const stamp = `${st.size}:${st.mtimeMs}`;
      const sha = cache[rel]?.stamp === stamp ? cache[rel].sha : await hashFile(path.join(root, rel));
      next[rel] = { stamp, sha };
      manifest.push({ path: rel, sha256: sha, size: st.size, mode: st.mode & 73 ? 493 : 420 });
      total += st.size;
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  if (total > UPLOAD_MAX_BYTES)
    throw new Error(`업로드 상한 2GB를 넘습니다 (${(total / 1024 ** 3).toFixed(2)}GB). .gitignore로 빌드에 필요 없는 파일을 빼 주세요.`);
  try {
    fs.mkdirSync(path.dirname(cacheFile(root)), { recursive: true });
    fs.writeFileSync(cacheFile(root), JSON.stringify(next));
  } catch {}
  manifest.sort((a, b) => a.path < b.path ? -1 : 1);
  return { files: manifest, total };
}
async function detectBuildMeta(dir, explicit = {}, env = process.env) {
  const prOf = (value) => {
    const m = /(?:^|\/)([1-9][0-9]*)$/.exec(String(value ?? "").trim());
    return m ? Number(m[1]) : null;
  };
  const shaOf = (value) => /^[0-9a-f]{7,40}$/i.test(String(value ?? "").trim()) ? String(value).trim() : null;
  let event = null;
  if (env.GITHUB_EVENT_PATH) {
    try {
      event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
    } catch {
      event = null;
    }
  }
  const pr = prOf(explicit.pr) ?? prOf(event?.pull_request?.number) ?? prOf(env.CHANGE_ID) ?? prOf(env.CI_MERGE_REQUEST_IID) ?? prOf(env.BUILDKITE_PULL_REQUEST) ?? prOf(env.CIRCLE_PULL_REQUEST) ?? prOf(env.BITRISE_PULL_REQUEST) ?? prOf(env.SYSTEM_PULLREQUEST_PULLREQUESTNUMBER);
  let commit = shaOf(explicit.commit) ?? shaOf(event?.pull_request?.head?.sha) ?? shaOf(env.GITHUB_SHA) ?? shaOf(env.GIT_COMMIT) ?? shaOf(env.CI_COMMIT_SHA) ?? shaOf(env.BUILDKITE_COMMIT) ?? shaOf(env.CIRCLE_SHA1) ?? shaOf(env.BITRISE_GIT_COMMIT) ?? shaOf(env.BUILD_SOURCEVERSION);
  if (!commit && dir) {
    try {
      commit = shaOf((await run("git", ["-C", dir, "rev-parse", "HEAD"])).stdout);
    } catch {
      commit = null;
    }
  }
  const repo = [explicit.repo, env.GITHUB_REPOSITORY].find((v) => /^[\w.-]+\/[\w.-]+$/.test(String(v ?? ""))) ?? null;
  return { pr, commit, repo };
}
function defaultProject(root) {
  const name = path.basename(path.resolve(root)).replace(/[^\w.-]/g, "-").slice(0, 40) || "project";
  return `${name}-${createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 6)}`;
}
async function uploadFolder(client, root, { project = defaultProject(root), onProgress = () => {} } = {}) {
  const started = Date.now();
  const { files, total } = await buildManifest(root);
  const hashed = Date.now();
  const created = await client.request("/uploads", { method: "POST", raw: zlib.gzipSync(JSON.stringify({ project, files })) });
  const missing = new Set(created.missing);
  const bySha = new Map(files.filter((f) => missing.has(f.sha256)).map((f) => [f.sha256, f]));
  const batches = [];
  let current = [], size = 0;
  for (const f of bySha.values()) {
    if (current.length && size + f.size > BATCH_BYTES) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(f);
    size += f.size;
  }
  if (current.length)
    batches.push(current);
  let sent = 0, compressed = 0, next = 0;
  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++];
      const parts = [];
      for (const f of batch) {
        parts.push(Buffer.from(`${f.sha256} ${f.size}
`));
        parts.push(fs.readFileSync(path.join(root, f.path)));
      }
      const body = zlib.gzipSync(Buffer.concat(parts), { level: 6 });
      await client.request(`/uploads/${created.id}/blobs`, { method: "POST", raw: body });
      sent += batch.reduce((s, f) => s + f.size, 0);
      compressed += body.length;
      onProgress({ sent, total: created.missing_bytes });
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, worker));
  return {
    upload_id: created.id,
    project,
    files: files.length,
    total_bytes: total,
    sent_files: bySha.size,
    sent_bytes: sent,
    wire_bytes: compressed,
    hash_ms: hashed - started,
    upload_ms: Date.now() - hashed
  };
}
var run, UPLOAD_MAX_BYTES, ALWAYS_EXCLUDED, BATCH_BYTES, TERMINAL, XenociError, DEFAULT_API_URL = "https://xenoci.com", CLIENT_VERSION = "1.2.2", exitCodeOf = (build) => Number.isInteger(build.exit_code) ? build.exit_code : build.state === "succeeded" ? 0 : 1, DEFAULT_IGNORE, cacheFile = (root) => path.join(process.env.XENOCI_CACHE_DIR || path.join(os.homedir(), ".cache", "xenoci"), `${createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 16)}.json`);
var init_lib = __esm(() => {
  run = promisify(execFile);
  UPLOAD_MAX_BYTES = 2 * 1024 ** 3;
  ALWAYS_EXCLUDED = [".git", "DerivedData", "Pods", "node_modules", ".build", ".swiftpm", "xcuserdata", ".DS_Store", ".xeno"];
  BATCH_BYTES = 32 * 1024 * 1024;
  TERMINAL = ["succeeded", "failed", "cancelled", "expired"];
  XenociError = class XenociError extends Error {
    constructor(status, body, text = "", requestId = null) {
      const detail = errorDetail(body, text, status);
      super(`요청 실패: HTTP ${status} ${detail.code}${detail.message && detail.message !== detail.code ? ` — ${detail.message}` : ""}`);
      this.name = "XenociError";
      this.status = status;
      this.code = detail.code;
      this.envelope = { ...detail, status, request_id: detail.request_id ?? requestId ?? null };
    }
  };
  DEFAULT_IGNORE = [
    "build/",
    "*.xcarchive",
    "*.xcresult",
    "*.ipa",
    "*.dSYM",
    "*.dSYM.zip",
    "Carthage/Build/",
    ".gradle/",
    "__pycache__/",
    "*.pyc",
    ".venv/",
    ".idea/",
    ".tox/",
    "fastlane/report.xml",
    "fastlane/Preview.html",
    "fastlane/screenshots/",
    "fastlane/test_output/"
  ];
});

// ../../../tmp/tmp.H2EvQNWTmr/mcp/server.mjs
import path2 from "node:path";
import readline from "node:readline";
var lib = await Promise.resolve().then(() => (init_lib(), exports_lib));
var { createClient: createClient2, follow: follow2, exitCodeOf: exitCodeOf2, XenociError: XenociError2, failureExcerpt: failureExcerpt2 } = lib;
var LOG_TAIL = 20000;
var VERSION = lib.CLIENT_VERSION === "dev" ? "0.2.0" : lib.CLIENT_VERSION;
var PAY_NOTE = "Show pay_url to the user as a link and ask them to open it, sign in with the same account, accept the terms and pay. You cannot pay. Then call wait_order.";
var str = (description, extra = {}) => ({ type: "string", description, ...extra });
var int = (description, extra = {}) => ({ type: "integer", description, ...extra });
var obj = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
var HOURS = int("Rental length in hours, a multiple of 24 (24 = one 24-hour pass).", { minimum: 24, multipleOf: 24 });
var tools = [
  { name: "catalog", description: "Mac products: price per 24h (KRW, VAT incl.), vCPU/RAM, Xcode versions, how many can start now, sales_open. Call first.", inputSchema: obj() },
  { name: "quote", description: "Price and availability for a new rental before ordering. No side effects.", inputSchema: obj({ tier: str("Product id from catalog.tiers[].id"), units: int("Number of Macs", { minimum: 1, default: 1 }), hours: HOURS }, ["tier", "hours"]) },
  {
    name: "create_order",
    description: `Reserve Macs and get a payment link (status awaiting_payment, hold expires at pay_url_expires_at). ${PAY_NOTE}`,
    inputSchema: obj({
      tier: str("Product id from catalog"),
      units: int("Number of Macs", { minimum: 1, default: 1 }),
      hours: HOURS,
      xcode: str("Xcode version from catalog (optional)"),
      start: str('"now" (default) or an ISO time')
    }, ["tier", "hours"])
  },
  { name: "order_status", description: "One order: status (awaiting_payment, paid, provisioning, ready, expired, canceled), pay_url, rental_ids. Without order_no lists recent orders (optional status filter).", inputSchema: obj({ order_no: str("Order number RT-..."), status: { type: "string", enum: ["awaiting_payment", "paid", "provisioning", "ready", "expired", "canceled"] } }) },
  { name: "wait_order", description: "Wait until an order is paid and its Macs are ready (or it expires). Long-poll up to timeout_s (max 60); call again while status is not final.", inputSchema: obj({ order_no: str("Order number RT-..."), timeout_s: int("Seconds to wait", { minimum: 0, maximum: 60, default: 60 }) }, ["order_no"]) },
  { name: "list_macs", description: "Rented Macs: id, state, Xcode, remaining_minutes, ends_at, can_extend, current build; plus the build queue.", inputSchema: obj() },
  {
    name: "extend",
    description: `Extend one or more rented Macs by hours (multiple of 24). One Mac: rental_id. Several: rental_ids (one payment). Returns a pay_url. ${PAY_NOTE}`,
    inputSchema: obj({
      rental_id: str("Mac id rt_..."),
      rental_ids: { type: "array", items: { type: "string" }, description: "Several Mac ids" },
      hours: HOURS,
      quote_only: { type: "boolean", description: "Only show the price, create nothing" }
    }, ["hours"])
  },
  {
    name: "reset_macs",
    description: 'Reset the VM of every rented Mac (all=true) or some (ids), or one (rental_id). keep_cache=true only empties the work folder; false (default) makes a new VM (at most once per 10 minutes per Mac). A Mac running a build needs when="after_build" (after it) or "now" (cancel it). Each Mac is accepted or rejected with a reason and a job_id; follow with job_status. Scope manage.',
    inputSchema: obj({ all: { type: "boolean" }, ids: { type: "array", items: str("Mac id rt_..."), maxItems: 50 }, rental_id: str("one Mac id rt_..."), keep_cache: { type: "boolean" }, when: str("after_build or now", { enum: ["after_build", "now"] }), idempotency_key: str("optional; the same key and input makes one job") })
  },
  {
    name: "set_xcode",
    description: "Change the Xcode version of every rented Mac (all=true), some (ids) or one (rental_id). A Mac whose tier does not offer the version is rejected alone (reason xcode_not_available, detail.options). Same when/job rules as reset_macs. Scope manage.",
    inputSchema: obj({ version: str("Xcode version, e.g. 27.0"), all: { type: "boolean" }, ids: { type: "array", items: str("Mac id rt_..."), maxItems: 50 }, rental_id: str("one Mac id rt_..."), when: str("after_build or now", { enum: ["after_build", "now"] }), idempotency_key: str("optional") }, ["version"])
  },
  {
    name: "update_mac",
    description: "Change one Mac's setup: xcode, runtimes (simulator runtimes), tools, keep_cache. Only values in that Mac's setup_options (list_macs / the catalog). Returns a job_id; follow with job_status. Scope manage.",
    inputSchema: obj({ rental_id: str("Mac id rt_..."), xcode: str("Xcode version"), runtimes: { type: "array", items: str("e.g. iOS 26.6") }, tools: { type: "array", items: str("tool id, e.g. fastlane") }, keep_cache: { type: "boolean" }, when: str("after_build or now", { enum: ["after_build", "now"] }), idempotency_key: str("optional") }, ["rental_id"])
  },
  {
    name: "job_status",
    description: "State of a reset / Xcode / setup job: queued (waiting for a build to end), running, done or failed (error, message). While it runs the Mac reads mac_state resetting or updating.",
    inputSchema: obj({ job_id: str("Job id op_...") }, ["job_id"])
  },
  { name: "join_waitlist", description: "Get notified when a sold-out product is back. leave=true with id removes the entry; no args lists entries.", inputSchema: obj({ tier: str("Product id"), units: int("Number of Macs", { minimum: 1, default: 1 }), id: str("Waitlist entry id (to leave)"), leave: { type: "boolean" } }) },
  {
    name: "build",
    description: "Run a build on a rented Mac. Default uploads dir (only changed files after the first time); or repo+ref / repo_url. wait=true (default) waits and returns state, exit code, failure summary and log tail.",
    inputSchema: obj({
      script: str('Shell commands run on the Mac in the uploaded folder, e.g. "xcodebuild -scheme App test" or "bash ci.sh". "./ci.sh" works only if ci.sh is executable (chmod +x) in the folder; "bash ci.sh" always works.'),
      dir: str("Folder to upload (default: current folder)"),
      repo: str("GitHub owner/name (public)"),
      repo_url: str("Public git https URL"),
      ref: str("Branch, tag or commit"),
      xcode: str("Xcode version"),
      rental_id: str("Run on this Mac (default: any free Mac of yours)"),
      timeout_min: int("Build time limit", { minimum: 1, maximum: 360 }),
      queue_until_rental: { type: "boolean", description: "If you have no Mac yet, keep the build queued until an order becomes ready" },
      clean: { type: "boolean", description: "Discard the source cached on the Mac" },
      wait: { type: "boolean", default: true },
      pr: int("Pull request number this build is for; find it later with GET /builds?pr=N (auto from CI variables when omitted)", { minimum: 1 }),
      commit: str("Commit SHA being built (auto: git rev-parse HEAD in dir, or the CI commit)"),
      upload_repo: str("GitHub owner/name to label an uploaded folder with (display and ?repo= filter only; not cloned). Auto from GITHUB_REPOSITORY")
    }, ["script"])
  },
  { name: "build_status", description: "Build state (queued with position, running, succeeded, failed, cancelled), exit code, failure summary.", inputSchema: obj({ id: str("Build id rb_...") }, ["id"]) },
  { name: "wait_build", description: "Wait for a build to finish, up to timeout_s (max 60). Call again while state is queued or running.", inputSchema: obj({ id: str("Build id rb_..."), timeout_s: int("Seconds", { minimum: 0, maximum: 60, default: 60 }) }, ["id"]) },
  {
    name: "build_log",
    description: "Read a build log. mode=failure: the lines around the first error (file:line: error); mode=tail: last N lines; mode=range: bytes from offset.",
    inputSchema: obj({ id: str("Build id rb_..."), mode: { type: "string", enum: ["failure", "tail", "range"], default: "tail" }, lines: int("Lines for tail/failure", { minimum: 1, maximum: 2000, default: 200 }), offset: int("Byte offset for range", { minimum: 0 }) }, ["id"])
  },
  { name: "cancel_build", description: "Cancel a queued or running build.", inputSchema: obj({ id: str("Build id rb_...") }, ["id"]) },
  { name: "list_errors", description: "Recent API errors and failed builds of this account with request_id, code and fault (client / customer / platform / payment / capacity / unknown). Platform faults are already reported to XenoCI.", inputSchema: obj({ since: str("ISO time"), code: str("Error code"), fault: { type: "string", enum: ["client", "customer", "platform", "payment", "capacity", "unknown"] }, kind: { type: "string", enum: ["api", "build"] } }) },
  {
    name: "secrets",
    description: "Build secrets (env vars, masked in logs). action=list returns names only; put sets name=value; delete removes. Values are never returned.",
    inputSchema: obj({ action: { type: "string", enum: ["list", "put", "delete"], default: "list" }, name: str("UPPER_SNAKE name"), value: str("Secret value (put only)") })
  },
  { name: "account", description: "This API key: account, key name, permission levels (read, build, manage; older keys may also list order and secrets, which manage covers), limits and remaining requests/builds/pending orders.", inputSchema: obj() }
];
var ALIASES = { build_logs: "build_log", list_rentals: "list_macs" };
var send = (message) => process.stdout.write(JSON.stringify(message) + `
`);
var text = (value, isError = false) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], isError });
var minutes = (ms) => Number.isFinite(ms) ? Math.floor(ms / 60000) : null;
var buildView = (b) => ({
  id: b.id,
  state: b.state,
  exit_code: b.exit_code ?? null,
  queue_position: b.queue_position ?? null,
  estimated_start_at: b.estimated_start_at ?? null,
  rental_id: b.rental_id ?? null,
  end_reason: b.end_reason ?? null,
  ...b.failure ? { failure: b.failure } : {},
  ...b.queue ? { queue: b.queue } : {}
});
var payView = (o) => ({
  order_no: o.order_no,
  kind: o.kind ?? null,
  status: o.status,
  amount_won: o.amount_won,
  pay_url: o.pay_url ?? null,
  pay_url_expires_at: o.pay_url_expires_at ?? o.hold_expires_at ?? null,
  rental_ids: o.rental_ids ?? [],
  items: o.items ?? null,
  ...o.refund_status ? { refund_status: o.refund_status } : {},
  ...o.next ? { next: o.next } : {},
  ...o.status === "awaiting_payment" ? { next_step: PAY_NOTE } : {}
});
async function call(requested, args = {}, client, progress) {
  const name = ALIASES[requested] || requested;
  switch (name) {
    case "catalog":
      return text(await client.catalog());
    case "quote":
      return text(await client.quote({ tier: args.tier, units: args.units ?? 1, hours: args.hours }));
    case "create_order": {
      const body2 = { tier: args.tier, units: args.units ?? 1, hours: args.hours, ...args.start ? { start: args.start } : {}, ...args.xcode ? { setup: { xcode: args.xcode } } : {} };
      return text(payView(await client.createOrder(body2)));
    }
    case "order_status":
      return text(args.order_no ? payView(await client.order(args.order_no)) : { orders: ((await client.orders(args.status)).orders || []).slice(0, 20).map(payView) });
    case "wait_order": {
      const r = await client.waitOrder(args.order_no, args.timeout_s ?? 60);
      return text(payView(r.order || r));
    }
    case "list_macs": {
      const data = await client.rentals();
      return text({ pool: data.pool, [requested === "list_rentals" ? "rentals" : "macs"]: (data.rentals || []).map((r) => ({
        id: r.public_id || r.id,
        tier: r.tier,
        state: r.state,
        vm_state: r.vm_state,
        xcode: r.xcode,
        remaining_minutes: minutes(r.remaining_ms),
        ends_at: r.ends_at,
        can_extend: r.can_extend ?? null,
        extend_deadline_at: r.extend_deadline_at ?? null,
        max_extend_days: r.max_extend_days ?? null,
        current_build_id: r.current_build_id ?? null,
        mac_state: r.mac_state ?? null,
        setup: r.setup ?? null,
        setup_options: r.setup_options ?? null,
        op: r.op ?? null
      })) });
    }
    case "extend": {
      const ids = args.rental_ids?.length ? args.rental_ids : args.rental_id ? [args.rental_id] : [];
      if (!ids.length)
        return text({ error: { code: "invalid_request", message: "rental_id or rental_ids is required", retryable: false, next: [{ action: "list_macs" }] } }, true);
      if (args.quote_only)
        return text(ids.length === 1 ? await client.extendQuote(ids[0], args.hours) : await client.request("/rentals/extend/quote", { method: "POST", body: { rental_ids: ids, hours: args.hours } }));
      return text(payView(ids.length === 1 ? await client.extend(ids[0], args.hours) : await client.extendMany(ids, args.hours)));
    }
    case "reset_macs":
    case "set_xcode": {
      const xcode = name === "set_xcode";
      const opts = { ...xcode ? { version: args.version } : { keep_cache: args.keep_cache === true }, ...args.when ? { when: args.when } : {} };
      if (args.rental_id)
        return text(xcode ? await client.setMacXcode(args.rental_id, opts, args.idempotency_key) : await client.resetMac(args.rental_id, opts, args.idempotency_key));
      const target = args.all === true ? { all: true } : { ids: args.ids };
      const result2 = xcode ? await client.setXcode({ ...target, ...opts }, args.idempotency_key) : await client.resetMacs({ ...target, ...opts }, args.idempotency_key);
      return text(result2, !(result2.items || []).every((item) => item.result === "accepted"));
    }
    case "update_mac": {
      const body2 = Object.fromEntries(["xcode", "runtimes", "tools", "keep_cache", "when"].filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
      return text(await client.updateMac(args.rental_id, body2, args.idempotency_key));
    }
    case "job_status":
      return text(await client.job(args.job_id));
    case "join_waitlist": {
      if (args.leave)
        return text(await client.leaveWaitlist(args.id));
      if (!args.tier)
        return text(await client.waitlist());
      return text(await client.joinWaitlist({ tier: args.tier, units: args.units ?? 1 }));
    }
    case "build_status":
      return text(buildView(await client.build(args.id)));
    case "wait_build": {
      const r = await client.wait(args.id, args.timeout_s ?? 60);
      return text(buildView(r.build || r));
    }
    case "build_log": {
      const mode = args.mode || "tail", lines = args.lines || 200;
      if (mode === "range") {
        const l2 = await client.log(args.id, args.offset || 0);
        return text({ offset: l2.offset, next_offset: l2.next_offset, log: l2.log || "" });
      }
      const l = await client.log(args.id, 0);
      if (mode === "failure") {
        const b = await client.build(args.id);
        const range = b.failure?.log_excerpt_lines;
        const all2 = String(l.log || "").split(`
`);
        const excerpt = Array.isArray(range) ? {
          found: true,
          start_line: range[0],
          end_line: range[1],
          ...b.failure.location ? { file: b.failure.location.file, line: b.failure.location.line } : {},
          text: all2.slice(Math.max(0, range[0] - 1 - 20), range[1] + 20).join(`
`)
        } : failureExcerpt2(l.log, lines);
        return text({ id: args.id, state: b.state, exit_code: b.exit_code ?? null, ...b.failure ? { failure: b.failure } : {}, excerpt });
      }
      const all = String(l.log || "").split(`
`);
      return text({ id: args.id, total_lines: all.length, start_line: Math.max(1, all.length - lines + 1), next_offset: l.next_offset, log: all.slice(-lines).join(`
`) });
    }
    case "cancel_build":
      return text(buildView(await client.cancel(args.id)));
    case "list_errors":
      return text(await client.errors({ since: args.since, code: args.code, fault: args.fault, kind: args.kind }));
    case "secrets": {
      const action = args.action || "list";
      if (action === "list")
        return text(await client.secrets());
      if (!args.name)
        return text({ error: { code: "invalid_request", message: "name is required", retryable: false, next: [] } }, true);
      if (action === "put")
        return text(await client.putSecret(args.name, args.value));
      return text(await client.deleteSecret(args.name));
    }
    case "account":
      return text(await client.account());
    case "build":
      break;
    default:
      throw Object.assign(new Error(`unknown tool ${requested}`), { rpc: -32602 });
  }
  if (typeof args.script !== "string" || !args.script.trim())
    return text({ error: { code: "invalid_request", message: "script is required", retryable: false, next: [] } }, true);
  const body = { script: args.script };
  for (const k of ["ref", "xcode", "timeout_min", "rental_id", "queue_until_rental"])
    if (args[k] != null)
      body[k] = args[k];
  if (args.clean)
    body.clean_tree = true;
  let upload = null;
  const dir = path2.resolve(args.dir || process.cwd());
  const refSha = /^[0-9a-f]{7,40}$/i.test(args.ref || "") ? args.ref : undefined;
  const meta = await lib.detectBuildMeta(args.repo || args.repo_url ? null : dir, { pr: args.pr, commit: args.commit ?? refSha, repo: args.upload_repo });
  if (meta.pr != null)
    body.pr = meta.pr;
  if (meta.commit)
    body.commit = meta.commit;
  if (args.repo)
    body.repo = args.repo;
  else if (args.repo_url)
    body.repo_url = args.repo_url;
  else {
    upload = await client.upload(dir);
    body.upload_id = upload.upload_id;
    if (meta.repo)
      body.repo = meta.repo;
  }
  const submitted = await client.submit(body);
  const uploaded = upload ? { files: upload.files, sent_files: upload.sent_files, sent_mb: +(upload.sent_bytes / 1048576).toFixed(1) } : null;
  if (args.wait === false)
    return text({ ...buildView(submitted), upload: uploaded, next_step: "Call wait_build with this id." });
  let log = "";
  const build = await follow2(client, submitted.id, { onLog: (t) => {
    log = (log + t).slice(-LOG_TAIL);
    progress(t);
  } });
  const code = exitCodeOf2(build);
  const final = await client.build(submitted.id).catch(() => build);
  const result = { ...buildView({ ...build, ...final }), exit_code: code, upload: uploaded };
  if (code !== 0)
    result.failure_excerpt = failureExcerpt2(log, 60);
  return text(`${JSON.stringify(result, null, 2)}
--- log tail ---
${log.slice(-8000)}`, code !== 0);
}
function errorResult(error) {
  if (error instanceof XenociError2 || error?.envelope)
    return text({ error: error.envelope }, true);
  return text({ error: { code: "client_error", message: error.message, retryable: false, next: [] } }, true);
}
function startServer({ input = process.stdin, client: injected } = {}) {
  let client = injected;
  const rl = readline.createInterface({ input });
  rl.on("line", async (line) => {
    if (!line.trim())
      return;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    }
    if (m.id === undefined)
      return;
    try {
      let result;
      if (m.method === "initialize")
        result = {
          protocolVersion: m.params?.protocolVersion || "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "xenoci", version: VERSION },
          instructions: "XenoCI rents dedicated Mac mini M4 VMs for builds. Flow: catalog -> create_order -> show pay_url to the user -> wait_order -> build -> on failure build_log mode=failure, fix, build again -> list_macs to see remaining time -> extend (pay_url) if needed. On an error read error.code, error.retryable and error.next. Docs: https://xenoci.com/llms.txt"
        };
      else if (m.method === "ping")
        result = {};
      else if (m.method === "tools/list")
        result = { tools };
      else if (m.method === "tools/call") {
        const token = m.params?._meta?.progressToken;
        let count = 0;
        const progress = (t) => {
          if (token !== undefined)
            send({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: token, progress: ++count, message: t.slice(-500) } });
        };
        try {
          client ||= createClient2({ agent: "mcp" });
          result = await call(m.params?.name, m.params?.arguments || {}, client, progress);
        } catch (error) {
          if (error.rpc)
            throw error;
          result = errorResult(error);
        }
      } else
        throw Object.assign(new Error("method not found"), { rpc: -32601 });
      send({ jsonrpc: "2.0", id: m.id, result });
    } catch (error) {
      send({ jsonrpc: "2.0", id: m.id, error: { code: error.rpc || -32603, message: error.message } });
    }
  });
  return rl;
}

// ../../../tmp/tmp.H2EvQNWTmr/mcp/bin.mjs
startServer();
