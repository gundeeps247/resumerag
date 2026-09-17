"use client";

import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Cpu, Database, HardDrive, Lock, RefreshCw, Server, ShieldCheck, Trash2, Wrench } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDocuments } from "@/hooks/use-kb";
import { useLlmStatus } from "@/hooks/use-llm-status";
import { deleteAllData, reindexDocuments } from "@/lib/client/documents";
import { DEFAULT_SETTINGS, resetSettings, updateSettings, useSettings } from "@/lib/client/settings";
import { EMBEDDING_MODELS, getEmbeddingModel } from "@/lib/rag/embeddings/models";
import type { RetrievalMode } from "@/lib/rag/types";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        title="Settings"
        description="Everything is stored in this browser. Defaults are tuned with the evaluation set — change them in the RAG Playground first to see the effect."
      />
      <ModelSection />
      <RetrievalSection />
      <IndexingSection />
      <PrivacySection />
      <DeveloperSection />
    </PageContainer>
  );
}

function Section({
  id,
  icon: Icon,
  title,
  description,
  children,
}: {
  id: string;
  icon: typeof Cpu;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="bg-card scroll-mt-20 rounded-xl border">
      <div className="flex items-start gap-3 border-b p-5">
        <Icon className="text-brand mt-0.5 size-4" />
        <div>
          <h2 className="font-semibold tracking-tight">{title}</h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
      </div>
      <div className="space-y-6 p-5">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-[220px_1fr] sm:items-start", className)}>
      <div>
        <Label>{label}</Label>
        {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ModelSection() {
  const settings = useSettings();
  const { status, loading, refresh } = useLlmStatus();
  const llm = settings.llm;
  const setLlm = (patch: Partial<typeof llm>) => updateSettings((s) => ({ ...s, llm: { ...s.llm, ...patch } }));

  return (
    <Section
      id="model"
      icon={Server}
      title="Language model"
      description="Generates answers from retrieved passages. Retrieval, citations and evaluation work without it."
    >
      <Row label="Connection" hint="How the browser reaches a model.">
        <RadioGroup value={llm.mode} onValueChange={(v) => setLlm({ mode: v as typeof llm.mode, model: undefined })} className="gap-3">
          <label className="has-[:checked]:border-brand flex cursor-pointer items-start gap-3 rounded-lg border p-3">
            <RadioGroupItem value="server" className="mt-0.5" />
            <div>
              <p className="text-sm font-medium">Server provider (default)</p>
              <p className="text-muted-foreground text-xs">
                The Next.js API route calls the provider set in environment variables (Ollama locally, or an optional hosted API). Keys
                never reach the browser.
              </p>
            </div>
          </label>
          <label className="has-[:checked]:border-brand flex cursor-pointer items-start gap-3 rounded-lg border p-3">
            <RadioGroupItem value="browser-ollama" className="mt-0.5" />
            <div>
              <p className="text-sm font-medium">Ollama on this computer (private mode)</p>
              <p className="text-muted-foreground text-xs">
                The browser talks directly to Ollama on your machine — ideal on the deployed site: prompts and documents never leave your
                computer.
              </p>
            </div>
          </label>
        </RadioGroup>
      </Row>

      {llm.mode === "browser-ollama" && (
        <Row
          label="Ollama URL"
          hint={
            <>
              Allow this site in Ollama first: set <code className="bg-muted rounded px-1">OLLAMA_ORIGINS</code> to this site&apos;s origin
              and restart Ollama.
            </>
          }
        >
          <Input value={llm.ollamaUrl ?? ""} onChange={(e) => setLlm({ ollamaUrl: e.target.value })} placeholder="http://localhost:11434" />
        </Row>
      )}

      <Row label="Status">
        <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
          <div className="space-y-0.5 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <span className={cn("size-2 rounded-full", status?.available ? "bg-success" : "bg-warning")} />
              {loading && !status ? "Checking…" : status?.available ? `Connected · ${status.label}` : "Not available — evidence-only mode"}
            </p>
            {status?.model && <p className="text-muted-foreground text-xs">Default model: {status.model}</p>}
            {status?.error && <p className="text-warning text-xs">{status.error}</p>}
          </div>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw /> Refresh
          </Button>
        </div>
      </Row>

      {status && status.models.length > 0 && (
        <Row label="Model" hint="Smaller models are faster; 7B+ models follow instructions and JSON formats more reliably.">
          <Select value={llm.model ?? "__default"} onValueChange={(v) => setLlm({ model: v === "__default" ? undefined : v })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default">Server default ({status.model})</SelectItem>
              {status.models.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      )}

      {status?.requiresAccessCode && llm.mode === "server" && (
        <Row label="Access code" hint="This deployment protects its model endpoint with a shared code.">
          <Input type="password" value={llm.accessCode ?? ""} onChange={(e) => setLlm({ accessCode: e.target.value })} />
        </Row>
      )}

      <Row
        label={`Temperature · ${settings.temperature.toFixed(1)}`}
        hint="Lower = more literal and repeatable. Grounded answers work best at 0.1–0.3."
      >
        <Slider
          min={0}
          max={1}
          step={0.1}
          value={[settings.temperature]}
          onValueChange={([v]) => updateSettings((s) => ({ ...s, temperature: v }))}
        />
      </Row>

      <Row
        label="Strict grounding"
        hint="Refuse to answer (without calling the model) when retrieval finds no relevant evidence. Recommended."
      >
        <Switch checked={settings.strictGrounding} onCheckedChange={(v) => updateSettings((s) => ({ ...s, strictGrounding: v }))} />
      </Row>
    </Section>
  );
}

function RetrievalSection() {
  const { retrieval } = useSettings();
  const set = (patch: Partial<typeof retrieval>) => updateSettings((s) => ({ ...s, retrieval: { ...s.retrieval, ...patch } }));
  return (
    <Section
      id="retrieval"
      icon={Database}
      title="Retrieval"
      description="How passages are found for each question. Takes effect immediately — no re-indexing needed."
    >
      <Row label="Search mode" hint="Hybrid combines meaning-based and exact keyword search with reciprocal rank fusion.">
        <ToggleGroup type="single" variant="outline" value={retrieval.mode} onValueChange={(v) => v && set({ mode: v as RetrievalMode })}>
          <ToggleGroupItem value="semantic">Semantic</ToggleGroupItem>
          <ToggleGroupItem value="keyword">Keyword (BM25)</ToggleGroupItem>
          <ToggleGroupItem value="hybrid">Hybrid</ToggleGroupItem>
        </ToggleGroup>
      </Row>
      <Row
        label="Cross-encoder reranking"
        hint="Re-scores the candidates with a model that reads question and passage together. +0.09 MRR in our evaluation; about 1–1.5 s per question in the browser."
      >
        <Switch checked={retrieval.rerank} onCheckedChange={(v) => set({ rerank: v })} />
      </Row>
      <Row
        label="Interview-aware query expansion"
        hint="Adds concrete vocabulary for abstract interview themes to keyword search (“leadership” → “led, managed, mentored”)."
      >
        <Switch checked={retrieval.queryExpansion !== false} onCheckedChange={(v) => set({ queryExpansion: v })} />
      </Row>
      <Row
        label={`Passages in context (top-K) · ${retrieval.topK}`}
        hint="More passages = more context for the model, but more noise and a longer prompt."
      >
        <Slider min={1} max={10} step={1} value={[retrieval.topK]} onValueChange={([v]) => set({ topK: v })} />
      </Row>
      <Row
        label={`Candidates per retriever · ${retrieval.candidateK}`}
        hint="How many results each retriever passes on to fusion and reranking."
      >
        <Slider min={5} max={40} step={1} value={[retrieval.candidateK]} onValueChange={([v]) => set({ candidateK: v })} />
      </Row>
      <Row
        label={`Minimum similarity · ${retrieval.minSimilarity.toFixed(2)}`}
        hint="Drop candidates below this cosine similarity. 0 disables the filter."
      >
        <Slider min={0} max={0.9} step={0.01} value={[retrieval.minSimilarity]} onValueChange={([v]) => set({ minSimilarity: v })} />
      </Row>
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => updateSettings((s) => ({ ...s, retrieval: DEFAULT_SETTINGS.retrieval }))}>
          Restore defaults
        </Button>
      </div>
    </Section>
  );
}

function IndexingSection() {
  const settings = useSettings();
  const documents = useDocuments();
  const { chunking } = settings;
  const setChunking = (patch: Partial<typeof chunking>) => updateSettings((s) => ({ ...s, chunking: { ...s.chunking, ...patch } }));
  const model = getEmbeddingModel(settings.embeddingModelId);
  const ready = documents?.filter((d) => d.status === "ready") ?? [];
  const stale = ready.filter(
    (d) =>
      d.embeddingModel !== settings.embeddingModelId ||
      d.chunking?.chunkSize !== chunking.chunkSize ||
      d.chunking?.chunkOverlap !== chunking.chunkOverlap,
  );

  return (
    <Section
      id="indexing"
      icon={Cpu}
      title="Indexing"
      description="How documents are chunked and embedded. Changing these requires re-indexing (the parsed text is kept, so it is fast)."
    >
      <Row label="Embedding model" hint="Runs in your browser via Transformers.js. Downloaded once, then cached.">
        <div className="space-y-2">
          <Select value={settings.embeddingModelId} onValueChange={(v) => updateSettings((s) => ({ ...s, embeddingModelId: v }))}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMBEDDING_MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label} · {m.dims}d · {m.sizeMb} MB
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">{model.description}</p>
        </div>
      </Row>
      <Row label="Compute" hint="WebGPU can be faster on supported browsers and GPUs; WASM works everywhere.">
        <ToggleGroup
          type="single"
          variant="outline"
          value={settings.device}
          onValueChange={(v) => v && updateSettings((s) => ({ ...s, device: v as "wasm" | "webgpu" }))}
        >
          <ToggleGroupItem value="wasm">WASM (CPU)</ToggleGroupItem>
          <ToggleGroupItem value="webgpu">WebGPU (experimental)</ToggleGroupItem>
        </ToggleGroup>
      </Row>
      <Row
        label={`Chunk size · ${chunking.chunkSize} tokens`}
        hint="Target size of each searchable passage. ~220 ≈ one resume role or two report paragraphs."
      >
        <Slider min={100} max={600} step={10} value={[chunking.chunkSize]} onValueChange={([v]) => setChunking({ chunkSize: v })} />
      </Row>
      <Row
        label={`Overlap · ${chunking.chunkOverlap} tokens`}
        hint="Trailing sentences repeated at the start of the next chunk within a section."
      >
        <Slider min={0} max={120} step={5} value={[chunking.chunkOverlap]} onValueChange={([v]) => setChunking({ chunkOverlap: v })} />
      </Row>
      <div className="bg-muted/30 flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          {stale.length ? (
            <>
              <span className="font-medium">{stale.length} document(s)</span> use different settings and are excluded from search until
              re-indexed.
            </>
          ) : (
            "All documents are indexed with the current settings."
          )}
        </p>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              updateSettings((s) => ({ ...s, chunking: DEFAULT_SETTINGS.chunking, embeddingModelId: DEFAULT_SETTINGS.embeddingModelId }))
            }
          >
            Defaults
          </Button>
          <Button
            size="sm"
            disabled={!ready.length}
            onClick={() => {
              void reindexDocuments(
                ready.map((d) => d.id),
                settings,
              );
              toast.info(`Re-indexing ${ready.length} document(s)…`);
            }}
          >
            <RefreshCw /> Re-index all
          </Button>
        </div>
      </div>
    </Section>
  );
}

function PrivacySection() {
  return (
    <Section id="privacy" icon={ShieldCheck} title="Privacy & data" description="What stays on your device and what does not.">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <HardDrive className="text-success size-4" /> Stays in this browser
          </p>
          <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5 text-sm">
            <li>Your uploaded files (parsed in the browser; the original file is not kept)</li>
            <li>Extracted text, chunks and embedding vectors (IndexedDB)</li>
            <li>Chats, mock interviews, question bank and analyses</li>
          </ul>
        </div>
        <div className="rounded-lg border p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Lock className="text-warning size-4" /> Leaves the browser
          </p>
          <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5 text-sm">
            <li>
              For each question: the prompt with the top passages is sent to the language model. With{" "}
              <span className="text-foreground">local Ollama</span>, it never leaves your computer; with a hosted provider it goes to that
              provider.
            </li>
            <li>Model downloads: weights from Hugging Face and runtime files from jsDelivr (no document data).</li>
          </ul>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        There are no accounts, analytics or server-side storage of documents. Clearing your browser data removes everything.
      </p>
      <div className="flex flex-wrap gap-2">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive">
              <Trash2 /> Delete all data
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete everything?</DialogTitle>
              <DialogDescription>
                This permanently removes all documents, vectors, chats, interviews and saved questions from this browser.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    await deleteAllData();
                    toast.success("All local data deleted");
                  }}
                >
                  Delete all data
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button variant="outline" onClick={() => resetSettings()}>
          Reset settings
        </Button>
      </div>
    </Section>
  );
}

function DeveloperSection() {
  const settings = useSettings();
  const { theme, setTheme } = useTheme();
  return (
    <Section id="developer" icon={Wrench} title="Developer & appearance" description="Engineering metrics for demos and debugging.">
      <Row label="Developer mode" hint="Shows latency, token counts and the exact prompt under every answer.">
        <Switch checked={settings.developerMode} onCheckedChange={(v) => updateSettings((s) => ({ ...s, developerMode: v }))} />
      </Row>
      <Row label="Theme">
        <ToggleGroup type="single" variant="outline" value={theme ?? "system"} onValueChange={(v) => v && setTheme(v)}>
          <ToggleGroupItem value="light">Light</ToggleGroupItem>
          <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
          <ToggleGroupItem value="system">System</ToggleGroupItem>
        </ToggleGroup>
      </Row>
    </Section>
  );
}
