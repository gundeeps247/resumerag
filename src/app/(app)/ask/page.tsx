"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { History, MessageSquarePlus, Search, Trash2, TriangleAlert } from "lucide-react";
import { AssistantMessage } from "@/components/chat/assistant-message";
import { Composer } from "@/components/chat/composer";
import { EvidencePanel, type EvidenceTab } from "@/components/chat/evidence-panel";
import { LoadDemoButton } from "@/components/documents/demo-button";
import { DocumentViewer } from "@/components/documents/document-viewer";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useKbStats } from "@/hooks/use-kb";
import { useLlmStatus } from "@/hooks/use-llm-status";
import { isDemoActive } from "@/lib/client/demo-session";
import { useSettings } from "@/lib/client/settings";
import { getDb, type MessageRecord } from "@/lib/db/schema";
import { SUGGESTED_QUESTIONS } from "@/lib/demo";
import { formatRelative, newId, truncate } from "@/lib/format";
import { askQuestion, type AskScope, type AskStage } from "@/lib/workflows/ask";

interface Pending {
  question: string;
  content: string;
  stage: AskStage;
}

export default function AskPage() {
  const settings = useSettings();
  const stats = useKbStats();
  const { status: llm } = useLlmStatus();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [selected, setSelected] = useState<{ messageId: string; tab: EvidenceTab; source?: number } | null>(null);
  const [mobileEvidence, setMobileEvidence] = useState(false);
  const [viewer, setViewer] = useState<{ docId: string; chunkId: string } | null>(null);
  const [scope, setScope] = useState<AskScope>("all");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const conversations = useLiveQuery(() => getDb().conversations.orderBy("updatedAt").reverse().limit(40).toArray(), []);
  const messages = useLiveQuery(
    () =>
      conversationId
        ? getDb().messages.where("conversationId").equals(conversationId).sortBy("createdAt")
        : Promise.resolve([] as MessageRecord[]),
    [conversationId],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages?.length, pending?.content, pending?.stage]);

  const selectedMessage = messages?.find((m) => m.id === selected?.messageId);
  const hasDocs = (stats?.ready ?? 0) > 0;

  function openEvidence(messageId: string, tab: EvidenceTab, source?: number) {
    setSelected({ messageId, tab, source });
    if (window.matchMedia("(max-width: 1279px)").matches) setMobileEvidence(true);
  }

  async function send(question: string) {
    const db = getDb();
    let convId = conversationId;
    if (!convId) {
      convId = newId();
      await db.conversations.add({
        id: convId,
        title: truncate(question, 80),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...(isDemoActive() ? { demo: true as const } : {}),
      });
      setConversationId(convId);
    }
    const history = (messages ?? []).map((m) => ({ role: m.role, content: m.content }));
    await db.messages.add({ id: newId(), conversationId: convId, role: "user", content: question, createdAt: Date.now() });

    const controller = new AbortController();
    abortRef.current = controller;
    setPending({ question, content: "", stage: "retrieving" });
    try {
      const result = await askQuestion(
        question,
        history,
        settings,
        {
          onStage: (stage) => setPending((p) => (p ? { ...p, stage } : p)),
          onDelta: (content) => setPending((p) => (p ? { ...p, content } : p)),
        },
        controller.signal,
        scope,
      );
      const id = newId();
      await db.messages.add({
        id,
        conversationId: convId,
        role: "assistant",
        content: result.content,
        createdAt: Date.now(),
        trace: result.trace,
      });
      await db.conversations.update(convId, { updatedAt: Date.now() });
      if (window.matchMedia("(min-width: 1280px)").matches) setSelected({ messageId: id, tab: "sources" });
    } catch (error) {
      const aborted = (error as Error).name === "AbortError";
      const partial = aborted ? pendingContentRef.current : "";
      if (!aborted) toast.error("Could not answer", { description: (error as Error).message });
      await db.messages.add({
        id: newId(),
        conversationId: convId,
        role: "assistant",
        content: aborted ? `${partial}\n\n_(stopped)_` : `Something went wrong: ${(error as Error).message}`,
        createdAt: Date.now(),
      });
    } finally {
      abortRef.current = null;
      setPending(null);
    }
  }

  // Keep the latest streamed text available for the abort handler.
  const pendingContentRef = useRef("");
  useEffect(() => {
    pendingContentRef.current = pending?.content ?? "";
  }, [pending]);

  async function deleteConversation(id: string) {
    const db = getDb();
    await db.messages.where("conversationId").equals(id).delete();
    await db.conversations.delete(id);
    if (id === conversationId) {
      setConversationId(null);
      setSelected(null);
    }
  }

  const evidence =
    selectedMessage?.trace && selected ? (
      <EvidencePanel
        trace={selectedMessage.trace}
        tab={selected.tab}
        highlight={selected.source}
        showPrompt={settings.developerMode}
        onTabChange={(tab) => setSelected((s) => (s ? { ...s, tab, source: undefined } : s))}
        onClose={() => {
          setSelected(null);
          setMobileEvidence(false);
        }}
        onOpenDocument={(docId, chunkId) => setViewer({ docId, chunkId })}
      />
    ) : null;

  const empty = !messages?.length && !pending;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <p className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
            {conversationId ? conversations?.find((c) => c.id === conversationId)?.title : "New conversation"}
          </p>
          <Select value={scope} onValueChange={(v) => setScope(v as AskScope)}>
            <SelectTrigger size="sm" className="w-40" aria-label="Search scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="all">All documents</SelectItem>
              <SelectItem value="candidate">My background only</SelectItem>
              <SelectItem value="employer">Job &amp; company docs</SelectItem>
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm">
                <History /> History
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-1">
              {conversations?.length ? (
                <div className="max-h-80 overflow-y-auto">
                  {conversations.map((c) => (
                    <div key={c.id} className="group hover:bg-muted flex items-center gap-1 rounded-md">
                      <button
                        type="button"
                        className="min-w-0 flex-1 px-2 py-1.5 text-left"
                        onClick={() => {
                          setConversationId(c.id);
                          setSelected(null);
                        }}
                      >
                        <p className="truncate text-sm">{c.title}</p>
                        <p className="text-muted-foreground text-[11px]">{formatRelative(c.updatedAt)}</p>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="opacity-0 group-hover:opacity-100"
                        onClick={() => void deleteConversation(c.id)}
                        aria-label="Delete conversation"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground p-3 text-sm">No conversations yet.</p>
              )}
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setConversationId(null);
              setSelected(null);
            }}
          >
            <MessageSquarePlus /> New chat
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6">
            {empty ? (
              <EmptyChat hasDocs={hasDocs} onPick={(q) => void send(q)} />
            ) : (
              <>
                {messages?.map((m) =>
                  m.role === "user" ? (
                    <UserBubble key={m.id} text={m.content} />
                  ) : (
                    <AssistantMessage
                      key={m.id}
                      content={m.content}
                      trace={m.trace}
                      developerMode={settings.developerMode}
                      onOpenEvidence={(tab, source) => openEvidence(m.id, tab, source)}
                    />
                  ),
                )}
                {pending && <AssistantMessage content={pending.content} stage={pending.stage} />}
              </>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="mx-auto w-full max-w-3xl px-4 pb-4">
          {llm && !llm.available && hasDocs && (
            <div className="border-warning/30 bg-warning/5 mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
              <TriangleAlert className="text-warning mt-0.5 size-3.5 shrink-0" />
              <span>
                No language model available — answers will show extracted evidence only.{" "}
                <Link href="/settings#model" className="font-medium underline underline-offset-2">
                  Choose a model
                </Link>
              </span>
            </div>
          )}
          <Composer
            onSend={(q) => void send(q)}
            onStop={() => abortRef.current?.abort()}
            busy={Boolean(pending)}
            disabled={!hasDocs}
            placeholder={hasDocs ? undefined : "Add documents to your knowledge base first…"}
            hint="Answers use only your documents and cite their sources. Always double-check before an interview."
          />
        </div>
      </div>

      <aside className="bg-surface hidden w-[420px] shrink-0 border-l xl:flex xl:flex-col">
        {evidence ?? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <Search className="text-muted-foreground size-5" />
            <p className="text-sm font-medium">Evidence appears here</p>
            <p className="text-muted-foreground text-xs">
              Every answer lists the passages it used and shows how the RAG pipeline found them.
            </p>
          </div>
        )}
      </aside>

      <Sheet open={mobileEvidence && Boolean(evidence)} onOpenChange={setMobileEvidence}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-md">
          <SheetTitle className="sr-only">Evidence</SheetTitle>
          {evidence}
        </SheetContent>
      </Sheet>

      <DocumentViewer docId={viewer?.docId ?? null} focusChunkId={viewer?.chunkId} onClose={() => setViewer(null)} />
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

function EmptyChat({ hasDocs, onPick }: { hasDocs: boolean; onPick: (q: string) => void }) {
  if (!hasDocs) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <div className="bg-muted grid size-12 place-items-center rounded-xl">
          <MessageSquarePlus className="text-muted-foreground size-5" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Your knowledge base is empty</h2>
          <p className="text-muted-foreground max-w-md text-sm">
            Answers are grounded in your documents, so add a resume or project report first — or try the fictional demo.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/documents">Upload documents</Link>
          </Button>
          <LoadDemoButton variant="default" />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-6 py-10">
      <div className="space-y-2 text-center">
        <h2 className="text-xl font-semibold tracking-tight">What do you want to prepare?</h2>
        <p className="text-muted-foreground mx-auto max-w-md text-sm">
          Ask anything about your experience. Every answer is built only from your documents, with numbered citations you can inspect.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="bg-card hover:border-foreground/20 hover:bg-muted/50 rounded-xl border px-4 py-3 text-left text-sm transition-colors"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
