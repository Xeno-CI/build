#!/usr/bin/env node

// ../../../../tmp/tmp.8H0SAuTqNi/cli/xenoci.mjs
import { readFile as readFile2, writeFile, mkdir } from "node:fs/promises";
import { createHash as createHash3 } from "node:crypto";
import path2 from "node:path";

// ../../../../tmp/tmp.8H0SAuTqNi/cli/lib.mjs
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
var run = promisify(execFile);
var UPLOAD_MAX_BYTES = 2 * 1024 ** 3;
var ALWAYS_EXCLUDED = [".git", "DerivedData", "Pods", "node_modules", ".build", ".swiftpm", "xcuserdata", ".DS_Store", ".xeno"];
var BATCH_BYTES = 32 * 1024 * 1024;
var TERMINAL = ["succeeded", "failed", "cancelled", "expired"];

class XenociError extends Error {
  constructor(status, body, text = "", requestId = null) {
    const detail = errorDetail(body, text, status);
    super(`요청 실패: HTTP ${status} ${detail.code}${detail.message && detail.message !== detail.code ? ` — ${detail.message}` : ""}`);
    this.name = "XenociError";
    this.status = status;
    this.code = detail.code;
    this.envelope = { ...detail, status, request_id: detail.request_id ?? requestId ?? null };
  }
}
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
var DEFAULT_API_URL = "https://xenoci.com";
var CLIENT_VERSION = "1.2.5";
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
    artifacts: (buildId) => request(`/builds/${id(buildId)}/artifacts`),
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
var exitCodeOf = (build) => Number.isInteger(build.exit_code) ? build.exit_code : build.state === "succeeded" ? 0 : 1;
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
var DEFAULT_IGNORE = [
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
var cacheFile = (root) => path.join(process.env.XENOCI_CACHE_DIR || path.join(os.homedir(), ".cache", "xenoci"), `${createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 16)}.json`);
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

// ../../../../tmp/tmp.8H0SAuTqNi/cli/ios.mjs
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";
import { open, readFile, link, unlink } from "node:fs/promises";
import { resolve, dirname, basename, join } from "node:path";
var IOS_USAGE = `사용법:
  xenoci ios capabilities
  xenoci ios build --app ID --input build.json --idempotency-key KEY
  xenoci ios sim open --app ID --input simulator.json --idempotency-key KEY
  xenoci ios sim screenshot --app ID --session ID --idempotency-key KEY
  xenoci ios sim record start --app ID --session ID --max-seconds 30 --idempotency-key KEY
  xenoci ios sim record stop --app ID --session ID --recording ID --idempotency-key KEY
  xenoci ios sim tap --app ID --session ID --sequence N --x X --y Y --idempotency-key KEY
  xenoci ios job wait ID [--wait-seconds 75]
  xenoci ios artifact download ID --app ID --output ./capture.png
공통: --json. XENOCI_API_KEY는 iOS 권한을 받은 계정 키, XENOCI_API_URL은 origin입니다.
변경은 접수된 job_id를 반환합니다. job wait 종료 코드: 완료 0, 실패 1, 계속 대기 2.
--input은 capabilities와 인증된 /api/v1/ios/openapi.json의 요청 본문 JSON 파일입니다.
다운로드는 서버의 bytes/SHA256 검증 후 저장하며 기존 파일을 덮어쓰지 않습니다.`;
function invalid(message, code = "invalid_argument") {
  return Object.assign(new Error(message), { envelope: { code, message, retryable: false } });
}
var id = (value) => {
  if (typeof value !== "string" || !/^[A-Z0-9]{24}$/.test(value))
    throw invalid("24자리 대문자/숫자 리소스 ID가 필요합니다");
  return value;
};
function createIosClient({ key = process.env.XENOCI_API_KEY, url = process.env.XENOCI_API_URL || "https://xenoci.com", fetchImpl = fetch } = {}) {
  if (!key)
    throw invalid("XENOCI_API_KEY를 설정해 주세요", "unauthorized");
  const origin = new URL(url);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/" || origin.protocol !== "https:" && !(origin.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname))) {
    throw invalid("XENOCI_API_URL은 HTTPS origin이어야 합니다 (로컬 시험은 loopback HTTP 허용)");
  }
  const base = origin.origin + "/api/v1/ios";
  async function response(route, { method = "GET", body, idempotency, revision, seconds = 100 } = {}) {
    if (!route.startsWith("/") || route.startsWith("//") || route.includes(".."))
      throw invalid("잘못된 API 경로");
    const headers = { Authorization: `Bearer ${key}`, "XenoCI-Error-Format": "2", "User-Agent": `xenoci-cli/${CLIENT_VERSION}` };
    if (body !== undefined)
      headers["Content-Type"] = "application/json";
    if (idempotency)
      headers["Idempotency-Key"] = idempotency;
    if (revision !== undefined)
      headers["If-Match"] = String(revision);
    let res;
    try {
      res = await fetchImpl(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(seconds * 1000) });
    } catch {
      throw invalid("응답을 받지 못했습니다. 변경 요청은 같은 멱등 키로 확인하세요.", "transport_error");
    }
    if (!res.ok) {
      const text = await res.text();
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        value = null;
      }
      const error = new XenociError(res.status, value, "", res.headers.get("x-request-id"));
      const detail = typeof value?.error === "object" ? value.error : value?.error_detail;
      for (const field of ["retry_after_seconds", "field", "provider_code", "external_task_id"]) {
        if (detail?.[field] !== undefined)
          error.envelope[field] = detail[field];
      }
      throw error;
    }
    return res;
  }
  async function request(route, options) {
    const res = await response(route, options);
    try {
      return await res.json();
    } catch {
      throw invalid("서버가 JSON 응답을 반환하지 않았습니다", "invalid_response");
    }
  }
  async function download(appId, artifactId, output) {
    id(appId);
    id(artifactId);
    let cursor, artifact;
    const cursors = new Set;
    do {
      const page = await request(`/apps/${appId}/artifacts?limit=100${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`);
      if (!Array.isArray(page.items))
        throw invalid("산출물 목록 형식이 잘못됐습니다", "invalid_response");
      artifact = page.items.find((item) => item.artifact_id === artifactId);
      if (artifact)
        break;
      cursor = page.next_cursor;
      if (cursor && (typeof cursor !== "string" || cursors.has(cursor)))
        throw invalid("산출물 목록 cursor가 반복됩니다", "invalid_response");
      if (cursor)
        cursors.add(cursor);
    } while (cursor);
    if (!artifact)
      throw invalid("앱에 속한 산출물을 찾지 못했습니다", "not_found");
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0 || !/^[a-f0-9]{64}$/.test(artifact.sha256))
      throw invalid("산출물 크기/해시가 없습니다", "invalid_response");
    const target = resolve(output);
    const temporary = join(dirname(target), `.${basename(target)}.${randomUUID2()}.part`);
    const file = await open(temporary, "wx", 384);
    let bytes = 0;
    const hash = createHash2("sha256");
    try {
      const res = await response(`/apps/${appId}/artifacts/${artifactId}/content`, { seconds: 300 });
      if (res.status !== 200 || !res.body)
        throw invalid("전체 산출물 응답이 아닙니다", "invalid_response");
      for await (const chunk of res.body) {
        bytes += chunk.length;
        if (bytes > artifact.bytes)
          throw invalid("산출물 크기가 메타데이터보다 큽니다", "checksum_mismatch");
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.length) {
          const written = await file.write(chunk, offset, chunk.length - offset);
          if (!written.bytesWritten)
            throw invalid("파일 저장에 실패했습니다", "write_failed");
          offset += written.bytesWritten;
        }
      }
      if (bytes !== artifact.bytes || hash.digest("hex") !== artifact.sha256)
        throw invalid("산출물 크기 또는 SHA256이 일치하지 않습니다", "checksum_mismatch");
      await file.sync();
      await file.close();
      await link(temporary, target);
      return { artifact_id: artifactId, path: target, bytes, sha256: artifact.sha256 };
    } finally {
      await file.close();
      await unlink(temporary);
    }
  }
  return { request, download };
}
async function runIos(argv) {
  if (!argv.length || argv.includes("--help")) {
    console.log(IOS_USAGE);
    return 0;
  }
  const words = [], flags = {};
  for (let index = 0;index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      words.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (Object.hasOwn(flags, name))
      throw invalid(`--${name} 중복`);
    if (name === "json") {
      flags[name] = true;
      continue;
    }
    if (argv[index + 1] === undefined || argv[index + 1].startsWith("--"))
      throw invalid(`--${name} 값이 필요합니다`);
    flags[name] = argv[++index];
  }
  const command = words[0] === "sim" && words[1] === "record" ? words.slice(0, 3).join(" ") : ["sim", "job", "artifact"].includes(words[0]) ? words.slice(0, 2).join(" ") : words[0];
  const common = ["json"];
  const options = {
    capabilities: [],
    build: ["app", "input", "idempotency-key", "revision"],
    "sim open": ["app", "input", "idempotency-key"],
    "sim screenshot": ["app", "session", "idempotency-key"],
    "sim record start": ["app", "session", "max-seconds", "idempotency-key"],
    "sim record stop": ["app", "session", "recording", "idempotency-key"],
    "sim tap": ["app", "session", "sequence", "x", "y", "idempotency-key"],
    "job wait": ["wait-seconds"],
    "artifact download": ["app", "output"]
  };
  if (!Object.hasOwn(options, command))
    throw invalid(IOS_USAGE);
  for (const flag of Object.keys(flags))
    if (![...common, ...options[command]].includes(flag))
      throw invalid(`지원하지 않는 옵션: --${flag}`);
  const prefixLength = command.split(" ").length;
  const positionals = words.slice(prefixLength);
  if (positionals.length !== (["job wait", "artifact download"].includes(command) ? 1 : 0))
    throw invalid("명령의 위치 인자가 잘못됐습니다");
  const required = (name) => {
    if (!flags[name])
      throw invalid(`--${name} 값이 필요합니다`);
    return flags[name];
  };
  const number = (name, min, max, integer = true, fallback) => {
    const raw = flags[name] ?? fallback;
    const value = raw === undefined || String(raw).trim() === "" ? NaN : Number(raw);
    if (!Number.isFinite(value) || integer && !Number.isSafeInteger(value) || value < min || value > max)
      throw invalid(`--${name} 범위: ${min}..${max}`);
    return value;
  };
  let route = "/capabilities", requestOptions, output;
  if (command === "job wait")
    route = `/jobs/${id(positionals[0])}/wait?wait_seconds=${number("wait-seconds", 1, 90, true, 75)}`;
  else if (command === "artifact download") {
    id(positionals[0]);
    id(required("app"));
    output = required("output");
  } else if (command !== "capabilities") {
    const app = id(required("app"));
    const idempotency = required("idempotency-key");
    if (idempotency.length > 128 || /[\r\n]/.test(idempotency))
      throw invalid("잘못된 Idempotency-Key");
    let body = {};
    route = `/apps/${app}`;
    if (command === "build" || command === "sim open") {
      try {
        body = JSON.parse(await readFile(required("input"), "utf8"));
      } catch (error) {
        if (error.envelope)
          throw error;
        throw invalid("요청 본문 JSON 파일을 읽을 수 없습니다");
      }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.hasOwn(body, "app_id"))
        throw invalid("본문은 app_id를 제외한 JSON 객체여야 합니다");
      route += command === "build" ? "/builds" : "/simulators";
    } else {
      route += `/simulators/${id(required("session"))}`;
      if (command === "sim screenshot")
        route += "/screenshots";
      if (command === "sim record start") {
        route += "/recordings";
        body = { max_seconds: number("max-seconds", 1, 300) };
      }
      if (command === "sim record stop")
        route += `/recordings/${id(required("recording"))}/stop`;
      if (command === "sim tap") {
        route += "/actions";
        body = { expected_sequence: number("sequence", 0, Number.MAX_SAFE_INTEGER), action: { tap: { point: { x: number("x", 0, Number.MAX_SAFE_INTEGER, false), y: number("y", 0, Number.MAX_SAFE_INTEGER, false) } } } };
      }
    }
    requestOptions = { method: "POST", body, idempotency, ...flags.revision === undefined ? {} : { revision: number("revision", 0, Number.MAX_SAFE_INTEGER) } };
  }
  const client = createIosClient();
  const result = output ? await client.download(flags.app, positionals[0], output) : await client.request(route, requestOptions);
  if (requestOptions && (typeof result.job_id !== "string" || !result.state))
    throw invalid("접수 응답에 job_id/state가 없습니다", "invalid_response");
  if (command === "job wait" && (!result.job || typeof result.wait_timed_out !== "boolean"))
    throw invalid("작업 대기 응답이 잘못됐습니다", "invalid_response");
  console.log(JSON.stringify(result, null, flags.json ? 0 : 2));
  if (command !== "job wait")
    return 0;
  if (result.job.state === "completed")
    return 0;
  if (["failed", "cancelled", "rejected"].includes(result.job.state))
    return 1;
  return 2;
}

// ../../../../tmp/tmp.8H0SAuTqNi/cli/xenoci.mjs
var VERSION = "1.2.5";
var USAGE = `xenoci 1.2.5
사용법:
  xenoci ios --help                                iOS 앱·빌드·시뮬레이터·산출물 API
  xenoci build --script ./ci.sh                     현재 폴더를 올려 빌드하고 끝날 때까지 로그 출력
                                                    (git 없어도 됨, 두 번째부터 바뀐 파일만, 종료 코드 = 빌드 종료 코드)
  xenoci build --script ./ci.sh --dir ./app         지정한 폴더를 올려 빌드
  xenoci build --script ./ci.sh --repo owner/name --ref main [--github-token-env GITHUB_TOKEN]
  xenoci build --script ./ci.sh --repo-url https://gitlab.com/group/app --ref main
  결과물: --artifacts 'build/*.ipa,build/*.xcarchive' (빌드 폴더 기준, 폴더는 zip, 7일 보관) → xenoci artifacts <id> [--out ./dist]
  옵션: --xcode 26.6 --timeout 30 --priority high --clean --mac rt_... --queue-until-rental --no-wait(접수만 하고 ID 출력)
        --pr 12 --commit <sha> (없으면 CI 변수와 git rev-parse HEAD로 자동; 나중에 xenoci·API에서 PR별로 찾음)
        --dir와 --repo owner/name을 같이 주면 폴더를 올리고 repo는 표시·검색용으로만 씁니다(clone 안 함)
  xenoci status <id> | logs <id> [--wait | --failure | --tail 200] | cancel <id> | wait <id> [--timeout 60]

맥 주문 (결제는 사람이 pay_url에서 합니다):
  xenoci catalog                                    상품·가격·지금 가능한 대수·Xcode
  xenoci order --tier <id> --hours 24 [--units 1] [--start now|ISO] [--xcode 26.6] [--quote]
  xenoci order <RT-...> | orders [--status awaiting_payment]  주문 상태·결제 링크 | 주문 목록
  xenoci wait <RT-...> [--timeout 60]               결제·준비 완료까지 대기
  xenoci reset (--all | <rt_...>...) [--keep-cache] [--when after_build|now]   VM 재설정(manage 권한)
  xenoci xcode (--all | <rt_...>...) --version 27.0 [--when after_build|now]    Xcode 변경(manage 권한)
  xenoci setup <rt_...> [--xcode 26.6] [--runtimes "iOS 26.6,iOS 26.5"] [--tools fastlane,cocoapods] [--cache keep|drop]
  xenoci job <op_...>                                작업 상태(queued·running·done·failed)
  xenoci macs                                       빌린 맥·남은 시간·대기열 (예전 이름: rentals, pool)
  xenoci extend <rt_...> [<rt_...>...] --hours 24 [--quote]
  xenoci waitlist [--tier <id> [--units 1] | --leave <id>]
  xenoci secrets [list | put NAME (값은 표준 입력 또는 --value-env VAR) | delete NAME]
  xenoci errors [--since 2026-10-08T00:00:00Z] [--code no_capacity] [--fault platform] [--kind api|build]
  xenoci whoami                                     키 이름·권한(scope)·한도
  모든 명령: --json (기계가 읽는 JSON 한 개만 출력, 오류도 {"error":{...}} JSON)
  기다리는 중 Ctrl+C·CI 중단(SIGTERM)이면 빌드도 취소합니다.
환경 변수: XENOCI_API_KEY (필수, https://xenoci.com/app/api-keys), XENOCI_API_URL (기본 https://xenoci.com)`;
function parse(argv) {
  const [command, ...args] = argv;
  const options = { _: [] };
  for (let i = 0;i < args.length; i++) {
    if (!args[i].startsWith("--")) {
      options._.push(args[i]);
      continue;
    }
    const name = args[i].slice(2);
    if (["wait", "no-wait", "clean", "help", "json", "quote", "failure", "queue-until-rental", "keep-cache", "all"].includes(name)) {
      options[name] = true;
      continue;
    }
    if (args[i + 1] == null || args[i + 1].startsWith("--"))
      throw new Error(`--${name} 값을 입력해 주세요`);
    options[name] = args[++i];
  }
  return { command, options };
}
async function main() {
  if (process.argv[2] === "ios")
    return runIos(process.argv.slice(3));
  const { command, options } = parse(process.argv.slice(2));
  if (!command || options.help || ["help", "--help", "-h"].includes(command)) {
    console.log(USAGE);
    return 0;
  }
  if (["version", "--version", "-v"].includes(command)) {
    console.log(typeof VERSION === "string" ? VERSION : "dev");
    return 0;
  }
  const client = createClient();
  const json = Boolean(options.json);
  const print = (value) => console.log(JSON.stringify(value, null, json ? 0 : 2));
  const id2 = options._[0];
  const int = (name, fallback) => {
    if (options[name] == null)
      return fallback;
    const n = Number(options[name]);
    if (!Number.isInteger(n) || n < 0)
      throw new Error(`--${name}은 0 이상의 정수입니다`);
    return n;
  };
  const payHint = (order) => {
    if (!json && order?.pay_url && order.status === "awaiting_payment")
      console.error(`결제 링크(사람이 열어 동의·결제): ${order.pay_url}`);
  };
  if (command === "pool") {
    print(await client.pool());
    return 0;
  }
  if (command === "rentals" || command === "macs") {
    print(await client.rentals());
    return 0;
  }
  if (command === "catalog") {
    print(await client.catalog());
    return 0;
  }
  if (command === "whoami") {
    print(await client.account());
    return 0;
  }
  if (command === "orders") {
    print(await client.orders(options.status));
    return 0;
  }
  if (command === "errors") {
    print(await client.errors({ since: options.since, code: options.code, fault: options.fault, kind: options.kind }));
    return 0;
  }
  if (command === "order") {
    if (id2) {
      const o2 = await client.order(id2);
      print(o2);
      payHint(o2);
      return 0;
    }
    if (!options.tier || !options.hours)
      throw new Error("--tier와 --hours를 입력해 주세요 (xenoci catalog로 상품 확인)");
    const body2 = { tier: options.tier, hours: int("hours"), units: int("units", 1), ...options.start ? { start: options.start } : {} };
    if (options.quote) {
      print(await client.quote(body2));
      return 0;
    }
    if (options.xcode)
      body2.setup = { xcode: options.xcode };
    const o = await client.createOrder(body2);
    print(o);
    payHint(o);
    return 0;
  }
  if (command === "xcode" || command === "reset") {
    if (!options.all && !options._.length)
      throw new Error("--all 또는 맥 ID를 입력해 주세요 (xenoci macs로 확인)");
    if (options.all && options._.length)
      throw new Error("--all과 맥 ID는 함께 쓸 수 없습니다");
    if (command === "xcode" && !options.version)
      throw new Error("--version을 입력해 주세요 (xenoci macs의 xcode_options)");
    const body2 = { ...options.all ? { all: true } : { ids: options._ }, ...command === "xcode" ? { version: options.version } : { keep_cache: Boolean(options["keep-cache"]) }, ...options.when ? { when: options.when } : {} };
    const result = command === "xcode" ? await client.setXcode(body2, options["idempotency-key"]) : await client.resetMacs(body2, options["idempotency-key"]);
    print(result);
    return result.items?.every((i) => i.result === "accepted") ? 0 : 1;
  }
  if (command === "setup") {
    if (!id2)
      throw new Error("맥 ID를 입력해 주세요 (xenoci macs로 확인)");
    const list = (v) => String(v).split(",").map((x) => x.trim()).filter(Boolean);
    const body2 = {
      ...options.xcode ? { xcode: options.xcode } : {},
      ...options.runtimes != null ? { runtimes: list(options.runtimes) } : {},
      ...options.tools != null ? { tools: list(options.tools) } : {},
      ...options.cache != null ? { keep_cache: options.cache === "keep" } : {},
      ...options.when ? { when: options.when } : {}
    };
    print(await client.updateMac(id2, body2, options["idempotency-key"]));
    return 0;
  }
  if (command === "job") {
    if (!id2)
      throw new Error("작업 ID(op_…)를 입력해 주세요");
    print(await client.job(id2));
    return 0;
  }
  if (command === "extend") {
    if (!options._.length || !options.hours)
      throw new Error("맥 ID와 --hours를 입력해 주세요 (xenoci macs로 확인)");
    const hours = int("hours");
    if (options.quote) {
      print(options._.length === 1 ? await client.extendQuote(id2, hours) : await client.request("/rentals/extend/quote", { method: "POST", body: { rental_ids: options._, hours } }));
      return 0;
    }
    const o = options._.length === 1 ? await client.extend(id2, hours) : await client.extendMany(options._, hours);
    print(o);
    payHint(o);
    return 0;
  }
  if (command === "waitlist") {
    if (options.leave) {
      print(await client.leaveWaitlist(options.leave));
      return 0;
    }
    if (options.tier) {
      print(await client.joinWaitlist({ tier: options.tier, units: int("units", 1) }));
      return 0;
    }
    print(await client.waitlist());
    return 0;
  }
  if (command === "secrets") {
    const [action = "list", name] = options._;
    if (action === "list") {
      print(await client.secrets());
      return 0;
    }
    if (!name)
      throw new Error("시크릿 이름을 입력해 주세요");
    if (action === "delete") {
      print(await client.deleteSecret(name));
      return 0;
    }
    if (action !== "put")
      throw new Error("secrets list | put NAME | delete NAME");
    let value = options["value-env"] ? process.env[options["value-env"]] : null;
    if (options["value-env"] && value == null)
      throw new Error(`${options["value-env"]} 환경 변수가 비어 있습니다`);
    if (value == null) {
      const chunks = [];
      for await (const c of process.stdin)
        chunks.push(c);
      value = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
    }
    print(await client.putSecret(name, value));
    return 0;
  }
  if (command === "wait") {
    if (!id2)
      throw new Error("빌드 ID 또는 주문 번호를 입력해 주세요");
    const timeout = Math.min(60, int("timeout", 60));
    if (/^RT-/i.test(id2)) {
      const r2 = await client.waitOrder(id2, timeout);
      print(r2);
      payHint(r2.order || r2);
      return 0;
    }
    const r = await client.wait(id2, timeout);
    print(r);
    const b = r.build || r;
    return ["succeeded", "failed", "cancelled", "expired"].includes(b.state) ? exitCodeOf(b) : 0;
  }
  if (["status", "logs", "cancel"].includes(command) && !id2)
    throw new Error("빌드 ID를 입력해 주세요");
  if (command === "status") {
    print(await client.build(id2));
    return 0;
  }
  if (command === "artifacts") {
    if (!id2)
      throw new Error("빌드 ID를 입력해 주세요");
    const list = await client.artifacts(id2);
    if (!options.out) {
      print(list);
      return 0;
    }
    await mkdir(options.out, { recursive: true });
    for (const a of list.artifacts) {
      const res = await fetch(a.download_url);
      if (!res.ok)
        throw new Error(`${a.name} 내려받기 실패 (HTTP ${res.status})`);
      const body2 = Buffer.from(await res.arrayBuffer());
      if (createHash3("sha256").update(body2).digest("hex") !== a.sha256)
        throw new Error(`${a.name} 체크섬 불일치`);
      await writeFile(path2.join(options.out, path2.basename(a.name)), body2);
      if (!json)
        console.error(`[xenoci] ${a.name} ${(a.bytes / 1048576).toFixed(1)}MB → ${options.out}`);
    }
    if (json)
      print({ ...list, saved_to: options.out });
    return 0;
  }
  if (command === "cancel") {
    print(await client.cancel(id2));
    return 0;
  }
  if (command === "logs") {
    if (options.wait)
      return exitCodeOf(await follow(client, id2, { onLog: (t) => process.stdout.write(t) }));
    const log = (await client.log(id2, 0)).log || "";
    if (options.failure) {
      const e = failureExcerpt(log, int("tail", 60));
      if (json)
        print(e);
      else
        process.stdout.write(`[${e.start_line}-${e.end_line}줄${e.file ? ` · ${e.file}:${e.line}` : ""}]
${e.text}
`);
      return 0;
    }
    const out = options.tail ? `${log.replace(/\n$/, "").split(`
`).slice(-int("tail")).join(`
`)}
` : log;
    if (json)
      print({ id: id2, log: out });
    else
      process.stdout.write(out);
    return 0;
  }
  if (["return", "release", "end", "stop"].includes(command))
    throw Object.assign(new Error("맥은 API로 반납·종료할 수 없습니다. 이용 시간(ends_at, xenoci macs)이 끝나면 저절로 끝나고 VM과 캐시가 삭제됩니다. 그 전에 결과물을 xenoci artifacts <빌드 ID> --out ./dist로 받으세요. 연장 결제를 하지 않으면 더 청구되지 않습니다. 시작 전 이용권 환불은 사람이 XenoCI 고객센터에 신청합니다."), { envelope: { code: "rental_return_unavailable", message: "A rented Mac cannot be returned or ended through the API. It ends by itself at ends_at (xenoci macs); download results first (xenoci artifacts <id> --out ./dist).", retryable: false, fault: "client", next: [{ action: "macs" }, { action: "artifacts" }], docs: "https://xenoci.com/docs/errors#rental_return_unavailable" } });
  if (command !== "build")
    throw new Error(`알 수 없는 명령: ${command} (명령 목록: xenoci --help)`);
  if (!options.script)
    throw new Error("--script를 입력해 주세요 (올릴 폴더 안의 셸 스크립트 파일, 예: --script ./ci.sh)");
  const gitSource = Boolean(options.repo || options["repo-url"]);
  const localScript = await readFile2(options.script, "utf8").catch((error) => {
    if (gitSource && error.code === "ENOENT")
      return null;
    throw new Error(error.code === "ENOENT" ? `스크립트 파일이 없습니다: ${options.script} (--script는 명령이 아니라 올릴 폴더 안의 스크립트 파일 경로입니다. 명령을 ci.sh에 적고 --script ./ci.sh)` : error.message);
  });
  const body = { script: localScript ?? `bash ${JSON.stringify(options.script.replace(/^\.\//, ""))}
` };
  for (const [flag, field] of [["xcode", "xcode"], ["ref", "ref"]])
    if (options[flag])
      body[field] = options[flag];
  if (options.priority) {
    const priority = { normal: 0, high: 1, 0: 0, 1: 1 }[options.priority];
    if (priority === undefined)
      throw new Error("--priority는 normal 또는 high입니다");
    body.priority = priority;
  }
  if (options.timeout) {
    const timeout = Number(options.timeout);
    if (!Number.isInteger(timeout) || timeout < 1)
      throw new Error("--timeout은 1 이상의 정수입니다");
    body.timeout_min = timeout;
  }
  if (options.clean)
    body.clean_tree = true;
  if (options.mac)
    body.rental_id = options.mac;
  if (options["queue-until-rental"])
    body.queue_until_rental = true;
  if (options.artifacts)
    body.artifacts = options.artifacts.split(",").map((p) => p.trim()).filter(Boolean);
  const upload = !options.repo || options.dir != null;
  const refSha = /^[0-9a-f]{7,40}$/i.test(options.ref || "") ? options.ref : undefined;
  const meta = await detectBuildMeta(upload ? options.dir || "." : null, { pr: options.pr, commit: options.commit ?? refSha, repo: options.repo });
  if (options.pr != null && meta.pr == null)
    throw new Error("--pr은 양의 정수(PR 번호)입니다");
  if (options.commit != null && meta.commit == null)
    throw new Error("--commit은 7~40자리 커밋 SHA입니다");
  if (meta.pr != null)
    body.pr = meta.pr;
  if (meta.commit)
    body.commit = meta.commit;
  if (!upload) {
    body.repo = options.repo;
    const token = options["github-token-env"] ? process.env[options["github-token-env"]] : options["github-token"];
    if (options["github-token-env"] && !token)
      throw new Error(`${options["github-token-env"]} 환경 변수가 비어 있습니다`);
    if (token)
      body.github_token = token;
  } else if (options["repo-url"] && options.dir == null)
    body.repo_url = options["repo-url"];
  else {
    const dir = options.dir || ".";
    const tty = Boolean(process.stderr.isTTY);
    const up = await client.upload(dir, { project: options.project, onProgress: (p) => {
      if (tty)
        process.stderr.write(`\r업로드 ${(p.sent / 1048576).toFixed(1)}/${(p.total / 1048576).toFixed(1)}MB`);
    } });
    if (up.sent_files && tty)
      process.stderr.write(`
`);
    console.error(`업로드: 파일 ${up.files}개 중 ${up.sent_files}개 전송 (${(up.sent_bytes / 1048576).toFixed(1)}MB, 압축 후 ${(up.wire_bytes / 1048576).toFixed(1)}MB, ${((up.hash_ms + up.upload_ms) / 1000).toFixed(1)}초)`);
    body.upload_id = up.upload_id;
    if (meta.repo)
      body.repo = meta.repo;
  }
  const submitted = await client.submit(body);
  if (!submitted.id)
    throw new Error("빌드 ID가 없습니다");
  console.error(`빌드 접수: ${submitted.id}`);
  if (options["no-wait"]) {
    console.log(JSON.stringify({ id: submitted.id, state: submitted.state }));
    return 0;
  }
  let stopping = null;
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    process.on(signal, () => {
      if (stopping)
        process.exit(code);
      console.error(`
중단 신호를 받아 빌드 ${submitted.id}를 취소합니다`);
      stopping = client.cancel(submitted.id).catch((error) => console.error(`취소 요청 실패: ${error.message}`)).finally(() => process.exit(code));
    });
  }
  let tail = "";
  const build = await follow(client, submitted.id, { onLog: (t) => {
    if (json) {
      tail = (tail + t).slice(-200000);
      process.stderr.write(t);
    } else
      process.stdout.write(t);
  } });
  console.error(`빌드 ${build.state}${Number.isInteger(build.exit_code) ? ` (종료 코드 ${build.exit_code})` : ""}`);
  if (json)
    print({ id: submitted.id, state: build.state, exit_code: exitCodeOf(build), ...build.failure ? { failure: build.failure } : {}, ...exitCodeOf(build) !== 0 ? { failure_excerpt: failureExcerpt(tail, 60) } : {} });
  return exitCodeOf(build);
}
try {
  process.exitCode = await main();
} catch (error) {
  if (process.argv.includes("--json"))
    console.log(JSON.stringify({ error: error.envelope || { code: "client_error", message: error.message, retryable: false, next: [] } }));
  else {
    console.error(error.message);
    const next = error.envelope?.next;
    if (next?.length)
      console.error(`다음 할 일: ${next.map((n) => n.action + (n.path ? ` (${n.method || "GET"} ${n.path})` : "")).join(", ")}`);
    if (error.envelope?.request_id)
      console.error(`request_id: ${error.envelope.request_id}`);
  }
  process.exitCode = 1;
}
