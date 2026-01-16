"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { BookOpen, ChevronDown, Briefcase, Server, Shield, ShieldCheck, LayoutDashboard, Database, FileKey, Palette, Blocks, UserRoundCog, Building2, Bell, FileText, Star, ShieldAlert } from "lucide-react"
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
import { ChevronRight } from "lucide-react"
import { useSectionNames } from "@/lib/context/section-names-context"

// VBR Group with subpages
const vbrItems = [
  {
    title: "Dashboard",
    href: "/vbr/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Jobs & Policies",
    href: "/vbr/jobs",
    icon: Briefcase,
  },
  {
    title: "Protected Data",
    href: "/vbr/protected-data",
    icon: Shield,
  },
  {
    title: "Inventory",
    icon: Database,
    items: [
      {
        title: "Virtual Infrastructure",
        href: "/vbr/inventory/virtual",
      },
      {
        title: "Physical and Cloud",
        href: "/vbr/inventory/protection-groups",
      },
      {
        title: "Unstructured Data",
        href: "/vbr/inventory/unstructured",
      },
      {
        title: "Microsoft Entra ID",
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
        title: "Backup Proxies",
        href: "/vbr/infrastructure/proxies",
      },
      {
        title: "Backup Repositories",
        href: "/vbr/infrastructure/repositories",
      },
      {
        title: "Managed Servers",
        href: "/vbr/infrastructure/managed-servers",
      },
    ]
  },
]

// VBM Group - Veeam Backup for M365
const vbmItems = [
  {
    title: "Dashboard",
    href: "/vbm/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Backup Jobs",
    href: "/vbm/jobs",
    icon: Briefcase,
  },
  {
    title: "Protected Objects",
    href: "/vbm/protected-items",
    icon: Shield,
  },
  {
    title: "Organizations",
    href: "/vbm/organizations",
    icon: Building2,
  },
  {
    title: "Backup Infrastructure",
    href: "/vbm/infrastructure",
    icon: Server,
    items: [
      {
        title: "Backup Proxies",
        href: "/vbm/infrastructure/proxies",
      },
      {
        title: "Backup Repositories",
        href: "/vbm/infrastructure/repositories",
      },
    ]
  },
]

// VRO Group - Veeam Recovery Orchestrator
const vroItems = [
  {
    title: "Recovery Plans",
    href: "/vro",
    icon: ShieldCheck,
  },
]

// K10 Group - single page
const k10Items = [
  {
    title: "Overview",
    href: "/k10",
    icon: ShieldCheck,
    badge: "Coming",
  },
]

// Analytics Group - Veeam ONE
const analyticsItems = [
  {
    title: "Threat Center",
    href: "/analytics/threat-center",
    icon: ShieldAlert,
  },
  {
    title: "Alarms Overview",
    href: "/analytics/alarms",
    icon: Bell,
  },
  {
    title: "Dashboards",
    href: "/analytics/dashboards",
    icon: LayoutDashboard,
  },
  {
    title: "Report Catalog",
    href: "/analytics/reports",
    icon: FileText,
  },
  {
    title: "Saved Reports",
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

// Administration Group
const adminItems = [
  {
    title: "Licensing",
    href: "/administration/licensing",
    icon: FileKey,
  },
  {
    title: "Data Sources",
    href: "/administration/data-sources",
    icon: Blocks,
  },
  {
    title: "Branding",
    href: "/administration/branding",
    icon: Palette,
  },
  {
    title: "Identity",
    icon: UserRoundCog,
    items: [
      {
        title: "Users",
        href: "/administration/identity/users",
      },
      {
        title: "Roles",
        href: "/administration/identity/roles",
      },
    ]
  },
]

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  vbrConfigured?: boolean
  vb365Configured?: boolean
  vroConfigured?: boolean
  veeamOneConfigured?: boolean
}

export function AppSidebar({
  vbrConfigured = true,
  vb365Configured = true,
  vroConfigured = true,
  veeamOneConfigured = true,
  ...props
}: AppSidebarProps) {
  const pathname = usePathname()
  const { toggleSidebar } = useSidebar()
  const { sectionNames } = useSectionNames()
  // State for collapsible sub-menus in VBR
  const [inventoryOpen, setInventoryOpen] = React.useState(false)
  const [infrastructureOpen, setInfrastructureOpen] = React.useState(false)

  // Filter admin items based on what's configured
  // Identity only shows when VBR is configured (uses VBR credentials API)
  const filteredAdminItems = adminItems.filter(item => {
    if (item.title === "Identity") return vbrConfigured
    return true
  })

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2">
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground flex-1"
              onClick={toggleSidebar}
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Image
                  src="/logo.webp"
                  alt="Veeam Single-UI"
                  width={24}
                  height={24}
                  className="size-4"
                />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Veeam Single-UI</span>
              </div>
            </SidebarMenuButton>
            <SidebarTrigger className="group-data-[collapsible=icon]:hidden text-sidebar-foreground" />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {/* Veeam Backup & Replication Group */}
        <SidebarGroup>
          <div className="flex items-center justify-between pr-2">
            <SidebarGroupLabel className="group-data-[collapsible=icon]:opacity-100 group-data-[collapsible=icon]:mt-0">
              <span className="group-data-[collapsible=icon]:hidden">{sectionNames.vbr}</span>
              <span className="hidden group-data-[collapsible=icon]:block font-bold">&mdash;</span>
            </SidebarGroupLabel>
            {!vbrConfigured && (
              <SidebarMenuBadge className="static translate-x-0 opacity-70 border border-slate-400 text-slate-500 bg-transparent h-5 min-w-0 px-1.5 w-auto">
                Missing
              </SidebarMenuBadge>
            )}
          </div>
          {vbrConfigured && (
            <SidebarGroupContent>
              <SidebarMenu>
                {vbrItems.map((item) => {
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
                          tooltip={item.title}
                          isActive={item.items.some(sub => pathname === sub.href)}
                        >
                          {item.icon && <item.icon className="h-4 w-4" />}
                          <span>{item.title}</span>
                          <ChevronDown className={`ml-auto h-4 w-4 transition-transform ${isOpen ? "rotate-0" : "-rotate-90"}`} />
                        </SidebarMenuButton>
                        {isOpen && (
                          <SidebarMenuSub>
                            {item.items.map((subItem) => (
                              <SidebarMenuSubItem key={subItem.href}>
                                <SidebarMenuSubButton asChild isActive={pathname === subItem.href}>
                                  <Link href={subItem.href}>
                                    <span>{subItem.title}</span>
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
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.title}>
                        <Link href={item.href!}>
                          {item.icon && <item.icon className="h-4 w-4" />}
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          )}
        </SidebarGroup>

        {/* Veeam Backup for M365 Group */}
        <SidebarGroup>
          <div className="flex items-center justify-between pr-2">
            <SidebarGroupLabel className="group-data-[collapsible=icon]:opacity-100 group-data-[collapsible=icon]:mt-0">
              <span className="group-data-[collapsible=icon]:hidden">{sectionNames.vbm}</span>
              <span className="hidden group-data-[collapsible=icon]:block font-bold">&mdash;</span>
            </SidebarGroupLabel>
            {!vb365Configured && (
              <SidebarMenuBadge className="static translate-x-0 opacity-70 border border-slate-400 text-slate-500 bg-transparent h-5 min-w-0 px-1.5 w-auto">
                Missing
              </SidebarMenuBadge>
            )}
          </div>
          {vb365Configured && (
            <SidebarGroupContent>
              <SidebarMenu>
                {vbmItems.map((item) => {
                  // Collapsible Item with children
                  if (item.items && item.items.length > 0) {
                    const isItemActive = pathname.startsWith(item.href || "")
                    return (
                      <SidebarMenuItem key={item.title}>
                        <Collapsible defaultOpen={isItemActive} className="group/collapsible">
                          <CollapsibleTrigger asChild>
                            <SidebarMenuButton tooltip={item.title}>
                              {item.icon && <item.icon className="h-4 w-4" />}
                              <span>{item.title}</span>
                              <ChevronRight className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                            </SidebarMenuButton>
                          </CollapsibleTrigger>
                          {item.items && (
                            <CollapsibleContent>
                              <SidebarMenuSub>
                                {item.items.map((subItem) => (
                                  <SidebarMenuSubItem key={subItem.title}>
                                    <SidebarMenuSubButton asChild isActive={pathname === subItem.href}>
                                      <Link href={subItem.href}>{subItem.title}</Link>
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
                      <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.title}>
                        <Link href={item.href}>
                          {item.icon && <item.icon className="h-4 w-4" />}
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          )}
        </SidebarGroup>

        {/* Veeam Recovery Orchestrator Group */}
        <SidebarGroup>
          <div className="flex items-center justify-between pr-2">
            <SidebarGroupLabel className="group-data-[collapsible=icon]:opacity-100 group-data-[collapsible=icon]:mt-0">
              <span className="group-data-[collapsible=icon]:hidden">{sectionNames.vro}</span>
              <span className="hidden group-data-[collapsible=icon]:block font-bold">&mdash;</span>
            </SidebarGroupLabel>
            {!vroConfigured && (
              <SidebarMenuBadge className="static translate-x-0 opacity-70 border border-slate-400 text-slate-500 bg-transparent h-5 min-w-0 px-1.5 w-auto">
                Missing
              </SidebarMenuBadge>
            )}
          </div>
          {vroConfigured && (
            <SidebarGroupContent>
              <SidebarMenu>
                {vroItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.title}>
                      <Link href={item.href}>
                        {item.icon && <item.icon className="h-4 w-4" />}
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          )}
        </SidebarGroup>

        {/* Analytics Group */}
        <SidebarGroup>
          <div className="flex items-center justify-between pr-2">
            <SidebarGroupLabel className="group-data-[collapsible=icon]:opacity-100 group-data-[collapsible=icon]:mt-0">
              <span className="group-data-[collapsible=icon]:hidden">{sectionNames.analytics}</span>
              <span className="hidden group-data-[collapsible=icon]:block font-bold">&mdash;</span>
            </SidebarGroupLabel>
            {!veeamOneConfigured && (
              <SidebarMenuBadge className="static translate-x-0 opacity-70 border border-slate-400 text-slate-500 bg-transparent h-5 min-w-0 px-1.5 w-auto">
                Missing
              </SidebarMenuBadge>
            )}
          </div>
          {veeamOneConfigured && (
            <SidebarGroupContent>
              <SidebarMenu>
                {analyticsItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.title}>
                      <Link href={item.href}>
                        {item.icon && <item.icon className="h-4 w-4" />}
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          )}
        </SidebarGroup>

        {/* Kasten K10 Group */}
        <SidebarGroup>
          <SidebarGroupLabel className="group-data-[collapsible=icon]:opacity-100 group-data-[collapsible=icon]:mt-0">
            <span className="group-data-[collapsible=icon]:hidden">{sectionNames.k10}</span>
            <span className="hidden group-data-[collapsible=icon]:block font-bold">&mdash;</span>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {k10Items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.title}>
                    <Link href={item.href}>
                      {item.icon && <item.icon className="h-4 w-4" />}
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.badge && (
                    <SidebarMenuBadge className="opacity-50">
                      {item.badge}
                    </SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Administration Group */}
        <SidebarGroup>
          <SidebarGroupLabel className="group-data-[collapsible=icon]:opacity-100 group-data-[collapsible=icon]:mt-0">
            <span className="group-data-[collapsible=icon]:hidden">{sectionNames.administration}</span>
            <span className="hidden group-data-[collapsible=icon]:block font-bold">&mdash;</span>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredAdminItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  {item.items ? (
                    <Collapsible defaultOpen className="group/collapsible">
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton tooltip={item.title}>
                          {item.icon && <item.icon className="h-4 w-4" />}
                          <span>{item.title}</span>
                          <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {item.items.map((subItem) => (
                            <SidebarMenuSubItem key={subItem.title}>
                              <SidebarMenuSubButton asChild isActive={pathname === subItem.href} size="md">
                                <Link href={subItem.href}>
                                  <span>{subItem.title}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </Collapsible>
                  ) : (
                    <>
                      <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.title}>
                        <Link href={item.href}>
                          {item.icon && <item.icon className="h-4 w-4" />}
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                      {item.badge && (
                        <SidebarMenuBadge className="opacity-50">
                          {item.badge}
                        </SidebarMenuBadge>
                      )}
                    </>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Documentation Group */}
        <SidebarGroup>
          <SidebarGroupLabel className="group-data-[collapsible=icon]:opacity-100 group-data-[collapsible=icon]:mt-0">
            <span className="group-data-[collapsible=icon]:hidden">{sectionNames.documentation}</span>
            <span className="hidden group-data-[collapsible=icon]:block font-bold">&mdash;</span>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {documentationItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <a href={item.href} target="_blank" rel="noopener noreferrer">
                      <BookOpen className="h-4 w-4" />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-border p-4 group-data-[collapsible=icon]:p-2">
        <div className="flex justify-center text-sm text-muted-foreground">
          <span className="group-data-[collapsible=icon]:hidden">Crafted with&nbsp;</span>
          <span className="text-red-500">❤️</span>
          <span className="group-data-[collapsible=icon]:hidden">&nbsp;for the Community</span>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
