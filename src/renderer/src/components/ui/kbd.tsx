import * as React from 'react'
import { cn } from '../../lib/utils'

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {}

const Kbd = React.forwardRef<HTMLElement, KbdProps>(({ className, ...props }, ref) => (
  <kbd
    ref={ref}
    className={cn(
      'inline-flex min-h-5 min-w-5 items-center justify-center rounded border border-border bg-background px-1.5 text-[10px] font-medium text-muted-foreground shadow-sm',
      className
    )}
    {...props}
  />
))

Kbd.displayName = 'Kbd'

export { Kbd }
