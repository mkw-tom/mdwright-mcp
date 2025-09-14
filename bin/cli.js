#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const cmd = process.argv[2];

// ---------- scaffold ----------
function ensureExample() {
  // NLサンプル（成功＋失敗を1ファイルに）
  const nl = "tests/nl/login.md";
  if (!fs.existsSync(nl)) {
    fs.mkdirSync(path.dirname(nl), { recursive: true });
    fs.writeFileSync(
      nl,
`suite: Login

case: 正常ログイン
- /login に移動
- メールアドレス に user@example.com を入力
- パスワード に pass を入力
- ログイン をクリック
- ダッシュボード が見える

case: パスワード誤りで失敗
- /login に移動
- メールアドレス に user@example.com を入力
- パスワード に wrongpass を入力
- ログイン をクリック
- メールアドレスかパスワードが違います が見える
`
    );
    console.log(`Scaffolded ${nl}`);
  }

  // デモ用HTML
  const pub = "public/login.html";
  if (!fs.existsSync(pub)) {
    fs.mkdirSync(path.dirname(pub), { recursive: true });
    fs.writeFileSync(
      pub,
`<!doctype html><html lang="ja"><meta charset="utf-8" /><title>ログイン</title>
<h1>ログイン</h1>
<form id="f">
  <label for="email">メールアドレス</label>
  <input id="email" type="email" />
  <br/>
  <label for="pw">パスワード</label>
  <input id="pw" type="password" />
  <br/>
  <button type="submit">ログイン</button>
</form>
<div id="app"></div>
<script>
  document.getElementById('f').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const pw = document.getElementById('pw').value;
    const ok = email === 'user@example.com' && pw === 'pass';
    const app = document.getElementById('app');
    app.innerHTML = ok
      ? '<h2>ダッシュボード</h2>'
      : '<p style="color:red">メールアドレスかパスワードが違います</p>';
  });
</script></html>`
    );
    console.log(`Scaffolded ${pub}`);
  }

  // CI（MCP直実行のみ）— デフォルトを用意
  const yml = ".github/workflows/e2e.yml";
  if (!fs.existsSync(yml)) {
    fs.mkdirSync(path.dirname(yml), { recursive: true });
    fs.writeFileSync(
      yml,
`name: E2E via mdwright-mcp (specless)
on: [push, pull_request]
jobs:
  e2e:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm' }
      - run: npm ci

      # デモサーバ（必要な場合）
      - run: npx http-server public -p 8080 -c-1 &

      # 自然言語 → MCP でそのまま実行
      - name: Run NL tests via MCP
        env:
          APP_BASE: "http://127.0.0.1:8080"
          SAVE_HTML: "1"
        run: npx mdwright-mcp exec

      # 成果物アップロード
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: mdwright-artifacts
          path: artifacts/**
`
    );
    console.log(`Scaffolded ${yml}`);
  }

  // .gitignore（なければ）
  const gi = ".gitignore";
  if (!fs.existsSync(gi)) {
    fs.writeFileSync(gi, "node_modules/\nartifacts/\n");
    console.log(`Scaffolded ${gi}`);
  }
}

// ---------- CI generator ----------
function writeCiYml({ file, node = "20", base = "http://127.0.0.1:8080", serveCmd = "npx http-server public -p 8080 -c-1", minimal = false }) {
  const yml = minimal
? `name: E2E via mdwright-mcp
on: [push, pull_request]
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${JSON.stringify(node)}, cache: 'npm' }
      - run: npm ci
      - run: ${serveCmd} &
      - name: Run NL tests via MCP
        env:
          APP_BASE: ${JSON.stringify(base)}
          SAVE_HTML: "1"
        run: npx mdwright-mcp exec
      - if: always()
        uses: actions/upload-artifact@v4
        with: { name: mdwright-artifacts, path: artifacts/** }
`
: `name: E2E via mdwright-mcp (specless)
on:
  push:
  pull_request:
concurrency:
  group: e2e-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  e2e:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    timeout-minutes: 20
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${JSON.stringify(node)}
          cache: npm

      - name: Install
        run: npm ci

      - name: Start app (or demo server)
        run: ${serveCmd} &

      - name: Run NL tests via MCP
        env:
          APP_BASE: ${JSON.stringify(base)}
          SAVE_HTML: "1"
          DEBUG: ""      # "1" でデバッグ出力
        run: npx mdwright-mcp exec

      - name: Upload artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: mdwright-artifacts
          path: |
            artifacts/**
          if-no-files-found: ignore
`;
  const out = file || ".github/workflows/mdwright-e2e.yml";
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, yml);
  console.log(`Scaffolded ${out}`);
}

// ---------- commands ----------
if (cmd === "init") {
  ensureExample();
  console.log("Init done.");
  process.exit(0);
}

if (cmd === "probe") {
  // 例: mdwright-mcp probe --url http://127.0.0.1:8080/login.html
  const res = spawnSync(
    "node",
    ["scripts/mcp-probe.mjs", ...process.argv.slice(3)],
    { stdio: "inherit" }
  );
  process.exit(res.status ?? 1);
}

if (cmd === "exec") {
  // MDをそのままMCPで実行（specファイルは作らない）
  // 例: APP_BASE=... npx mdwright-mcp exec [tests/nl/login.md]
  const args = process.argv.slice(3);
  const res = spawnSync("node", ["scripts/md-exec.mjs", ...args], {
    stdio: "inherit",
    env: process.env,
  });
  process.exit(res.status ?? 1);
}

if (cmd === "ci") {
  // 例:
  //   npx mdwright-mcp ci
  //   npx mdwright-mcp ci minimal
  //   npx mdwright-mcp ci node18
  //   npx mdwright-mcp ci --base http://127.0.0.1:8080 --serve "npm run start"
  //   npx mdwright-mcp ci --out .github/workflows/e2e.yml
  const args = process.argv.slice(3);
  const opts = {
    file: process.env.CI_FILE || "",
    node: "20",
    base: process.env.APP_BASE || "http://127.0.0.1:8080",
    serveCmd: process.env.MDW_SERVE || "npx http-server public -p 8080 -c-1",
    minimal: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "minimal") opts.minimal = true;
    else if (a === "node18") opts.node = "18";
    else if (a === "node20") opts.node = "20";
    else if (a === "--base") { opts.base = args[++i]; }
    else if (a === "--serve") { opts.serveCmd = args[++i]; }
    else if (a === "--out") { opts.file = args[++i]; }
  }
  writeCiYml(opts);
  process.exit(0);
}

// 旧コマンド互換（run/test 呼ばれたら exec に誘導）
if (cmd === "run" || cmd === "test") {
  console.error(
    `[mdwright-mcp] "${cmd}" は廃止されました。specレス運用のため "exec" を使ってください。\n` +
    `例) APP_BASE=http://127.0.0.1:8080 npx mdwright-mcp exec`
  );
  process.exit(2);
}

// ヘルプ
console.log(`Usage:
  mdwright-mcp init               # 雛形を作る（NL, demo HTML, CI デフォルト）
  mdwright-mcp probe [--url URL]  # 1ページの状態をMCPでスナップショット
  mdwright-mcp exec [file.md]     # tests/nl/*.md をMCPで実行（specレス）
  mdwright-mcp ci [options]       # CI YAML を自動生成

CI options:
  minimal               最小構成のYAMLを出力
  node18|node20         Node.js バージョン指定（デフォルト 20）
  --base <URL>          APP_BASE (例: http://127.0.0.1:8080)
  --serve "<cmd>"       サーバ起動コマンド (例: "npm run start")
  --out <path>          出力先 (既定: .github/workflows/mdwright-e2e.yml)

Examples:
  npx mdwright-mcp init
  npx mdwright-mcp ci --base http://127.0.0.1:8080 --serve "npx http-server public -p 8080 -c-1"
  npx http-server public -p 8080 -c-1 &
  APP_BASE=http://127.0.0.1:8080 npx mdwright-mcp exec
  APP_BASE=http://127.0.0.1:8080 npx mdwright-mcp exec tests/nl/login.md
`);
process.exit(0);