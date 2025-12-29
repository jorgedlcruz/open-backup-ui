"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { BookOpen, ChevronDown, Briefcase, Server, Shield, ShieldCheck, LayoutDashboard, Database } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

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
    icon: Server,
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

export function AppSidebar() {
  const pathname = usePathname()
  // State for collapsible sub-menus in VBR
  const [inventoryOpen, setInventoryOpen] = React.useState(false)
  const [infrastructureOpen, setInfrastructureOpen] = React.useState(false)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-border p-4">
        <div className="flex h-16 items-center justify-center group-data-[collapsible=icon]:h-12">
          <Image
            src="/logo.webp"
            alt="VBR Connect"
            width={120}
            height={40}
            className="object-contain w-full h-full group-data-[collapsible=icon]:hidden"
            priority
          />
          <LayoutDashboard className="hidden group-data-[collapsible=icon]:block w-6 h-6 text-primary" />
        </div>
      </SidebarHeader>
      <SidebarContent>
        {/* Veeam Backup & Replication Group */}
        <SidebarGroup>
          <SidebarGroupLabel>Veeam Backup & Replication</SidebarGroupLabel>
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
        </SidebarGroup>

        {/* Veeam Backup for M365 Group */}
        <SidebarGroup>
          <SidebarGroupLabel>Veeam Backup for M365</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {vbmItems.map((item) => (
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
        </SidebarGroup>

        {/* Veeam Recovery Orchestrator Group */}
        <SidebarGroup>
          <SidebarGroupLabel>Veeam Recovery Orchestrator</SidebarGroupLabel>
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
        </SidebarGroup>

        {/* Kasten K10 Group */}
        <SidebarGroup>
          <SidebarGroupLabel>Kasten K10</SidebarGroupLabel>
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
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Documentation Group */}
        <SidebarGroup>
          <SidebarGroupLabel>Documentation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Documentation items were collapsible before. Let's make them a list or collapsible?
                   Previous: Collapsible group "Documentation".
                   New: Group Label "Documentation".
                   We can just list them.
               */}
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
      <SidebarFooter className="border-t border-border p-4">
        <div className="text-center text-sm text-muted-foreground">
          Created by Team-1 2025
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
