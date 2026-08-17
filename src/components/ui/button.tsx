import * as React from 'react'
import { cn } from '@/lib/utils'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'ghost' | 'destructive' | 'outline'
  size?: 'sm' | 'default' | 'lg' | 'icon'
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
          {
            'bg-primary text-primary-foreground shadow-md hover:bg-primary/90 hover:shadow-lg': variant === 'default',
            'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80': variant === 'secondary',
            'hover:bg-accent hover:text-accent-foreground': variant === 'ghost',
            'bg-destructive text-destructive-foreground shadow-md hover:bg-destructive/90 hover:shadow-lg': variant === 'destructive',
            'border border-input bg-background shadow-md hover:bg-accent hover:text-accent-foreground hover:shadow-lg': variant === 'outline',
          },
          {
            'h-8 px-3 text-xs': size === 'sm',
            'h-9 px-4 py-2': size === 'default',
            'h-10 px-8': size === 'lg',
            'h-9 w-9': size === 'icon',
          },
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button }
