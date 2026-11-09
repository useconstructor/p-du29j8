"use client"

import { useTheme } from "next-themes"
import { Switch } from "@/components/ui/switch"
import { Moon, Sun } from "lucide-react"
import { useSyncExternalStore } from "react"

const subscribe = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot)

  if (!mounted) return null

  const isDark = theme === "dark"

  return (
    <div className="flex items-center gap-2">
      <Sun className="h-4 w-4 text-muted-foreground" />
      <Switch
        checked={isDark}
        onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
        aria-label="Toggle dark mode"
      />
      <Moon className="h-4 w-4 text-muted-foreground" />
    </div>
  )
}
