"use client";

/**
 * Safe markdown rendering for model output. react-markdown builds React elements
 * (it never injects raw HTML), so a model or a document cannot smuggle <script> tags
 * into the page. Citation links (#cite-N) are rendered by the caller as chips.
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownProps {
  children: string;
  className?: string;
  renderCitation?: (n: number | null) => React.ReactNode;
}

export function Markdown({ children, className, renderCitation }: MarkdownProps) {
  return (
    <div className={cn("markdown", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: linkChildren }) => {
            if (href?.startsWith("#cite-") && renderCitation) {
              const n = Number(href.slice(6));
              return <>{renderCitation(Number.isFinite(n) ? n : null)}</>;
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {linkChildren}
              </a>
            );
          },
          img: () => null,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
