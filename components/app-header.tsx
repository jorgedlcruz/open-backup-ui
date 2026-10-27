"use client"

import { GlobalSearch, type GlobalSearchProps } from "@/components/global-search"
import { ModeToggle } from "@/components/mode-toggle"

export function AppHeader(props: GlobalSearchProps) {
  return (
    <div data-slot="app-header" className="md:sticky top-0 z-40 bg-background border-b">
      <div className="flex items-center gap-3 px-3 py-3 md:gap-4 md:px-6">
        <div className="min-w-0 flex-1 max-w-md">
          <GlobalSearch {...props} />
        </div>
        <ModeToggle />
      </div>
    </div>
  )
}
