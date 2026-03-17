import {
  type LucideIcon,
  Settings,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  House,
  LandPlot,
  UsersRound,
} from "lucide-react";
import { useUIStore, type AppTab } from "../stores/ui-store";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { SidebarAccountEntry } from "./SidebarAccountEntry";

const tabs: { id: AppTab; icon: LucideIcon; label: string }[] = [
  { id: "runtime", icon: House, label: "Home" },
  { id: "layout", icon: LandPlot, label: "Placement" },
  { id: "characters", icon: UsersRound, label: "Characters" },
  { id: "generate", icon: Sparkles, label: "Generate" },
];

export function Sidebar(): JSX.Element {
  const activeTab = useUIStore((s) => s.activeTab);
  const sidebarExpanded = useUIStore((s) => s.sidebarExpanded);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  return (
    <div
      className={cn(
        "h-full flex flex-col bg-background border-r border-border transition-all duration-200 ease-in-out",
        sidebarExpanded ? "w-[180px]" : "w-[48px]",
      )}
    >
      <div className="flex flex-col gap-1 p-1">
        <Button
          variant="ghost"
          className={cn("justify-start gap-2 px-3")}
          onClick={toggleSidebar}
          title={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          {sidebarExpanded ? (
            <ChevronLeft className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0" />
          )}
          {sidebarExpanded && <span className="truncate">Collapse</span>}
        </Button>
        {tabs.map(({ id, icon: Icon, label }) => (
          <Button
            key={id}
            variant="ghost"
            className={cn(
              "justify-start gap-2 px-3",
              activeTab === id && "bg-accent",
            )}
            onClick={() => setActiveTab(id)}
            title={label}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {sidebarExpanded && <span className="truncate">{label}</span>}
          </Button>
        ))}
      </div>

      <div className="mt-auto flex flex-col gap-1 p-1">
        <Button
          variant="ghost"
          className={cn(
            "justify-start gap-2 px-3",
            activeTab === "settings" && "bg-accent",
          )}
          onClick={() => setActiveTab("settings")}
          title="Settings"
        >
          <Settings className="h-4 w-4 shrink-0" />
          {sidebarExpanded && <span className="truncate">Settings</span>}
        </Button>
        <SidebarAccountEntry expanded={sidebarExpanded} />
      </div>
    </div>
  );
}
