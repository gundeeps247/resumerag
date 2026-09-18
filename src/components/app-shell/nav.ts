import {
  ClipboardList,
  FlaskConical,
  Gauge,
  House,
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
  label?: string;
  items: NavItem[];
  /** Collapsed by default: useful but not part of the main flow. */
  collapsible?: boolean;
}

/**
 * The app has two features that matter to a user preparing for an interview — asking questions
 * about their documents, and practising answers — plus the documents they rest on. Everything
 * else is a specialised tool or an engineering view, so it sits in a secondary group instead of
 * competing for attention.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { title: "Home", href: "/dashboard", icon: House, description: "Where to start" },
      { title: "Documents", href: "/documents", icon: Library, description: "Upload and inspect documents" },
      { title: "Ask", href: "/ask", icon: MessagesSquare, description: "Grounded answers with citations" },
      { title: "Practise", href: "/mock", icon: UsersRound, description: "Mock interview with feedback" },
    ],
  },
  {
    label: "More tools",
    items: [
      { title: "Prep tools", href: "/prep", icon: ClipboardList, description: "Resume X-ray, projects, questions, STAR" },
      { title: "Job match", href: "/jd", icon: Target, description: "Compare yourself with a job description" },
    ],
  },
  {
    label: "Under the hood",
    collapsible: true,
    items: [
      { title: "Retrieval playground", href: "/lab", icon: FlaskConical, description: "Experiment with retrieval" },
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
