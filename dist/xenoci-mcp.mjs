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

// ../../../tmp/tmp.5KwoGJQN7G/cli/lib.mjs
var exports_lib = {};
__export(exports_lib, {
  ALWAYS_EXCLUDED: () => ALWAYS_EXCLUDED,
  DEFAULT_IGNORE: () => DEFAULT_IGNORE,
  UPLOAD_MAX_BYTES: () => UPLOAD_MAX_BYTES,
  buildManifest: () => buildManifest,
  createClient: () => createClient,
  defaultProject: () => defaultProject,
  exitCodeOf: () => exitCodeOf,
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
function createClient({ key = process.env.XENOCI_API_KEY, url = process.env.XENOCI_API_URL || "https://app.xenoci.com", fetchImpl = fetch } = {}) {
  if (!key)
    throw new Error("XENOCI_API_KEY를 설정해 주세요");
  const base = url.replace(/\/$/, "") + "/api/ci/v1";
  async function request(route, { method = "GET", body, raw, contentType, idempotency } = {}) {
    const headers = { Authorization: `Bearer ${key}` };
    if (body !== undefined)
      headers["Content-Type"] = "application/json";
    if (raw !== undefined)
      headers["Content-Type"] = contentType || "application/gzip";
    if (idempotency)
      headers["Idempotency-Key"] = idempotency;
    const response = await fetchImpl(base + route, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const text = await response.text();
    if (!response.ok) {
      let code = text;
      try {
        const parsed = JSON.parse(text);
        code = parsed.error || parsed.code || parsed.message || text;
      } catch {}
      throw Object.assign(new Error(`요청 실패: HTTP ${response.status} ${code}`), { status: response.status, code });
    }
    if (!text)
      return {};
    try {
      return JSON.parse(text);
    } catch {
      return { log: text };
    }
  }
  return {
    request,
    pool: () => request("/pool"),
    rentals: () => request("/rentals"),
    build: (id) => request(`/builds/${encodeURIComponent(id)}`),
    cancel: (id) => request(`/builds/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
    log: (id, offset = 0) => request(`/builds/${encodeURIComponent(id)}/log?offset=${offset}`),
    wait: (id, seconds = 2) => request(`/builds/${encodeURIComponent(id)}/wait?timeout=${seconds}`),
    submit: (body, idempotency = randomUUID()) => request("/builds", { method: "POST", body, idempotency }),
    upload: (dir, options) => uploadFolder({ request }, dir, options)
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
var run, UPLOAD_MAX_BYTES, ALWAYS_EXCLUDED, BATCH_BYTES, TERMINAL, exitCodeOf = (build) => Number.isInteger(build.exit_code) ? build.exit_code : build.state === "succeeded" ? 0 : 1, DEFAULT_IGNORE, cacheFile = (root) => path.join(process.env.XENOCI_CACHE_DIR || path.join(os.homedir(), ".cache", "xenoci"), `${createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 16)}.json`);
var init_lib = __esm(() => {
  run = promisify(execFile);
  UPLOAD_MAX_BYTES = 2 * 1024 ** 3;
  ALWAYS_EXCLUDED = [".git", "DerivedData", "Pods", "node_modules", ".build", ".swiftpm", "xcuserdata", ".DS_Store", ".xeno"];
  BATCH_BYTES = 32 * 1024 * 1024;
  TERMINAL = ["succeeded", "failed", "cancelled", "expired"];
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

// ../../../tmp/tmp.5KwoGJQN7G/mcp/server.mjs
import path2 from "node:path";
import readline from "node:readline";
var lib = await Promise.resolve().then(() => (init_lib(), exports_lib));
var { createClient: createClient2, follow: follow2, exitCodeOf: exitCodeOf2 } = lib;
var LOG_TAIL = 20000;
var tools = [
  {
    name: "build",
    description: "XenoCI 임대 macOS VM에서 빌드를 실행합니다. 기본은 폴더 업로드(두 번째부터 바뀐 파일만 전송), repo+ref 또는 repo_url을 주면 git에서 가져옵니다. wait가 true면 끝날 때까지 기다리고 로그 끝부분과 종료 코드를 돌려줍니다.",
    inputSchema: { type: "object", properties: {
      script: { type: "string", description: "실행할 셸 스크립트 내용 (예: xcodebuild -scheme App test)" },
      dir: { type: "string", description: "업로드할 폴더 (기본: 현재 작업 폴더)" },
      repo: { type: "string", description: "GitHub owner/name (공개 저장소 또는 XenoCI GitHub App 설치 저장소)" },
      repo_url: { type: "string", description: "공개 저장소 https URL (github.com, gitlab.com, bitbucket.org)" },
      ref: { type: "string" },
      xcode: { type: "string" },
      timeout_min: { type: "integer", minimum: 1, maximum: 360 },
      clean: { type: "boolean", description: "VM에 남겨 둔 소스를 지우고 처음부터 받기" },
      wait: { type: "boolean", default: true }
    }, required: ["script"] }
  },
  { name: "build_status", description: "빌드 상태(대기 순번, 실행 중, 성공/실패, 종료 코드)를 봅니다.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "build_logs", description: "빌드 로그를 읽습니다. offset부터 이어 읽을 수 있습니다.", inputSchema: { type: "object", properties: { id: { type: "string" }, offset: { type: "integer", minimum: 0 } }, required: ["id"] } },
  { name: "cancel_build", description: "대기 중이거나 실행 중인 빌드를 취소합니다.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "list_rentals", description: "임대 VM 목록(남은 시간, VM 상태)과 대기열을 봅니다.", inputSchema: { type: "object", properties: {} } }
];
var send = (message) => process.stdout.write(JSON.stringify(message) + `
`);
var text = (value, isError = false) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], isError });
async function call(name, args = {}, client, progress) {
  if (name === "list_rentals") {
    const data = await client.rentals();
    return text({ pool: data.pool, rentals: data.rentals.map((r) => ({
      id: r.public_id,
      tier: r.tier,
      state: r.state,
      vm_state: r.vm_state,
      xcode: r.xcode,
      remaining_minutes: Math.floor(r.remaining_ms / 60000),
      ends_at: r.ends_at,
      current_build_id: r.current_build_id
    })) });
  }
  if (name === "build_status") {
    const b = await client.build(args.id);
    return text({ id: b.id, state: b.state, exit_code: b.exit_code, queue_position: b.queue_position, end_reason: b.end_reason });
  }
  if (name === "build_logs") {
    const l = await client.log(args.id, args.offset || 0);
    return text(`${l.log || ""}
[next_offset ${l.next_offset}]`);
  }
  if (name === "cancel_build") {
    const b = await client.cancel(args.id);
    return text({ id: b.id, state: b.state });
  }
  if (name !== "build")
    throw Object.assign(new Error(`unknown tool ${name}`), { rpc: -32602 });
  if (typeof args.script !== "string" || !args.script.trim())
    return text("script가 필요합니다", true);
  const body = { script: args.script };
  for (const k of ["ref", "xcode", "timeout_min"])
    if (args[k] != null)
      body[k] = args[k];
  if (args.clean)
    body.clean_tree = true;
  let upload = null;
  if (args.repo)
    body.repo = args.repo;
  else if (args.repo_url)
    body.repo_url = args.repo_url;
  else {
    upload = await client.upload(path2.resolve(args.dir || process.cwd()));
    body.upload_id = upload.upload_id;
  }
  const submitted = await client.submit(body);
  const summary = upload ? `업로드: 파일 ${upload.files}개 중 ${upload.sent_files}개 전송 (${(upload.sent_bytes / 1048576).toFixed(1)}MB)
` : "";
  if (args.wait === false)
    return text(`${summary}빌드 접수: ${submitted.id} (${submitted.state})`);
  let log = "";
  const build = await follow2(client, submitted.id, { onLog: (t) => {
    log = (log + t).slice(-LOG_TAIL);
    progress(t);
  } });
  const code = exitCodeOf2(build);
  return text(`${summary}빌드 ${submitted.id}: ${build.state}, 종료 코드 ${code}
--- 로그 끝부분 ---
${log}`, code !== 0);
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
          serverInfo: { name: "xenoci", version: "0.1.0" },
          instructions: "XenoCI 임대 macOS VM에서 빌드합니다. build 도구는 기본적으로 현재 폴더를 올리고(두 번째부터 바뀐 파일만) 결과를 기다립니다."
        };
      else if (m.method === "ping")
        result = {};
      else if (m.method === "tools/list")
        result = { tools };
      else if (m.method === "tools/call") {
        client ||= createClient2();
        const token = m.params?._meta?.progressToken;
        let count = 0;
        const progress = (t) => {
          if (token !== undefined)
            send({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: token, progress: ++count, message: t.slice(-500) } });
        };
        try {
          result = await call(m.params?.name, m.params?.arguments, client, progress);
        } catch (error) {
          if (error.rpc)
            throw error;
          result = text(error.message, true);
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

// ../../../tmp/tmp.5KwoGJQN7G/mcp/bin.mjs
startServer();
