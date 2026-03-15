import { Zap, Users, LayoutGrid, Settings, Sparkles, ChevronLeft, ChevronRight } from 'lucide-react'
import { useUIStore, type AppTab } from '../stores/ui-store'
import { Button } from './ui/button'
import { cn } from '../lib/utils'

const tabs: { id: AppTab; icon: typeof Zap; label: string }[] = [
  { id: 'runtime', icon: Zap, label: 'Runtime' },
  { id: 'layout', icon: LayoutGrid, label: 'Placement' },
  { id: 'generate', icon: Sparkles, label: 'Generate' },
  { id: 'characters', icon: Users, label: 'Characters' },
  { id: 'settings', icon: Settings, label: 'Settings' },
]

export function Sidebar(): JSX.Element {
  const activeTab = useUIStore((s) => s.activeTab)
  const sidebarExpanded = useUIStore((s) => s.sidebarExpanded)
  const setActiveTab = useUIStore((s) => s.setActiveTab)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)

  return (
    <div
      className={cn(
        'h-full flex flex-col bg-background border-r border-border transition-all duration-200 ease-in-out',
        sidebarExpanded ? 'w-[180px]' : 'w-[48px]'
      )}
    >
      <div className="flex flex-col gap-1 p-1">
        {tabs.map(({ id, icon: Icon, label }) => (
          <Button
            key={id}
            variant="ghost"
            className={cn(
              'justify-start gap-2 px-3',
              activeTab === id && 'bg-accent',
              !sidebarExpanded && 'justify-center px-0'
            )}
            onClick={() => setActiveTab(id)}
            title={label}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {sidebarExpanded && <span className="truncate">{label}</span>}
          </Button>
        ))}
      </div>

      <div className="mt-auto p-1">
        <Button
          variant="ghost"
          className={cn('w-full', sidebarExpanded ? 'justify-start px-3' : 'justify-center px-0')}
          onClick={toggleSidebar}
          title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {sidebarExpanded ? (
            <ChevronLeft className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0" />
          )}
        </Button>
      </div>
    </div>
  )
}
