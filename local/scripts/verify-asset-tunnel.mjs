import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocket } from "ws";
import { startDaemon, spawnTunnel, atomicJson } from "../dist/library.mjs";
import { root, settings } from "./project.mjs";

// Isolated acceptance data: never stop or mutate the installed user's runtime.
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0")
  throw new Error("Normal certificate verification is required.");
const temporary = await mkdtemp(join(tmpdir(), "codesk-assets-tunnel-"));
const configuration = {
  ...settings(),
  installationId: randomUUID(),
  dataDir: join(temporary, "data"),
};
const path = join(temporary, "settings.json");
atomicJson(path, configuration);
const handles = [];
const daemon = await startDaemon(configuration, {
  directory: join(root, "dist"),
  tunnelFactory: (options) => {
    const handle = spawnTunnel(options);
    handles.push(handle);
    return handle;
  },
});
const client = new Client({ name: "isolated-assets-test", version: "1" });
const transport = new StdioClientTransport({
  command: configuration.nodePath,
  args: [join(root, "dist/stdio.mjs"), path],
  stderr: "pipe",
});
let socket;
let browser, page;
try {
  if (process.argv.includes('--browser')) {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    page = await browser.newPage({ ignoreHTTPSErrors: false });
  }
  await client.connect(transport);
  const call = (name, args = {}) =>
    client.callTool({ name, arguments: args }, undefined, { timeout: 47000 });
  const opened = await call("open_plugin");
  assert.ok(!opened.isError, opened.content?.[0]?.text);
  const bootstrap = opened._meta["codesk/bootstrap"];
  const assets = JSON.parse(
    await readFile(join(root, "dist/ui-assets.json"), "utf8"),
  );
  async function check(result) {
    const origin = new URL(
      result._meta["codesk/bootstrap"].socketUrl,
    ).origin.replace("wss:", "https:");
    const view = (
      await client.readResource({ uri: result._meta.ui.resourceUri })
    ).contents[0];
    assert.deepEqual(view._meta.ui.csp.resourceDomains, [origin]);
    for (const [file, info] of Object.entries(assets)) {
      assert.ok(view.text.includes(`${origin}/${file}`));
      const response = await fetch(`${origin}/${file}`, {
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      assert.equal(response.status, 200);
      assert.equal(
        createHash("sha256")
          .update(Buffer.from(await response.arrayBuffer()))
          .digest("hex"),
        info.sha256,
      );
    }
    const file = Object.keys(assets).find((file) => file.endsWith(".mp4"));
    const range = await fetch(`${origin}/${file}`, {
      headers: { Range: "bytes=0-31" },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 32);
    if (page) {
      // No DNS, request-routing, certificate or WebSocket overrides. The page
      // is the actual public standalone preview; this is not native Codex.
      const response = await page.goto(origin, { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 200);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
      assert.ok(await page.evaluate(() => document.fonts.check('400 16px Outfit')));
      await page.evaluate(bootstrap => new Promise((resolve, reject) => {
        window.tunnelFrames = [];
        const socket = new WebSocket(bootstrap.socketUrl, ['codesk.local.ws', `cap.${bootstrap.capability}`]);
        const timer = setTimeout(() => { socket.close(); reject(new Error('Browser WSS timeout')); }, 10000);
        socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Browser WSS failed')); });
        socket.addEventListener('message', event => {
          if (event.data === 'pong') return;
          const frame = JSON.parse(event.data);
          if (frame.type === 'state') { window.tunnelFrames.push(frame.value); clearTimeout(timer); resolve(); }
        });
      }), result._meta['codesk/bootstrap']);
      assert.deepEqual(await page.evaluate(() => window.tunnelFrames), [result.structuredContent.value]);
    }
  }
  await check(opened);
  const frames = [];
  socket = new WebSocket(
    bootstrap.socketUrl,
    ["codesk.local.ws", `cap.${bootstrap.capability}`],
    { handshakeTimeout: 10000 },
  );
  socket.on("message", (bytes) => {
    if (bytes.toString() !== "pong") frames.push(JSON.parse(bytes.toString()));
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  for (const value of [5, 12, 3])
    assert.ok(
      !(
        await call("set_state", {
          run_id: bootstrap.runId,
          value,
          operation_id: randomUUID(),
        })
      ).isError,
    );
  const until = Date.now() + 10000;
  while (!frames.some((frame) => frame.value === 3 && frame.revision === 3)) {
    if (Date.now() > until) throw new Error("WSS update timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.deepEqual(frames.filter((frame) => frame.type === 'state').map((frame) => frame.value), [0, 5, 12, 3]);
  if (page) {
    await page.waitForFunction(() => window.tunnelFrames?.at(-1) === 3);
    assert.deepEqual(await page.evaluate(() => window.tunnelFrames), [0, 5, 12, 3]);
  }
  await handles[0].close();
  const deadline = Date.now() + 60000;
  while (
    daemon.status().phase !== "ready" ||
    daemon.status().generation === bootstrap.generation
  ) {
    if (Date.now() > deadline) throw new Error("Replacement tunnel timeout");
    await new Promise((r) => setTimeout(r, 100));
  }
  const reopened = await call("open_plugin", { run_id: bootstrap.runId });
  assert.ok(!reopened.isError);
  assert.equal(reopened.structuredContent.value, 3);
  assert.notEqual(reopened._meta.ui.resourceUri, opened._meta.ui.resourceUri);
  await check(reopened);
  const evidence = {
    checkedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    buildHash: daemon.status().buildHash,
    isolated: true,
    normalTLS: true,
    assetHashes: 4,
    mp4Range: true,
    liveWSSSequence: [0, 5, 12, 3],
    replacementGeneration: true,
    savedRunPreserved: true,
    ...(page ? { browser: { normalDNSAndTLS: true, fontsAndVideo: true, liveWSS: true, replacement: true } } : {}),
    nativeCodexAcceptance: "pending",
  };
  await mkdir(join(root, 'test-results'), { recursive: true });
  await writeFile(
    join(root, "test-results/tunnel-assets.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  const status = daemon.status();
  console.error(JSON.stringify({
    phase: status.phase,
    tunnelRestarts: status.tunnelRestarts,
    tunnelError: status.error,
  }, null, 2));
  throw error;
} finally {
  socket?.terminate();
  await browser?.close();
  await client.close();
  await daemon.close();
}
