"use client"
// Open Backup UI v1.3.0

import * as React from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { OpenBackupLogo } from "@/components/brand/open-backup-logo"
import { BookOpen, ChevronDown, Briefcase, Server, Shield, ShieldCheck, LayoutDashboard, Database, FileKey, Palette, Blocks, UserRoundCog, Building2, Bell, FileText, Star, ShieldAlert, Activity, Sparkles, Network, Aperture, Menu, X, Settings, ArrowLeft, ArrowDownCircle, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import styles from "./mobile-navigation.module.css"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import { ChevronRight, RotateCcw } from "lucide-react"
import { defaultSectionNames, useSectionNames } from "@/lib/context/section-names-context"
import { useI18n } from "@/components/providers/i18n-provider"
import { lenses, lensForPath } from "@/lib/lens/navigation"
import { navigationLabels } from "@/lib/navigation/breadcrumbs"
import type { Platform } from "@/lib/data-sources/model"
import { isSettingsPath, settingsReturnPath } from "@/lib/navigation/settings"
import { isProtectedDataPath } from "@/lib/protected-data/navigation"

// VBR Group with subpages
const vbrItems = [
  {
    title: navigationLabels["/vbr/topology"],
    href: "/vbr/topology",
    icon: Network,
  },
  {
    title: navigationLabels["/vbr/threat-center"],
    href: "/vbr/threat-center",
    icon: ShieldAlert,
  },
  {
    title: navigationLabels["/vbr/jobs"],
    href: "/vbr/jobs",
    icon: Briefcase,
  },
  {
    title: navigationLabels["/vbr/protected-data"],
    href: "/vbr/protected-data",
    icon: Shield,
  },
  {
    title: "Inventory",
    icon: Database,
    items: [
      {
        title: navigationLabels["/vbr/inventory/virtual"],
        href: "/vbr/inventory/virtual",
      },
      {
        title: navigationLabels["/vbr/inventory/protection-groups"],
        href: "/vbr/inventory/protection-groups",
      },
      {
        title: navigationLabels["/vbr/inventory/unstructured"],
        href: "/vbr/inventory/unstructured",
      },
      {
        title: navigationLabels["/vbr/inventory/entra"],
        href: "/vbr/inventory/entra",
      },
    ]
  },
  {
    title: "Backup Infrastructure",
    href: "/vbr/infrastructure", // This will likely redirect or we can handle it
    icon: Server,
    items: [
      {
        title: navigationLabels["/vbr/infrastructure/proxies"],
        href: "/vbr/infrastructure/proxies",
      },
      {
        title: navigationLabels["/vbr/infrastructure/repositories"],
        href: "/vbr/infrastructure/repositories",
      },
      {
        title: navigationLabels["/vbr/infrastructure/managed-servers"],
        href: "/vbr/infrastructure/managed-servers",
      },
    ]
  },
  { title: navigationLabels["/vbr/recovery-center"], href: "/vbr/recovery-center", icon: RotateCcw },
  { title: navigationLabels["/vbr/activity"], href: "/vbr/activity", icon: Activity },
]

// VBM Group - Veeam Backup for M365
const vbmItems = [
  {
    title: navigationLabels["/vbm/dashboard"],
    href: "/vbm/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: navigationLabels["/vbm/jobs"],
    href: "/vbm/jobs",
    icon: Briefcase,
  },
  {
    title: navigationLabels["/vbm/protected-items"],
    href: "/vbm/protected-items",
    icon: Shield,
  },
  {
    title: navigationLabels["/vbm/organizations"],
    href: "/vbm/organizations",
    icon: Building2,
  },
  {
    title: "Backup Infrastructure",
    href: "/vbm/infrastructure",
    icon: Server,
    items: [
      {
        title: navigationLabels["/vbm/infrastructure/proxies"],
        href: "/vbm/infrastructure/proxies",
      },
      {
        title: navigationLabels["/vbm/infrastructure/repositories"],
        href: "/vbm/infrastructure/repositories",
      },
    ]
  },
  { title: navigationLabels["/vbm/recovery-center"], href: "/vbm/recovery-center", icon: RotateCcw },
]

// VRO Group - Veeam Recovery Orchestrator
const vroItems = [
  {
    title: navigationLabels["/vro"],
    href: "/vro",
    icon: ShieldCheck,
  },
]

// K10 Group - single page
const k10Items = [
  {
    title: navigationLabels["/k10"],
    href: "/k10",
    icon: ShieldCheck,
    badge: "Coming",
  },
]

// Analytics Group - Veeam ONE
const analyticsItems = [
  {
    title: navigationLabels["/analytics/threat-center"],
    href: "/analytics/threat-center",
    icon: ShieldAlert,
  },
  {
    title: navigationLabels["/analytics/alarms"],
    href: "/analytics/alarms",
    icon: Bell,
  },
  {
    title: navigationLabels["/analytics/dashboards"],
    href: "/analytics/dashboards",
    icon: LayoutDashboard,
  },
  {
    title: navigationLabels["/analytics/reports"],
    href: "/analytics/reports",
    icon: FileText,
  },
  {
    title: navigationLabels["/analytics/saved-reports"],
    href: "/analytics/saved-reports",
    icon: Star,
  },
]

const documentationItems = [
  {
    title: "Veeam Backup & Replication",
    href: "https://helpcenter.veeam.com/docs/backup/vsphere/overview.html",
  },
  {
    title: "Veeam Recovery Orchestrator",
    href: "https://helpcenter.veeam.com/docs/vro/userguide/overview.html",
  },
  {
    title: "Veeam Backup for M365",
    href: "https://helpcenter.veeam.com/docs/vbo365/guide/vbo_introduction.html",
  },
  {
    title: "Kasten K10",
    href: "https://docs.kasten.io/",
  },
]

const settingsItems = [
  { title: "General", href: "/settings", icon: Settings },
  { title: "Data Sources", href: "/settings/data-sources", icon: Blocks },
  { title: "Licensing", href: "/settings/licensing", icon: FileKey },
  { title: "Branding", href: "/settings/branding", icon: Palette },
  { title: "AI Integrations", href: "/settings/ai-settings", icon: Sparkles },
  { title: "Telemetry", href: "/settings/telemetry", icon: Activity },
  { title: "Updates", href: "/settings/updates", icon: ArrowDownCircle },
]
const identityItems = [
  { title: "Users", href: "/settings/identity/users", icon: Users },
  { title: "Roles", href: "/settings/identity/roles", icon: UserRoundCog },
]

function SettingsMenuGroup({ label, items, pathname }: { label: string; items: typeof settingsItems; pathname: string }) {
  const { t } = useI18n()
  return <SidebarGroup>
    <SidebarGroupLabel>{label}</SidebarGroupLabel>
    <SidebarGroupContent>
      <SidebarMenu>
        {items.map(item => <SidebarMenuItem key={item.href}>
          <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={t(item.title)}>
            <Link href={item.href} aria-label={t(item.title)} aria-current={pathname === item.href ? "page" : undefined}>
              <item.icon /><span>{t(item.title)}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>)}
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
}

function WorkspaceGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <SidebarGroup role="group" aria-label={label}>
    <SidebarGroupLabel className="min-w-0 shrink group-data-[collapsible=icon]:opacity-100 group-data-[collapsible=icon]:mt-0">
      <span className="truncate group-data-[collapsible=icon]:hidden">{label}</span>
      <span aria-hidden="true" className="hidden group-data-[collapsible=icon]:block font-bold">&mdash;</span>
    </SidebarGroupLabel>
    <SidebarGroupContent>{children}</SidebarGroupContent>
  </SidebarGroup>
}

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  labsEnabled?: boolean
  configuredPlatforms: readonly Platform[]
}

export function AppSidebar({
  labsEnabled = false,
  configuredPlatforms,
  ...props
}: AppSidebarProps) {
  const pathname = usePathname()
  const { t } = useI18n()
  const { toggleSidebar, isMobile, openMobile, setOpenMobile, state } = useSidebar()
  const mobileTrigger = React.useRef<HTMLButtonElement>(null)
  const mobileNavigationId = React.useId()
  const { sectionNames } = useSectionNames()
  const sectionLabel = (key: keyof typeof sectionNames) => sectionNames[key] === defaultSectionNames[key] ? t(sectionNames[key]) : sectionNames[key]
  // State for collapsible sub-menus in VBR
  const [inventoryOpen, setInventoryOpen] = React.useState(false)
  const [infrastructureOpen, setInfrastructureOpen] = React.useState(false)
  const jobsActive = pathname === '/vbr/jobs' || pathname.startsWith('/vbr/jobs/') || pathname.startsWith('/vbr/sessions/')
  const [jobsOpen, setJobsOpen] = React.useState(jobsActive)
  React.useEffect(() => { if (jobsActive) setJobsOpen(true) }, [jobsActive, pathname])
  const activeLens = lensForPath(pathname)
  const [lensOpen, setLensOpen] = React.useState(!!activeLens)
  React.useEffect(() => { if (activeLens) setLensOpen(true) }, [activeLens])
  React.useEffect(() => { setOpenMobile(false) }, [pathname, setOpenMobile])

  function closeMobileMenu(event: React.KeyboardEvent) {
    if (isMobile && openMobile && event.key === "Escape") {
      event.preventDefault()
      setOpenMobile(false)
      mobileTrigger.current?.focus()
    }
  }

  const inSettings = isSettingsPath(pathname)
  const [exitHref, setExitHref] = React.useState("/dashboard")
  const lastWorkspace = React.useRef<string | null>(null)
  React.useEffect(() => {
    const storageKey = "open-backup-ui.settings-return"
    if (inSettings) {
      let previous = lastWorkspace.current
      try { previous ??= sessionStorage.getItem(storageKey) } catch { /* Storage can be disabled. */ }
      setExitHref(settingsReturnPath(previous))
      return
    }
    function rememberWorkspace() {
      const { pathname, search, hash } = window.location
      const href = settingsReturnPath(pathname + search + hash)
      lastWorkspace.current = href
      try { sessionStorage.setItem(storageKey, href) } catch { /* The in-memory path still works. */ }
    }
    // Capture the current query and fragment when entering from any in-app link.
    function rememberBeforeNavigation(event: MouseEvent) {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null
      if (link instanceof HTMLAnchorElement && link.origin === location.origin && isSettingsPath(link.pathname)) rememberWorkspace()
    }
    rememberWorkspace()
    document.addEventListener("click", rememberBeforeNavigation, true)
    return () => document.removeEventListener("click", rememberBeforeNavigation, true)
  }, [inSettings, pathname])

  return (
    <>
    <div className={styles.header} onKeyDown={closeMobileMenu}>
      <Button ref={mobileTrigger} variant="ghost" className={styles.trigger}
        aria-label={t(openMobile ? "Close main menu" : "Open main menu")}
        aria-expanded={openMobile} aria-controls={mobileNavigationId}
        onClick={() => setOpenMobile(!openMobile)}>
        {openMobile ? <X size={20} /> : <Menu size={20} />}<span>{t("Menu")}</span>
      </Button>
      <div className={styles.brand}><OpenBackupLogo /></div>
    </div>
    {isMobile && !openMobile && !inSettings && (
      <Link className={styles.mobileSettings} href="/settings" aria-label={t("Settings")} title={t("Settings")}><Settings size={20} /></Link>
    )}
    <Sidebar collapsible="icon" {...props} id={mobileNavigationId} className={[styles.navigation, props.className].filter(Boolean).join(" ")}
      role={isMobile ? "navigation" : undefined} aria-label={isMobile ? t("Main navigation") : undefined}
      onKeyDown={closeMobileMenu}
      onClick={event => {
        if (isMobile && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && (event.target as HTMLElement).closest('a[href]')) setOpenMobile(false)
      }}>
      <SidebarHeader className="hidden md:flex">
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2">
            <button
              type="button"
              className={styles.brandButton}
              data-compact={state === "collapsed"}
              aria-label={`Open Backup UI · ${t("Toggle Sidebar")}`}
              aria-expanded={state === "expanded"}
              title="Open Backup UI"
              onClick={toggleSidebar}
            >
              <OpenBackupLogo compact={state === "collapsed"} />
            </button>
            <SidebarTrigger className="group-data-[collapsible=icon]:hidden text-sidebar-foreground" />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      {inSettings && <SidebarHeader className="shrink-0 border-b border-sidebar-border">
        <SidebarMenu><SidebarMenuItem>
          <SidebarMenuButton asChild tooltip={t("Exit settings")}>
            <Link href={exitHref} prefetch={false} aria-label={t("Exit settings")}><ArrowLeft /><span>{t("Exit settings")}</span></Link>
          </SidebarMenuButton>
        </SidebarMenuItem></SidebarMenu>
      </SidebarHeader>}
      <SidebarContent>
        {inSettings ? <>
          <SettingsMenuGroup label={sectionNames.administration === defaultSectionNames.administration ? t("Settings") : sectionNames.administration} items={settingsItems} pathname={pathname} />
          {configuredPlatforms.includes("vbr") && <SettingsMenuGroup label={t("Identity")} items={identityItems} pathname={pathname} />}
        </> : <>
        {labsEnabled && <SidebarGroup><SidebarGroupContent><SidebarMenu><SidebarMenuItem><SidebarMenuButton asChild isActive={pathname === '/labs'} tooltip={t('Kiosk Builder')}><Link href="/labs"><Sparkles size={16} /><span>{t('Kiosk Builder')}</span></Link></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarGroupContent></SidebarGroup>}
        {configuredPlatforms.length === 0 && <SidebarGroup>
          <SidebarMenu><SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t("Data Sources")}>
              <Link href="/settings/data-sources" aria-label={t("Data Sources")}><Blocks /><span>{t("Data Sources")}</span></Link>
            </SidebarMenuButton>
          </SidebarMenuItem></SidebarMenu>
        </SidebarGroup>}
        {/* Veeam Backup & Replication Group */}
        {configuredPlatforms.includes("vbr") && <WorkspaceGroup label={sectionLabel('vbr')}>
          <SidebarMenu>
            <SidebarMenuItem>
              <div className="relative flex items-center">
                <SidebarMenuButton asChild isActive={!!activeLens || pathname === '/vbr/lens'} tooltip={t("Protection Lens")} className="pr-8 group-data-[collapsible=icon]:pr-2">
                  <Link href="/vbr/lens" prefetch={false}><Aperture className="h-4 w-4"/><span>{t("Protection Lens")}</span></Link>
                </SidebarMenuButton>
                <button type="button" className="absolute right-1 rounded p-1 text-sidebar-foreground hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden" aria-label={t(lensOpen ? 'Collapse {section}' : 'Expand {section}', { section: t('Protection Lens') })} aria-expanded={lensOpen} aria-controls="sidebar-protection-lens" onClick={() => setLensOpen(!lensOpen)}><ChevronDown className={`h-4 w-4 transition-transform ${lensOpen ? '' : '-rotate-90'}`}/></button>
              </div>
              {lensOpen && <SidebarMenuSub id="sidebar-protection-lens">{lenses.map(lens => <SidebarMenuSubItem key={lens.id}><SidebarMenuSubButton asChild isActive={activeLens === lens.id}><Link href={lens.href} aria-current={activeLens === lens.id ? 'page' : undefined}>{t(lens.title)}</Link></SidebarMenuSubButton></SidebarMenuSubItem>)}</SidebarMenuSub>}
            </SidebarMenuItem>
            {vbrItems.map((item) => {
              if (item.href === '/vbr/jobs') {
                const profilesActive = pathname === '/vbr/jobs/profiles'
                return <SidebarMenuItem key={item.title}>
                  <div className="relative flex items-center">
                    <SidebarMenuButton asChild isActive={jobsActive} tooltip={t(item.title)} className="pr-8 group-data-[collapsible=icon]:pr-2">
                      <Link href={item.href} aria-current={jobsActive ? pathname === item.href ? 'page' : 'location' : undefined}><Briefcase className="h-4 w-4"/><span>{t(item.title)}</span></Link>
                    </SidebarMenuButton>
                    <button type="button" className="absolute right-1 rounded p-1 text-sidebar-foreground hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden" aria-label={t(jobsOpen ? 'Collapse {section}' : 'Expand {section}', { section: t('Jobs & Policies') })} aria-expanded={jobsOpen} aria-controls="sidebar-jobs-policies" onClick={() => setJobsOpen(!jobsOpen)}><ChevronDown className={`h-4 w-4 transition-transform ${jobsOpen ? '' : '-rotate-90'}`}/></button>
                  </div>
                  {jobsOpen && <SidebarMenuSub id="sidebar-jobs-policies"><SidebarMenuSubItem><SidebarMenuSubButton asChild isActive={profilesActive}><Link href="/vbr/jobs/profiles" aria-current={profilesActive ? 'page' : undefined}>{t(navigationLabels['/vbr/jobs/profiles'])}</Link></SidebarMenuSubButton></SidebarMenuSubItem></SidebarMenuSub>}
                </SidebarMenuItem>
              }
              // Determine if this item is a sub-menu (like Inventory)
              const isSubMenu = !!item.items
              // Determine state for this item
              const isOpen = item.title === "Inventory" ? inventoryOpen : item.title === "Backup Infrastructure" ? infrastructureOpen : false
              const setOpen = item.title === "Inventory" ? setInventoryOpen : item.title === "Backup Infrastructure" ? setInfrastructureOpen : () => { }

              if (isSubMenu && item.items) {
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      onClick={() => setOpen(!isOpen)}
                      tooltip={t(item.title)}
                      isActive={item.items.some(sub => pathname === sub.href)}
                    >
                      {item.icon && <item.icon className="h-4 w-4" />}
                      <span>{t(item.title)}</span>
                      <ChevronDown className={`ml-auto h-4 w-4 transition-transform ${isOpen ? "rotate-0" : "-rotate-90"}`} />
                    </SidebarMenuButton>
                    {isOpen && (
                      <SidebarMenuSub>
                        {item.items.map((subItem) => (
                          <SidebarMenuSubItem key={subItem.href}>
                            <SidebarMenuSubButton asChild isActive={pathname === subItem.href}>
                              <Link href={subItem.href}>
                                <span>{t(subItem.title)}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                )
              }

              // Standard Item
              const isActive = item.href === '/vbr/protected-data' ? isProtectedDataPath(pathname)
                : item.href === '/vbr/activity' || item.href === '/vbr/recovery-center' ? pathname === item.href || pathname.startsWith(item.href + '/')
                : item.href === '/vbr/jobs' ? pathname === item.href || pathname.startsWith('/vbr/jobs/') || pathname.startsWith('/vbr/sessions/') : pathname === item.href
              return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive} tooltip={t(item.title)}>
                    <Link href={item.href!} aria-current={isActive ? pathname === item.href ? 'page' : 'location' : undefined}>
                      {item.icon && <item.icon className="h-4 w-4" />}
                      <span>{t(item.title)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </WorkspaceGroup>}

        {/* Veeam Backup for M365 Group */}
        {configuredPlatforms.includes("vb365") && <WorkspaceGroup label={sectionLabel('vbm')}>
          <SidebarMenu>
            {vbmItems.map((item) => {
              // Collapsible Item with children
              if (item.items && item.items.length > 0) {
                const isItemActive = pathname.startsWith(item.href || "")
                return (
                  <SidebarMenuItem key={item.title}>
                    <Collapsible defaultOpen={isItemActive} className="group/collapsible">
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton tooltip={t(item.title)}>
                          {item.icon && <item.icon className="h-4 w-4" />}
                          <span>{t(item.title)}</span>
                          <ChevronRight className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      {item.items && (
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {item.items.map((subItem) => (
                              <SidebarMenuSubItem key={subItem.title}>
                                <SidebarMenuSubButton asChild isActive={pathname === subItem.href}>
                                  <Link href={subItem.href}>{t(subItem.title)}</Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      )}
                    </Collapsible>
                  </SidebarMenuItem>
                )
              }

              // Standard Item
              return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={t(item.title)}>
                    <Link href={item.href}>
                      {item.icon && <item.icon className="h-4 w-4" />}
                      <span>{t(item.title)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </WorkspaceGroup>}

        {/* Veeam Recovery Orchestrator Group */}
        {configuredPlatforms.includes("vro") && <WorkspaceGroup label={sectionLabel('vro')}>
          <SidebarMenu>
            {vroItems.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={t(item.title)}>
                  <Link href={item.href}>
                    {item.icon && <item.icon className="h-4 w-4" />}
                    <span>{t(item.title)}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </WorkspaceGroup>}

        {/* Analytics Group */}
        {configuredPlatforms.includes("one") && <WorkspaceGroup label={sectionLabel('analytics')}>
          <SidebarMenu>
            {analyticsItems.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={t(item.title)}>
                  <Link href={item.href}>
                    {item.icon && <item.icon className="h-4 w-4" />}
                    <span>{t(item.title)}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </WorkspaceGroup>}

        {/* Kasten K10 Group */}
        {configuredPlatforms.includes("kasten") && <WorkspaceGroup label={sectionLabel('k10')}>
          <SidebarMenu>
            {k10Items.map((item) => (
              <SidebarMenuItem key={item.title} className="flex min-w-0 items-center gap-1 pr-1">
                <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={t(item.title)} className="min-w-0 flex-1">
                  <Link href={item.href}>
                    {item.icon && <item.icon className="h-4 w-4" />}
                    <span className="truncate">{t(item.title)}</span>
                  </Link>
                </SidebarMenuButton>
                {item.badge && (
                  <SidebarMenuBadge className="static shrink-0 whitespace-nowrap opacity-50">
                    {t(item.badge)}
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </WorkspaceGroup>}

        {/* Documentation Group */}
        <WorkspaceGroup label={sectionLabel('documentation')}>
          <SidebarMenu>
            {documentationItems.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild>
                  <a href={item.href} target="_blank" rel="noopener noreferrer">
                    <BookOpen className="h-4 w-4" />
                    <span>{t(item.title)}</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </WorkspaceGroup>
        </>}
      </SidebarContent>
      <SidebarFooter className="shrink-0 border-t border-border">
        {!inSettings && (!isMobile || openMobile) && <SidebarMenu><SidebarMenuItem>
          <SidebarMenuButton asChild tooltip={t("Settings")}>
            <Link href="/settings" aria-label={t("Settings")}><Settings /><span>{t("Settings")}</span></Link>
          </SidebarMenuButton>
        </SidebarMenuItem></SidebarMenu>}
        <div className="flex justify-center text-sm text-muted-foreground">
          <span className="group-data-[collapsible=icon]:hidden">{t("Crafted with")} </span>
          <span className="text-red-500">❤️</span>
          <span className="group-data-[collapsible=icon]:hidden"> {t("for the Community")}</span>
        </div>
      </SidebarFooter>
    </Sidebar>
    </>
  )
}
