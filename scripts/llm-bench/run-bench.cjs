/**
 * Runs every candidate model on the benchmark tasks inside real Chrome (WebGPU or WASM),
 * exactly the way visitors' browsers would run them.
 *
 *   node scripts/llm-bench/run-bench.cjs [--device=webgpu|wasm] [--dtype=q4f16|q4] [--only=id1,id2]
 *                                        [--fixtures=<file>] [--out=<dir>] [--profile=<dir>]
 *
 * Needs Google Chrome installed (Playwright's bundled Chromium has no WebGPU adapter).
 * Results are written to scripts/llm-bench/results/<device>/<model>.json; score with score.ts.
 */
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("@playwright/test");

const root = path.resolve(__dirname, "..", "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const device = args.device ?? "webgpu";

const CANDIDATES = [
  { id: "onnx-community/Qwen2.5-0.5B-Instruct", params: "0.5B" },
  { id: "onnx-community/LFM2-700M-ONNX", params: "0.7B" },
  { id: "onnx-community/Qwen3-0.6B-ONNX", params: "0.6B" },
  { id: "onnx-community/LFM2-1.2B-ONNX", params: "1.2B" },
  { id: "onnx-community/gemma-3-1b-it-ONNX", params: "1B" },
  { id: "HuggingFaceTB/SmolLM2-1.7B-Instruct", params: "1.7B" },
  { id: "onnx-community/Qwen2.5-1.5B-Instruct", params: "1.5B" },
  { id: "onnx-community/Llama-3.2-1B-Instruct-q4f16", params: "1B" },
  { id: "onnx-community/Qwen3-1.7B-ONNX", params: "1.7B" },
];

const only = args.only ? args.only.split(",") : null;
const candidates = CANDIDATES.filter((c) => !only || only.some((o) => c.id.includes(o)));
const tasks = JSON.parse(fs.readFileSync(args.fixtures ?? path.join(__dirname, "fixtures.json"), "utf8"));
const outDir = args.out ?? path.join(__dirname, "results", device);
fs.mkdirSync(outDir, { recursive: true });

const FILES = {
  "/": [path.join(__dirname, "bench.html"), "text/html"],
  "/transformers.min.js": [
    path.join(root, "node_modules", "@huggingface", "transformers", "dist", "transformers.min.js"),
    "text/javascript",
  ],
};

const server = http.createServer((req, res) => {
  const file = FILES[req.url.split("?")[0]];
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  // Cross-origin isolation enables multi-threaded WebAssembly, as on the deployed site.
  res.writeHead(200, {
    "Content-Type": file[1],
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  });
  fs.createReadStream(file[0]).pipe(res);
});

(async () => {
  await new Promise((resolve) => server.listen(3210, resolve));
  // A persistent profile keeps downloaded weights between runs (several GB: keep it out of synced folders).
  const profile = args.profile ?? path.join(os.tmpdir(), "resumerag-llm-bench-profile");
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chrome",
    headless: true,
    args: ["--enable-unsafe-webgpu"],
  });

  for (const candidate of candidates) {
    const dtype = args.dtype ?? (device === "webgpu" ? "q4f16" : "q4");
    const outFile = path.join(outDir, `${candidate.id.replace("/", "__")}.json`);
    // Downloads of several GB occasionally hit a dropped connection: retry network failures.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const page = await context.newPage();
      page.on("console", (m) => console.log(`  [${candidate.id.split("/")[1]}] ${m.text()}`));
      try {
        await page.goto("http://localhost:3210/");
        await page.waitForFunction(() => window.benchReady === true);
        const result = await page.evaluate((input) => window.bench(input), { modelId: candidate.id, dtype, device, tasks });
        fs.writeFileSync(outFile, JSON.stringify({ ...result, params: candidate.params }, null, 2));
        console.log(`DONE ${candidate.id}`);
        break;
      } catch (error) {
        const message = String(error.message ?? error);
        const retryable = /Failed to fetch|tokenizer_class|network/i.test(message) && attempt < 3;
        console.log(`${retryable ? "RETRY" : "FAIL"} ${candidate.id}: ${message.split("\n")[0]}`);
        if (!retryable) fs.writeFileSync(outFile, JSON.stringify({ modelId: candidate.id, dtype, device, error: message }, null, 2));
        if (!retryable) break;
        await new Promise((resolve) => setTimeout(resolve, 30_000));
      } finally {
        await page.close();
      }
    }
  }

  await context.close();
  server.close();
})();
