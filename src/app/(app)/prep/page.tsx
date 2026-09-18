"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, FolderGit2, GitCompareArrows, ListChecks, ScanSearch, Star, Target, UsersRound } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { getDb } from "@/lib/db/schema";

const TOOLS = [
  {
    href: "/prep/resume",
    icon: ScanSearch,
    title: "Resume X-ray",
    description:
      "Every claim on your resume, scored for how likely an interviewer is to challenge it — plus the evidence that backs it up.",
    tag: "Weakness detector · Grill mode",
  },
  {
    href: "/prep/project",
    icon: FolderGit2,
    title: "Project deep dive",
    description: "Explain a project at five levels of depth and practise a ladder of increasingly hard follow-up questions.",
    tag: "Explain my project",
  },
  {
    href: "/prep/questions",
    icon: ListChecks,
    title: "Question generator",
    description:
      "Recruiter, technical, behavioural, AI/ML and system-design questions tailored to your documents. Save them to a question bank.",
    tag: "Easy · Medium · Hard",
  },
  {
    href: "/prep/star",
    icon: Star,
    title: "STAR builder",
    description:
      "Turn real experiences from your documents into structured behavioural answers — facts and suggested wording kept separate.",
    tag: "Behavioural answers",
  },
  {
    href: "/prep/consistency",
    icon: GitCompareArrows,
    title: "Consistency checker",
    description: "Find numbers that disagree across your resume, reports and notes before an interviewer does.",
    tag: "Contradictions",
  },
];

export default function PrepStudioPage() {
  const bank = useLiveQuery(() => getDb().questions.toArray(), []);
  const confident = bank?.filter((q) => q.status === "confident").length ?? 0;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="More tools"
        title="Prep tools"
        description="Specialised tools for when Ask and Practise are not enough. All of them use the same retrieval pipeline, and every output cites the passages it came from."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {TOOLS.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="group bg-card hover:border-foreground/20 flex flex-col gap-3 rounded-xl border p-5 transition-all hover:-translate-y-0.5 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div className="bg-brand/10 text-brand grid size-10 place-items-center rounded-lg">
                <tool.icon className="size-5" />
              </div>
              <ArrowRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5" />
            </div>
            <div className="space-y-1.5">
              <h2 className="font-semibold tracking-tight">{tool.title}</h2>
              <p className="text-muted-foreground text-sm">{tool.description}</p>
            </div>
            <p className="text-muted-foreground mt-auto text-[11px] font-medium">{tool.tag}</p>
          </Link>
        ))}
        <div className="flex flex-col justify-between gap-4 rounded-xl border border-dashed p-5">
          <div className="space-y-1.5">
            <h2 className="font-semibold tracking-tight">Question bank</h2>
            <p className="text-muted-foreground text-sm">
              {bank?.length
                ? `${bank.length} saved questions · ${confident} marked confident.`
                : "Questions you save from any tool appear here."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link href="/prep/questions#bank" className="text-brand inline-flex items-center gap-1 font-medium hover:underline">
              Open bank <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href="/mock"
          className="group bg-card hover:border-foreground/20 flex items-center gap-4 rounded-xl border p-5 transition-colors"
        >
          <UsersRound className="text-brand size-5" />
          <div className="flex-1">
            <p className="font-medium">Mock interview</p>
            <p className="text-muted-foreground text-sm">Answer questions and get rubric-based feedback checked against your documents.</p>
          </div>
          <ArrowRight className="text-muted-foreground size-4" />
        </Link>
        <Link
          href="/jd"
          className="group bg-card hover:border-foreground/20 flex items-center gap-4 rounded-xl border p-5 transition-colors"
        >
          <Target className="text-brand size-5" />
          <div className="flex-1">
            <p className="font-medium">Job match</p>
            <p className="text-muted-foreground text-sm">Requirement-by-requirement comparison with a job description.</p>
          </div>
          <ArrowRight className="text-muted-foreground size-4" />
        </Link>
      </div>
    </PageContainer>
  );
}
