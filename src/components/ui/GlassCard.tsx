import { type HTMLAttributes, type ReactNode, forwardRef } from 'react'
import { cn } from '@/lib/utils'

export type GlassVariant = 'strong' | 'soft' | 'topbar'

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: GlassVariant
  hoverLift?: boolean
  popIn?: boolean
  as?: 'div' | 'section' | 'aside' | 'header' | 'nav'
  children?: ReactNode
}

const variantClass: Record<GlassVariant, string> = {
  strong: 'floating-glass',
  soft: 'floating-glass-soft',
  topbar: 'floating-glass-topbar',
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ variant = 'strong', hoverLift = false, popIn = false, as = 'div', className, children, ...rest }, ref) => {
    const Tag = as as any
    return (
      <Tag
        ref={ref}
        className={cn(
          variantClass[variant],
          hoverLift && 'hover-lift',
          popIn && 'glass-pop-in',
          className
        )}
        {...rest}
      >
        {children}
      </Tag>
    )
  }
)

GlassCard.displayName = 'GlassCard'
