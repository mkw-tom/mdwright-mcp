import fs from "node:fs";
import chalk from "chalk";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const NL_DIR = process.env.NL_DIR ?? "tests/md";
const BASE = process.env.APP_BASE || "http://127.0.0.1:8080";

const fileArg = process.argv[2]; // 例: tests/nl/Login.md
const mdFiles = fileArg
  ? [fileArg]
  : fs.existsSync(NL_DIR)
  ? fs
      .readdirSync(NL_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.join(NL_DIR, f))
  : [];

if (!mdFiles.length) {
  console.error(
    `No .md found. Usage: node scripts/md-exec.mjs [tests/nl/Some.md]`
  );
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "@playwright/mcp@0.0.37"],
});
const client = new Client({ name: "mdwright-mcp", version: "0.1.0" });

/* ------------------ utils ------------------ */

function resolveUrl(u) {
  if (/^https?:\/\//i.test(u)) return u; // 絶対URL
  if (u.startsWith("/")) return new URL(u, BASE).toString(); // ルート相対
  return new URL(u, BASE).toString(); // 相対→BASEに連結
}

// content配列から値を取り出す（json > text）
function pickValue(contents) {
  const j = contents.find((c) => c?.type === "json")?.json;
  if (j !== undefined) return j;
  const t = contents.find((c) => c?.type === "text")?.text;
  if (t !== undefined) {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  return undefined;
}

function parseCases(md) {
  const suite = md.match(/suite:\s*(.+)/)?.[1]?.trim() ?? "Suite";
  const parts = md.split(/\ncase:\s*/).slice(1);
  const cases = parts.map((p) => {
    const lines = p.split(/\r?\n/);
    const title = (lines.shift() ?? "case").trim();
    const steps = lines
      .filter((l) => l.trim().startsWith("-"))
      .map((l) => l.replace(/^-+\s*/, "").trim());
    return { title, steps };
  });
  if (!cases.length) {
    const steps = md
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith("-"))
      .map((l) => l.replace(/^-+\s*/, "").trim());
    cases.push({ title: "default", steps });
  }
  return { suite, cases };
}

async function callTool(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  return res?.content ?? [];
}

// 戻り値を取りたいとき（式を渡す）
async function evalReturn(expr) {
  const res = await callTool("browser_evaluate", {
    function: `() => (${expr})`,
  });
  return pickValue(res);
}

// ステートメント実行（戻り値なし）
async function evalDo(code) {
  await callTool("browser_evaluate", {
    function: `() => { ${code} }`,
  });
}

function asBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
    // "1"/"0" も許容
    if (s === "1") return true;
    if (s === "0") return false;
  }
  if (typeof v === "number") return v !== 0;
  // 最後は truthy/falsy で判断
  return !!v;
}

/* -------------- helpers injected to page -------------- */

const HELPERS = `
const norm = s => (s||'').replace(/\\s+/g,' ').trim();
window.__mdw = {
  byLabel(label) {
    const target = norm(label);
    const labels = Array.from(document.querySelectorAll('label'));
    for (const lb of labels) {
      const text = norm(lb.textContent);
      if (text === target || text.includes(target)) {
        const id = lb.getAttribute('for');
        if (id) {
          const el = document.getElementById(id);
          if (el) return el;
        }
        // <label>直後の入力要素
        let el = lb.nextElementSibling;
        while (el && !/^(INPUT|TEXTAREA|SELECT)$/i.test(el.tagName)) {
          el = el.nextElementSibling;
        }
        if (el) return el;
      }
    }
    // aria-label / placeholder fallback
    const aria = document.querySelector('[aria-label="'+target+'"]');
    if (aria) return aria;
    const ph = Array.from(document.querySelectorAll('input,textarea,select'))
      .find(e => {
        const p = norm(e.getAttribute('placeholder'));
        return p === target || p.includes(target);
      });
    if (ph) return ph;
    return null;
  },
  clickByText(txt) {
    const t = norm(txt);
    // 1) <button>/role=button 厳密一致（XPath）
    const xp = "//button[normalize-space(text())='"+t.replace(/'/g,"\\\\'")+"']"
             + "|//*[@role='button' and normalize-space(text())='"+t.replace(/'/g,"\\\\'")+"']";
    const it = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    if (it.snapshotLength) { it.snapshotItem(0).click(); return true; }
    // 2) <button>/role=button 部分一致
    const btns = Array.from(document.querySelectorAll('button,[role=button]'));
    const b1 = btns.find(e => norm(e.textContent) === t) || btns.find(e => norm(e.textContent).includes(t));
    if (b1) { b1.click(); return true; }
    // 3) input[type=submit]/button の value/name/title
    const submits = Array.from(document.querySelectorAll('input[type=submit],input[type=button],input[type=reset]'));
    const s1 = submits.find(e => [e.value,e.name,e.title].some(v => v && (norm(v) === t || norm(v).includes(t))));
    if (s1) { s1.click(); return true; }
    // 4) a,* にテキスト（厳密→部分）
    const all = Array.from(document.querySelectorAll('a,*'));
    const el = all.find(e => norm(e.textContent) === t) || all.find(e => norm(e.textContent).includes(t));
    if (el) { el.click(); return true; }
    // 5) <form> を requestSubmit（フォーカス要素 or 最初のフォーム）
    const af = document.activeElement;
    if (af && af.form && typeof af.form.requestSubmit === 'function') { af.form.requestSubmit(); return true; }
    const form = document.querySelector('form');
    if (form && typeof form.requestSubmit === 'function') { form.requestSubmit(); return true; }
    // 6) 最後の手段：Enter 送出
    if (af) {
      const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
      af.dispatchEvent(ev);
      return true;
    }
    return false;
  },
  visibleTextExists(txt) {
    return norm(document.body?.innerText||'').includes(norm(txt));
  },
  typeByLabel(label, value) {
    const el = this.byLabel(label);
    if (!el) return false;
    el.focus();
    if ("value" in el) el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
};`;

let helpersInjected = false;
async function injectHelpers() {
  if (helpersInjected) return;
  await evalDo(HELPERS);
  helpersInjected = true;
}

/* ------------------ executor ------------------ */

async function executeStep(step) {
  let m;

  // 「/path に移動」
  if ((m = step.match(/^\/\S+\s*に移動$/))) {
    const raw = step.split(/\s/)[0];
    let url = resolveUrl(raw);

    // まずそのまま開く
    await callTool("browser_navigate", { url }).catch(() => {});
    await callTool("browser_wait_for", { state: "load", timeout: 8000 }).catch(
      () => {}
    );

    // 空っぽなら /xxx.html も試す
    const looksEmpty = !asBool(
      await evalReturn(
        "!!(document.body && document.body.innerText.length > 0)"
      )
    );
    if (looksEmpty && !/\.html$/i.test(url)) {
      const alt = resolveUrl(raw + ".html");
      await callTool("browser_navigate", { url: alt }).catch(() => {});
      await callTool("browser_wait_for", {
        state: "load",
        timeout: 8000,
      }).catch(() => {});
    }

    await callTool("browser_wait_for", {
      state: "networkidle",
      timeout: 8000,
    }).catch(() => {});
    await callTool("browser_take_screenshot", { fullPage: true }).catch(
      () => {}
    );
    return;
  }

  // 「X に Y を入力」
  if ((m = step.match(/^(.+)\s+に\s+(.+)\s+を入力$/))) {
    const label = m[1].trim();
    const val = m[2].trim();
    await injectHelpers();
    const ok = await evalReturn(
      `__mdw.typeByLabel(${JSON.stringify(label)}, ${JSON.stringify(val)})`
    );
    if (!asBool(ok)) {
      await callTool("browser_take_screenshot", { fullPage: true }).catch(
        () => {}
      );
      const html = await evalReturn("document.documentElement.outerHTML");
      if (typeof html === "string") {
        fs.mkdirSync("artifacts/exec-debug", { recursive: true });
        fs.writeFileSync("artifacts/exec-debug/last-page.html", html);
      }
      throw new Error(`入力対象が見つかりません: ${label}`);
    }
    await callTool("browser_wait_for", {
      state: "networkidle",
      timeout: 500,
    }).catch(() => {});
    await callTool("browser_take_screenshot", { fullPage: true }).catch(
      () => {}
    );
    return;
  }

  // 「X をクリック」
  if ((m = step.match(/^(.+)\s+をクリック$/))) {
    const name = m[1].trim();
    await injectHelpers();
    const ok = await evalReturn(`__mdw.clickByText(${JSON.stringify(name)})`);
    if (!asBool(ok)) {
      const html = await evalReturn("document.documentElement.outerHTML");
      if (typeof html === "string") {
        fs.mkdirSync("artifacts/exec-debug", { recursive: true });
        fs.writeFileSync("artifacts/exec-debug/last-page.html", html);
      }
      throw new Error(`クリック対象が見つかりません: ${name}`);
    }
    // クリック後はロード/ネットワークアイドルのどちらかで待機
    await callTool("browser_wait_for", { state: "load", timeout: 6000 }).catch(
      () => {}
    );
    await callTool("browser_wait_for", {
      state: "networkidle",
      timeout: 6000,
    }).catch(() => {});
    await evalReturn(
      "document.body && document.body.innerText.length > 0"
    ).catch?.(() => {});
    await callTool("browser_take_screenshot", { fullPage: true }).catch(
      () => {}
    );
    return;
  }

  // 「X が見える」
  if ((m = step.match(/^(.+)\s+が見える$/))) {
    const txt = m[1].trim();
    await injectHelpers();
    const ok = await evalReturn(
      `__mdw.visibleTextExists(${JSON.stringify(txt)})`
    );
    if (!asBool(ok)) throw new Error(`テキストが見つかりません: ${txt}`);
    return;
  }

  // 未対応 → スクショだけ
  await callTool("browser_take_screenshot", { fullPage: true }).catch(() => {});
  console.warn("[warn] 未対応の手順:", step);
}

function parseAllSteps(md) {
  const { suite, cases } = parseCases(md);
  const flat = [];
  for (const c of cases)
    for (const s of c.steps) flat.push({ caseTitle: c.title, step: s });
  return { suite, steps: flat };
}

function slug(name) {
  return name
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/* ------------------ main ------------------ */

(async () => {
  await client.connect(transport);
  // const tools = await client.listTools();
  // console.log(
  //   "[MCP] tools:",
  //   tools?.tools?.map((t) => t.name)
  // );

  for (const f of mdFiles) {
    const md = fs.readFileSync(f, "utf8");
    const { suite, steps } = parseAllSteps(md);
    console.log(`[exec] suite=${suite} file=${f} steps=${steps.length}`);

    // メタ保存（任意）
    const metaDir = path.join(
      "artifacts",
      "exec",
      slug(path.basename(f, ".md"))
    );
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(
      path.join(metaDir, "meta.json"),
      JSON.stringify({ suite, file: f, steps }, null, 2)
    );

    // 最初の移動が無ければベースを開く
    if (!steps.some((s) => s.step.includes("に移動"))) {
      await callTool("browser_navigate", { url: resolveUrl("/") }).catch(
        () => {}
      );
      await callTool("browser_wait_for", {
        state: "load",
        timeout: 4000,
      }).catch(() => {});
    }

    let okCount = 0;
    let failCount = 0;

    for (const { step } of steps) {
      try {
        await executeStep(step);
        console.log(` ${chalk.green("✓")} ${step}`);
        okCount++;
      } catch (e) {
        console.error(
          ` ${chalk.red("✕")} ${step}  ${chalk.gray(
            "(" + (e.message || e) + ")"
          )}`
        );
        failCount++;
      }
    }

    if (failCount === 0) {
      console.log(
        chalk.bold.green(`\n PASS `) + `${f} (${okCount}/${steps.length})`
      );
    } else {
      console.log(
        chalk.bold.red(`\n FAIL `) +
          `${f} (${okCount} passed, ${failCount} failed)`
      );
      process.exitCode = 1; // CIで落とす
    }
  }

  await transport.close();
})().catch((e) => {
  console.error("[E-EXEC]", e?.message || e);
  process.exit(1);
});
