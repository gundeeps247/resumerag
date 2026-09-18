"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, HardDrive } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useKbStats } from "@/hooks/use-kb";
import { cn } from "@/lib/utils";
import { NAV_GROUPS, SETTINGS_ITEM } from "./nav";

export function AppSidebar() {
  const pathname = usePathname();
  const stats = useKbStats();
  const { setOpenMobile } = useSidebar();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="px-3 pt-4 pb-2">
        <Link
          href="/"
          className="focus-visible:ring-ring rounded-md outline-none focus-visible:ring-2 group-data-[collapsible=icon]:[&_.grid]:hidden"
        >
          <Logo />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group, i) => {
          const open = openGroups[group.label ?? ""] ?? !group.collapsible;
          const items = (
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.title}>
                    <Link href={item.href} onClick={() => setOpenMobile(false)}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.href === "/documents" && stats && stats.documents > 0 && (
                    <SidebarMenuBadge className="tabular-nums">{stats.documents}</SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          );
          return (
            <SidebarGroup key={group.label ?? i}>
              {group.label &&
                (group.collapsible ? (
                  // Engineering views stay one click away without cluttering the main flow.
                  <SidebarGroupLabel
                    asChild
                    className="hover:text-foreground cursor-pointer group-data-[collapsible=icon]:hidden"
                    onClick={() => setOpenGroups((g) => ({ ...g, [group.label as string]: !open }))}
                  >
                    <button type="button" aria-expanded={open}>
                      <ChevronRight className={cn("mr-1 size-3 transition-transform", open && "rotate-90")} />
                      {group.label}
                    </button>
                  </SidebarGroupLabel>
                ) : (
                  <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                ))}
              <SidebarGroupContent className={cn(group.collapsible && !open && "hidden group-data-[collapsible=icon]:block")}>
                {items}
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="gap-2 pb-3">
        <div className="border-sidebar-border bg-background/60 text-muted-foreground mx-2 flex items-start gap-2 rounded-lg border p-2.5 text-[11px] leading-snug group-data-[collapsible=icon]:hidden">
          <HardDrive className="text-brand mt-0.5 size-3.5 shrink-0" />
          <span>
            <span className="text-foreground font-medium">Local-first.</span> Documents and vectors stay in this browser.
          </span>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isActive(SETTINGS_ITEM.href)} tooltip={SETTINGS_ITEM.title}>
              <Link href={SETTINGS_ITEM.href} onClick={() => setOpenMobile(false)}>
                <SETTINGS_ITEM.icon />
                <span>{SETTINGS_ITEM.title}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
