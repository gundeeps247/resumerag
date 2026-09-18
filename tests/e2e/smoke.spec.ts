import { expect, test } from "@playwright/test";

// Pin the connection to the server provider so the test does not depend on whoever happens to be
// running Ollama, and never downloads the in-browser model. Without a server provider the app
// answers in evidence-only mode, which still exercises retrieval, citations and refusals.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    const raw = window.localStorage.getItem("resumerag.settings.v1");
    const saved = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.localStorage.setItem("resumerag.settings.v1", JSON.stringify({ ...saved, version: 2, llm: { mode: "server" } }));
  });
});

test("landing page explains the product", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /grounded in your own documents/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /try the demo workspace/i })).toBeVisible();
});

test("demo workspace is indexed in the browser and answers cite their sources", async ({ page }) => {
  // 1. Ingestion: parse, chunk and embed six demo documents client-side.
  await page.goto("/documents");
  await page
    .getByRole("button", { name: /load demo workspace/i })
    .first()
    .click();
  await expect(page.getByText(/\d+ chunks ·/)).toHaveCount(6, { timeout: 240_000 });

  // 2. Grounded answer with citations (LLM answer or evidence-only fallback).
  await page.goto("/ask");
  await page.getByRole("textbox", { name: "Message" }).fill("Which algorithm did I use for the churn model?");
  await page.keyboard.press("Enter");
  const trace = page.getByRole("button", { name: /How this answer was generated/ });
  await expect(trace).toBeVisible({ timeout: 240_000 });
  await expect(page.locator("[data-citation]").first()).toBeVisible();

  // 3. The pipeline panel shows each retrieval stage.
  await trace.click();
  await expect(page.getByText("Reciprocal rank fusion")).toBeVisible();
  await expect(page.getByText("Cross-encoder reranking")).toBeVisible();

  // 4. Questions the documents cannot answer are refused instead of guessed.
  await page.getByRole("button", { name: /New chat/ }).click();
  await page.getByRole("textbox", { name: "Message" }).fill("Have I ever worked at Google?");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/couldn't find enough evidence/).first()).toBeVisible({ timeout: 120_000 });
});
