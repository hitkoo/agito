import * as React from 'react'
import type { InputProps } from './input'
import { Input } from './input'
import { cn } from '../../lib/utils'

const InputGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex h-10 w-full items-center rounded-md border border-input bg-background ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
        className
      )}
      {...props}
    />
  )
)
InputGroup.displayName = 'InputGroup'

const InputGroupInput = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <Input
      ref={ref}
      className={cn(
        'h-full flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
        className
      )}
      {...props}
    />
  )
)
InputGroupInput.displayName = 'InputGroupInput'

const InputGroupAddon = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex h-full items-center pr-3 text-muted-foreground', className)}
      {...props}
    />
  )
)
InputGroupAddon.displayName = 'InputGroupAddon'

export { InputGroup, InputGroupInput, InputGroupAddon }
