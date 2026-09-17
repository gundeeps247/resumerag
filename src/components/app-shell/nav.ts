import {
  ClipboardList,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  Library,
  MessagesSquare,
  Settings,
  Target,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  description: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, description: "Readiness overview" },
      { title: "Knowledge base", href: "/documents", icon: Library, description: "Upload and inspect documents" },
      { title: "Ask", href: "/ask", icon: MessagesSquare, description: "Grounded Q&A with citations" },
    ],
  },
  {
    label: "Interview prep",
    items: [
      { title: "Prep studio", href: "/prep", icon: ClipboardList, description: "Resume X-ray, deep dives, STAR" },
      { title: "Mock interview", href: "/mock", icon: UsersRound, description: "Practice with feedback" },
      { title: "JD match", href: "/jd", icon: Target, description: "Compare against a job description" },
    ],
  },
  {
    label: "RAG lab",
    items: [
      { title: "Playground", href: "/lab", icon: FlaskConical, description: "Experiment with retrieval" },
      { title: "Evaluation", href: "/evaluation", icon: Gauge, description: "Measure retrieval quality" },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = {
  title: "Settings",
  href: "/settings",
  icon: Settings,
  description: "Models, retrieval and privacy",
};

export function findNavItem(pathname: string): NavItem | undefined {
  const all = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];
  return all.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}
