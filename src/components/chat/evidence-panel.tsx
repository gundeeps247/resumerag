"use client";

import { FileText, Workflow, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AnswerRecordTrace } from "@/lib/db/records";
import { PipelineTrace } from "./pipeline-trace";
import { SourceCard } from "./source-card";

export type EvidenceTab = "sources" | "pipeline" | "prompt";

interface EvidencePanelProps {
  trace: AnswerRecordTrace;
  tab: EvidenceTab;
  onTabChange: (tab: EvidenceTab) => void;
  highlight?: number;
  onClose?: () => void;
  onOpenDocument?: (docId: string, chunkId: string) => void;
  showPrompt?: boolean;
}

export function EvidencePanel({ trace, tab, onTabChange, highlight, onClose, onOpenDocument, showPrompt }: EvidencePanelProps) {
  const results = trace.retrieval.results;
  const inContext = trace.prompt?.sourceCount ?? results.length;

  return (
    <Tabs value={tab} onValueChange={(v) => onTabChange(v as EvidenceTab)} className="flex h-full min-h-0 flex-col gap-0">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <TabsList className="flex-1">
          <TabsTrigger value="sources">
            <FileText /> Sources
          </TabsTrigger>
          <TabsTrigger value="pipeline">
            <Workflow /> Pipeline
          </TabsTrigger>
          {showPrompt && trace.prompt && <TabsTrigger value="prompt">Prompt</TabsTrigger>}
        </TabsList>
        {onClose && (
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close evidence panel">
            <X />
          </Button>
        )}
      </div>

      <TabsContent value="sources" className="min-h-0 flex-1 overflow-y-auto">
        <div>
          <div className="space-y-3 p-3">
            <p className="text-muted-foreground text-xs">
              {trace.mode === "refused"
                ? "Closest passages found — none was relevant enough to answer from."
                : `The ${inContext} passages below were given to the model. Numbers match the citations in the answer.`}
            </p>
            {results.map((source, i) => (
              <SourceCard
                key={source.chunk.id}
                n={i + 1}
                source={source}
                highlighted={highlight === i + 1}
                onOpenDocument={onOpenDocument}
              />
            ))}
          </div>
        </div>
      </TabsContent>

      <TabsContent value="pipeline" className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-4">
          <PipelineTrace trace={trace} />
        </div>
      </TabsContent>

      {trace.prompt && (
        <TabsContent value="prompt" className="min-h-0 flex-1 overflow-y-auto">
          <div>
            <div className="space-y-3 p-3 text-xs">
              <p className="text-muted-foreground">The exact prompt sent to the language model (developer mode).</p>
              <div>
                <p className="mb-1 font-medium">System</p>
                <pre className="bg-muted rounded-lg p-3 font-mono text-[10.5px] whitespace-pre-wrap">{trace.prompt.system}</pre>
              </div>
              <div>
                <p className="mb-1 font-medium">User</p>
                <pre className="bg-muted rounded-lg p-3 font-mono text-[10.5px] whitespace-pre-wrap">{trace.prompt.user}</pre>
              </div>
            </div>
          </div>
        </TabsContent>
      )}
    </Tabs>
  );
}
