import { useThemeStore, themes } from '@/stores/themeStore'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ThemeSettings() {
  const currentThemeId = useThemeStore((s) => s.currentThemeId)
  const setTheme = useThemeStore((s) => s.setTheme)

  return (
    <div className="space-y-3 px-1 py-2">
      <div className="text-xs text-muted-foreground">
        点击预设即可实时切换主题外观。
      </div>
      <div className="grid grid-cols-2 gap-3">
        {themes.map((t) => {
          const isActive = t.id === currentThemeId
          // Build a CSS linear-gradient string for the preview swatch
          const preview = `linear-gradient(135deg, hsl(${t.tokens['--canvas-bg-from']}) 0%, hsl(${t.tokens['--canvas-bg-via']}) 45%, hsl(${t.tokens['--canvas-bg-to']}) 100%)`
          return (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={cn(
                'group relative flex flex-col items-stretch rounded-lg border text-left transition-all overflow-hidden',
                isActive
                  ? 'border-primary ring-2 ring-primary/30'
                  : 'border-border hover:border-foreground/30'
              )}
            >
              <div
                className="h-20 w-full relative"
                style={{ background: preview }}
              >
                {/* Mock floating card on top of swatch so user can preview the glass effect */}
                <div
                  className="absolute top-2 left-2 right-2 h-4 rounded-md border"
                  style={{
                    background: `hsl(${t.tokens['--surface-floating']} / 0.72)`,
                    borderColor: `hsl(${t.tokens['--glass-border-strong']} / 0.7)`,
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                  }}
                />
                {isActive && (
                  <div className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                    <Check className="h-3 w-3" />
                  </div>
                )}
              </div>
              <div className="p-2.5 bg-background">
                <div className="text-sm font-medium">{t.name}</div>
                {t.description && (
                  <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                    {t.description}
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
