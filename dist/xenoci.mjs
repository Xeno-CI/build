#!/usr/bin/env node

// ../../../tmp/tmp.5AHENdj5pN/cli/xenoci.mjs
import { readFile } from "node:fs/promises";

// ../../../tmp/tmp.5AHENdj5pN/cli/lib.mjs
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

// ../../../tmp/tmp.5AHENdj5pN/cli/xenoci.mjs
var VERSION = "1.1.1";
var USAGE = `xenoci 1.1.1
사용법:
  xenoci build --script ./ci.sh                     현재 폴더를 올려 빌드하고 끝날 때까지 로그 출력
                                                    (git 없어도 됨, 두 번째부터 바뀐 파일만, 종료 코드 = 빌드 종료 코드)
  xenoci build --script ./ci.sh --dir ./app         지정한 폴더를 올려 빌드
  xenoci build --script ./ci.sh --repo owner/name --ref main [--github-token-env GITHUB_TOKEN]
  xenoci build --script ./ci.sh --repo-url https://gitlab.com/group/app --ref main
  옵션: --xcode 26.6 --timeout 30 --priority high --clean --no-wait(접수만 하고 ID 출력)
  xenoci rentals | pool | status <id> | logs <id> [--wait] | cancel <id>
  기다리는 중 Ctrl+C·CI 중단(SIGTERM)이면 빌드도 취소합니다.
환경 변수: XENOCI_API_KEY (필수), XENOCI_API_URL (기본 https://app.xenoci.com)`;
function parse(argv) {
  const [command, ...args] = argv;
  const options = { _: [] };
  for (let i = 0;i < args.length; i++) {
    if (!args[i].startsWith("--")) {
      options._.push(args[i]);
      continue;
    }
    const name = args[i].slice(2);
    if (["wait", "no-wait", "clean", "help"].includes(name)) {
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
  const print = (value) => console.log(JSON.stringify(value, null, 2));
  const id = options._[0];
  if (command === "pool") {
    print(await client.pool());
    return 0;
  }
  if (command === "rentals") {
    print(await client.rentals());
    return 0;
  }
  if (["status", "logs", "cancel"].includes(command) && !id)
    throw new Error("빌드 ID를 입력해 주세요");
  if (command === "status") {
    print(await client.build(id));
    return 0;
  }
  if (command === "cancel") {
    print(await client.cancel(id));
    return 0;
  }
  if (command === "logs") {
    if (options.wait)
      return exitCodeOf(await follow(client, id, { onLog: (t) => process.stdout.write(t) }));
    process.stdout.write((await client.log(id, 0)).log || "");
    return 0;
  }
  if (command !== "build" || !options.script)
    throw new Error(USAGE);
  const gitSource = Boolean(options.repo || options["repo-url"]);
  const localScript = await readFile(options.script, "utf8").catch((error) => {
    if (gitSource && error.code === "ENOENT")
      return null;
    throw new Error(error.code === "ENOENT" ? `스크립트 파일이 없습니다: ${options.script}` : error.message);
  });
  const body = { script: localScript ?? `bash ${JSON.stringify(options.script.replace(/^\.\//, ""))}
` };
  for (const [flag, field] of [["xcode", "xcode"], ["ref", "ref"]])
    if (options[flag])
      body[field] = options[flag];
  if (options.priority)
    body.priority = options.priority === "high" ? 1 : options.priority === "normal" ? 0 : Number(options.priority);
  if (options.timeout) {
    const timeout = Number(options.timeout);
    if (!Number.isInteger(timeout) || timeout < 1)
      throw new Error("--timeout은 1 이상의 정수입니다");
    body.timeout_min = timeout;
  }
  if (options.clean)
    body.clean_tree = true;
  if (options.repo) {
    body.repo = options.repo;
    const token = options["github-token-env"] ? process.env[options["github-token-env"]] : options["github-token"];
    if (options["github-token-env"] && !token)
      throw new Error(`${options["github-token-env"]} 환경 변수가 비어 있습니다`);
    if (token)
      body.github_token = token;
  } else if (options["repo-url"])
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
  const build = await follow(client, submitted.id, { onLog: (t) => process.stdout.write(t) });
  console.error(`빌드 ${build.state}${Number.isInteger(build.exit_code) ? ` (종료 코드 ${build.exit_code})` : ""}`);
  return exitCodeOf(build);
}
try {
  process.exitCode = await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
