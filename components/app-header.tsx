"use client"
// Open Backup UI v1.2.0

import { GlobalSearch, type GlobalSearchProps } from "@/components/global-search"
import { ModeToggle } from "@/components/mode-toggle"
import Link from 'next/link'
import { FlaskConical } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useI18n } from '@/components/providers/i18n-provider'

export function AppHeader({ labsEnabled, ...props }: GlobalSearchProps & { labsEnabled?: boolean }) {
  const pathname = usePathname(), { t } = useI18n()
  return (
    <div data-slot="app-header" className="md:sticky top-0 z-40 bg-background border-b">
      <div className="flex items-center gap-3 px-3 py-3 md:gap-4 md:px-6">
        <div className="min-w-0 flex-1 max-w-md">
          <GlobalSearch {...props} />
        </div>
        <ModeToggle />
        {labsEnabled && <Link href="/labs" aria-current={pathname === '/labs' ? 'page' : undefined} className="ml-auto inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm hover:bg-accent"><FlaskConical size={16} />{t('Kiosk Builder')}<span className="hidden sm:inline text-[10px] tracking-widest opacity-60">BETA</span></Link>}
      </div>
    </div>
  )
}
