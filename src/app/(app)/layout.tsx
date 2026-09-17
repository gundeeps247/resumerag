import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { RagBridge } from "@/components/app-shell/rag-bridge";
import { Topbar } from "@/components/app-shell/topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <Topbar />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
      <RagBridge />
    </SidebarProvider>
  );
}
