"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FileStack, RefreshCw } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { LoadDemoButton } from "@/components/documents/demo-button";
import { DocumentList, DocumentListSkeleton } from "@/components/documents/document-list";
import { DocumentViewer } from "@/components/documents/document-viewer";
import { PasteDialog } from "@/components/documents/paste-dialog";
import { DemoNotice } from "@/components/documents/demo-notice";
import { UploadDropzone } from "@/components/documents/upload-dropzone";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useDocuments } from "@/hooks/use-kb";
import { reindexDocuments } from "@/lib/client/documents";
import { useSettings } from "@/lib/client/settings";
import { getEmbeddingModel } from "@/lib/rag/embeddings/models";

export default function DocumentsPage() {
  const documents = useDocuments();
  const settings = useSettings();
  const [viewing, setViewing] = useState<string | null>(null);

  const stale = useMemo(
    () =>
      (documents ?? []).filter(
        (d) =>
          d.status === "ready" &&
          (d.embeddingModel !== settings.embeddingModelId ||
            d.chunking?.chunkSize !== settings.chunking.chunkSize ||
            d.chunking?.chunkOverlap !== settings.chunking.chunkOverlap),
      ),
    [documents, settings.embeddingModelId, settings.chunking],
  );
  const hasDemo = documents?.some((d) => d.source === "demo");
  const totalChunks = documents?.filter((d) => d.status === "ready").reduce((n, d) => n + d.chunkCount, 0) ?? 0;

  return (
    <PageContainer>
      <PageHeader
        title="Knowledge base"
        description="Everything the assistant knows about you comes from these documents. Each file is parsed, split into chunks and embedded — all inside your browser."
        actions={
          <>
            <PasteDialog />
            {!hasDemo && <LoadDemoButton />}
          </>
        }
      />

      <DemoNotice />

      <UploadDropzone />

      {stale.length > 0 && (
        <Alert>
          <RefreshCw />
          <AlertTitle>{stale.length} document(s) were indexed with different settings</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Your current embedding model or chunk size differs from the one these documents were indexed with. Vectors from different
              settings are not comparable, so re-index to use them in search.
            </span>
            <Button
              size="sm"
              onClick={() => {
                void reindexDocuments(
                  stale.map((d) => d.id),
                  settings,
                );
                toast.info(`Re-indexing ${stale.length} document(s)`);
              }}
            >
              Re-index now
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Documents</h2>
          {documents && documents.length > 0 && (
            <p className="text-muted-foreground text-xs tabular-nums">
              {documents.length} documents · {totalChunks} chunks · {getEmbeddingModel(settings.embeddingModelId).label}
            </p>
          )}
        </div>
        {documents === undefined ? (
          <DocumentListSkeleton />
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
            <div className="bg-muted grid size-10 place-items-center rounded-lg">
              <FileStack className="text-muted-foreground size-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">No documents yet</p>
              <p className="text-muted-foreground max-w-sm text-sm">
                Upload your resume and a project report, or load the fictional demo workspace to try everything in one click.
              </p>
            </div>
            <LoadDemoButton variant="default" />
          </div>
        ) : (
          <DocumentList documents={documents} onView={setViewing} />
        )}
      </section>

      <DocumentViewer docId={viewing} onClose={() => setViewing(null)} />
    </PageContainer>
  );
}
