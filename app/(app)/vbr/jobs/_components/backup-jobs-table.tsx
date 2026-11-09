"use client"
// Open Backup UI v1.0.2

import { useI18n } from '@/components/providers/i18n-provider'
import { builderDiagnostic } from '@/components/job-builder/diagnostics'
import { FilterFields,GridColumnChoice,GridViewMenu } from '@/components/operations/filter-fields'
import { FilterWorkspace } from '@/components/operations/filter-workspace'

import { SortableTableHead } from '@/components/ui/sortable-table-head'
import { sortableColumns } from '@/lib/table-sort'
import * as React from "react"

import { DataTableFacetedFilter } from "@/components/data-table-faceted-filter"
import { Button } from "@/components/ui/button"
import { Empty,Loading,Pager,Panel,SearchBox,Status } from '@/components/investigation/shared'
import ops from '@/components/operations/operations.module.css'
import styles from './jobs-inventory.module.css'
import { cn } from '@/lib/utils'
import { enumLabel } from '@/lib/i18n/presentation'
import {
DropdownMenu,
DropdownMenuContent,
DropdownMenuItem,
DropdownMenuLabel,
DropdownMenuPortal,
DropdownMenuSeparator,
DropdownMenuSub,
DropdownMenuSubContent,
DropdownMenuSubTrigger,
DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { veeamApi } from "@/lib/api/veeam-client"
import { VeeamBackupJob } from "@/lib/types/veeam"
import {
ColumnDef,
ColumnFiltersState,
flexRender,
getCoreRowModel,
getFacetedRowModel,
getFacetedUniqueValues,
getFilteredRowModel,
getPaginationRowModel,
getSortedRowModel,
SortingState,
useReactTable,
VisibilityState,
} from "@tanstack/react-table"
import { AlertTriangle,Building,CheckCircle2,Cloud,Copy,Database,File,Filter,FolderOpen,HardDrive,HelpCircle,Laptop,LayoutGrid,Monitor,MonitorCheck,MoreHorizontal,PlusIcon,RefreshCw,Server,Terminal,XCircle } from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"

interface BackupJobsTableProps {
  data: VeeamBackupJob[]
  loading?: boolean
  error?: string | null
  onRefresh?: () => void
}

export function BackupJobsTable({ data, loading = false, error, onRefresh }: BackupJobsTableProps) {
  const { t, formatNumber, formatDate } = useI18n()
  const [sorting, setSorting] = React.useState<SortingState>([{id:'lastRun',desc:true}])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [query,setQuery] = React.useState('');
  const columns = React.useMemo<ColumnDef<VeeamBackupJob>[]>(() => [
    {
      accessorKey: "name",
      header: t("Job name"),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <Link href={`/vbr/jobs/${row.original.id}`} className={ops.jobName}>
            {row.getValue("name")}
          </Link>
          <span
            className={styles.description}
            title={row.original.description}
          >
            {row.original.description}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "type",
      header: t("Type"),
      cell: ({ row }) => <span className={cn(ops.badge,ops.neutral)}>{enumLabel(t,row.getValue("type") as string)}</span>,
      filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
      accessorKey: "repositoryName",
      header: t("Repository"),
      cell: ({ row }) => (
        <div className={ops.repoCell}>
          {row.original.repositoryName || t("Not reported")}
        </div>
      ),
      filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
      accessorKey: "lastResult",
      header: t("Last result"),
      cell: ({ row }) => {
        const status = row.getValue("lastResult") as string
        return <Status value={status || 'None'}/>
      },
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
      },
    },
    {
      accessorKey: "lastRun",
      header: t("Last run"),
      cell: ({ row }) => {
        const value = row.getValue("lastRun") as string
        return <time className={ops.dateCell} dateTime={value || undefined}>{value ? formatDate(value,{dateStyle:"medium",timeStyle:"short"}) : t("Never")}</time>
      },
    },
    {
      accessorKey: "nextRun",
      header: t("Next run"),
      cell: ({ row }) => {
        const value = row.getValue("nextRun") as string
        const enabled = !row.original.isDisabled
        if (!enabled) return <span className={ops.subtext}>{t("Disabled")}</span>;
        return <time className={ops.dateCell} dateTime={value || undefined}>{value ? formatDate(value,{dateStyle:"medium",timeStyle:"short"}) : t("Not scheduled")}</time>
      },
    },
    {
      accessorKey: "status",
      header: t("Status"),
      cell: ({ row }) => {
        const status = row.getValue("status") as string;
        const progress = row.original.progressPercent || 0;
        // Only consider running if status is explicitly 'Running' and not 100% complete
        const isRunning = status === 'Running' && progress < 100;

        return (
          <div className={styles.status}>
            <Status value={isRunning ? 'Running' : status || 'Not reported'}/>
            {isRunning && (
              <div className={styles.progress}>
                <div role="progressbar" aria-label={t("Job progress")} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${Math.max(0,Math.min(100,progress))}%`}}/></div>
                <span>{formatNumber(progress / 100,{style:'percent',maximumFractionDigits:2})}</span>
              </div>
            )}
          </div>
        )
      },
    },
    {
      id: "actions",
      enableHiding: false,
      enableSorting: false,
      header: () => <span className="sr-only">{t("Actions")}</span>,
      cell: ({ row }) => {
        const job = row.original

        const handleAction = async (action: 'start' | 'stop' | 'retry' | 'disable' | 'enable') => {
          try {
            switch (action) {
              case 'start':
                const startPayload = job.type === 'BackupCopy'
                  ? { performActiveFull: false, startChainedJobs: false, syncRestorePoints: "Latest" }
                  : undefined;
                await veeamApi.startJob(job.id, startPayload);
                toast.success(t('Job started successfully'));
                break;
              case 'stop':
                await veeamApi.stopJob(job.id);
                toast.success(t('Job stopped successfully'));
                break;
              case 'retry':
                await veeamApi.retryJob(job.id);
                toast.success(t('Job retry initiated successfully'));
                break;
              case 'disable':
                await veeamApi.disableJob(job.id);
                toast.success(t('Job disabled successfully'));
                break;
              case 'enable':
                await veeamApi.enableJob(job.id);
                toast.success(t('Job enabled successfully'));
                break;
            }

            console.log(`Job ${job.id} ${action} successful`);

            // Trigger refresh if provided
            if (onRefresh) {
              onRefresh();
            }
          } catch (error) {
            console.error(`Error performing ${action} on job ${job.id}:`, error);
            toast.error(t('Job action failed: {error}',{error:error instanceof Error?builderDiagnostic(t,error.message):t('Unknown error')}));
          }
        };

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">{t('Actions for {name}',{name:job.name})}</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t("Actions")}</DropdownMenuLabel>
              <DropdownMenuItem asChild><Link href={`/vbr/jobs/${job.id}`}>{t("Investigate job")}</Link></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleAction('start')}>{t("Start")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAction('stop')}>{t("Stop")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAction('retry')}>{t("Retry")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleAction('disable')}>{t("Disable")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAction('enable')}>{t("Enable")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ], [onRefresh,t,formatDate,formatNumber]);

  const table = useReactTable({
    data,
    columns: sortableColumns(columns, sorting, data),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setQuery,
    globalFilterFn: (row,_columnId,value) => [row.original.name,row.original.description,row.original.repositoryName,row.original.type,row.original.id].some(text=>text?.toLowerCase().includes(String(value).trim().toLowerCase())),
    initialState: {pagination:{pageIndex:0,pageSize:15}},
    state: {
      globalFilter: query,
      sorting,
      columnVisibility,
      columnFilters,
    },
  })

  const matched=table.getFilteredRowModel().rows
  const activeCount=columnFilters.length+(query.trim()?1:0)
  const running=matched.filter(r=>r.original.status==='Running'&&(r.original.progressPercent||0)<100).length
  const needsAttention=matched.filter(r=>['Failed','Warning'].includes(r.original.lastResult||'')).length;
  return (<Panel title={t("Job & policy inventory")} subtitle={t("Current job state, latest results, and upcoming runs.")} action={<span className={ops.smallTag}>{t('{count} matching',{count:formatNumber(matched.length)})}</span>}>
      <FilterWorkspace label={t("Job and policy filters")} search={<SearchBox label={t("Search jobs, repositories, or IDs")} value={query} onChange={value=>{setQuery(value);table.setPageIndex(0)}}/>} activeCount={activeCount} onClear={()=>{table.resetColumnFilters();table.setGlobalFilter('');table.setPageIndex(0)}} filters={<FilterFields>{table.getColumn("type") && <><DataTableFacetedFilter
              column={table.getColumn("type")}
              title={t("Type")}
              options={Array.from(new Set(data.map(j => j.type))).sort().map(type => ({
                label: enumLabel(t,type),
                value: type,
              }))}
            /></>}
{table.getColumn("repositoryName") && <><DataTableFacetedFilter
              column={table.getColumn("repositoryName")}
              title={t("Repository")}
              options={Array.from(new Set(data.map(j => j.repositoryName).filter(Boolean))).sort().map(repo => ({
                label: repo as string,
                value: repo as string,
              }))}
            /></>}
{table.getColumn("lastResult") && <><DataTableFacetedFilter
              column={table.getColumn("lastResult")}
              title={t("Last result")}
              options={[
                { label: enumLabel(t,"Success"), value: "Success", icon: CheckCircle2 },
                { label: enumLabel(t,"Warning"), value: "Warning", icon: AlertTriangle },
                { label: enumLabel(t,"Failed"), value: "Failed", icon: XCircle },
                { label: enumLabel(t,"None"), value: "None", icon: HelpCircle },
              ]}
            /></>}</FilterFields>} actions={<><GridViewMenu><fieldset className="grid-column-fields"><legend>{t("Visible columns")}</legend>
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => {
                return (
                  <GridColumnChoice
                    key={column.id}
                    checked={column.getIsVisible()}
                    disabled={column.getIsVisible()&&table.getVisibleLeafColumns().filter(c=>c.getCanHide()).length===1}
                    onCheckedChange={(value) =>
                      column.toggleVisibility(!!value)
                    }
                  >
                    {typeof column.columnDef.header==='string'?column.columnDef.header:column.id}
                  </GridColumnChoice>
                )
              })}
          </fieldset></GridViewMenu><DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <PlusIcon className="h-4 w-4" />{t("Create a job")}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <HardDrive className="mr-2 h-4 w-4 text-green-600" />
                  <span>{t("Backup")}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="w-56">
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Server className="mr-2 h-4 w-4 text-green-600" />
                        <span>{t("Virtual machine")}…</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuPortal>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem asChild>
                            <Link href="/vbr/jobs/create" className="cursor-pointer w-full flex items-center">
                              <Server className="mr-2 h-4 w-4 text-blue-500" />
                              <span className="ml-2">VMware vSphere</span>
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href="/vbr/jobs/create?platform=hyperv" className="cursor-pointer w-full flex items-center">
                              <Server className="mr-2 h-4 w-4 text-blue-500" />
                              <span className="ml-2">Microsoft Hyper-V</span>
                            </Link>
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuPortal>
                    </DropdownMenuSub>

                    <DropdownMenuItem disabled>
                      <Monitor className="mr-2 h-4 w-4 text-orange-500" />{t("Windows computer...")}</DropdownMenuItem>
                    <DropdownMenuItem disabled>
                      <Terminal className="mr-2 h-4 w-4 text-yellow-500" />{t("Linux computer...")}</DropdownMenuItem>
                    <DropdownMenuItem disabled>
                      <Laptop className="mr-2 h-4 w-4 text-gray-500" />{t("Mac computer...")}</DropdownMenuItem>
                    <DropdownMenuItem disabled>
                      <Terminal className="mr-2 h-4 w-4 text-green-800" />{t("Unix computer...")}</DropdownMenuItem>

                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <LayoutGrid className="mr-2 h-4 w-4 text-gray-400" />
                        <span>{t("Application")}</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuPortal>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem disabled>Oracle Database</DropdownMenuItem>
                          <DropdownMenuItem disabled>SAP HANA</DropdownMenuItem>
                          <DropdownMenuItem disabled>Microsoft SQL Server</DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuPortal>
                    </DropdownMenuSub>

                    <DropdownMenuItem disabled>
                      <LayoutGrid className="mr-2 h-4 w-4 text-green-500" />{t("Object storage...")}</DropdownMenuItem>
                    <DropdownMenuItem disabled>
                      <FolderOpen className="mr-2 h-4 w-4 text-gray-500" />{t("File share...")}</DropdownMenuItem>

                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Building className="mr-2 h-4 w-4 text-blue-500" />
                        <span>Microsoft Entra ID...</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuPortal>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem asChild>
                            <Link href="/vbr/jobs/create-entraid?type=tenant" className="cursor-pointer">{t("Tenant")}</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href="/vbr/jobs/create-entraid?type=audit" className="cursor-pointer">{t("Logs")}</Link>
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuPortal>
                    </DropdownMenuSub>

                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Cloud className="mr-2 h-4 w-4 text-orange-400" />
                        <span>AWS</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuPortal>
                        <DropdownMenuSubContent className="w-48">
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                              <Server className="mr-2 h-4 w-4 text-orange-400" />
                              <span>EC2</span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuPortal>
                              <DropdownMenuSubContent>
                                <DropdownMenuItem disabled>EC2...</DropdownMenuItem>
                                <DropdownMenuItem disabled>{t("EC2 SLA-Based...")}</DropdownMenuItem>
                              </DropdownMenuSubContent>
                            </DropdownMenuPortal>
                          </DropdownMenuSub>
                          <DropdownMenuItem disabled><Database className="mr-2 h-4 w-4 text-blue-400" /> RDS...</DropdownMenuItem>
                          <DropdownMenuItem disabled><HardDrive className="mr-2 h-4 w-4 text-green-400" /> EFS...</DropdownMenuItem>
                          <DropdownMenuItem disabled><Database className="mr-2 h-4 w-4 text-purple-400" /> DynamoDB...</DropdownMenuItem>
                          <DropdownMenuItem disabled><HardDrive className="mr-2 h-4 w-4 text-green-500" /> FSx...</DropdownMenuItem>
                          <DropdownMenuItem disabled><Database className="mr-2 h-4 w-4 text-red-500" /> Redshift...</DropdownMenuItem>
                          <DropdownMenuItem disabled><Database className="mr-2 h-4 w-4 text-red-400" /> Redshift Serverless...</DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuPortal>
                    </DropdownMenuSub>

                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Cloud className="mr-2 h-4 w-4 text-blue-600" />
                        <span>Microsoft Azure</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuPortal>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem disabled>{t("Virtual machine")}…</DropdownMenuItem>
                          <DropdownMenuItem disabled>{t("SQL databases...")}</DropdownMenuItem>
                          <DropdownMenuItem disabled>{t("Azure files...")}</DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuPortal>
                    </DropdownMenuSub>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Copy className="mr-2 h-4 w-4 text-green-500" />
                  <span>{t("Replication")}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem disabled><Server className="mr-2 h-4 w-4 text-blue-500" /> VMware vSphere</DropdownMenuItem>
                    <DropdownMenuItem disabled><Server className="mr-2 h-4 w-4 text-blue-500" /> Microsoft Hyper-V</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <RefreshCw className="mr-2 h-4 w-4 text-green-500" />
                  <span>{t("CDP policy")}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem disabled><Server className="mr-2 h-4 w-4 text-blue-500" /> VMware vSphere</DropdownMenuItem>
                    <DropdownMenuItem disabled><RefreshCw className="mr-2 h-4 w-4 text-green-500" /> Universal CDP</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>

              <DropdownMenuSeparator />

              <DropdownMenuItem disabled>
                <MonitorCheck className="mr-2 h-4 w-4 text-green-500" />
                SureBackup...
              </DropdownMenuItem>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Copy className="mr-2 h-4 w-4 text-green-500" />
                  <span>{t("Backup copy")}…</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem asChild>
                      <Link href="/vbr/jobs/create-backup-copy" className="cursor-pointer">{t("Image-level backup")}</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled>{t("Storage copy")}</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>

              <DropdownMenuItem disabled>
                <Copy className="mr-2 h-4 w-4 text-gray-500" />{t("VM copy...")}</DropdownMenuItem>

              <DropdownMenuItem disabled>
                <File className="mr-2 h-4 w-4 text-green-500" />{t("File copy...")}</DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem disabled>
                <Filter className="mr-2 h-4 w-4 text-green-500" />{t("Add view...")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu></>}>
<div className={styles.summary}><span>{t('{matched} of {total} jobs & policies',{matched:formatNumber(matched.length),total:formatNumber(data.length)})}</span><span>{t('{running} running · {attention} with failed or warning results',{running:formatNumber(running),attention:formatNumber(needsAttention)})}{loading&&<> · {t('Refreshing…')}</>}</span></div>
{loading&&!data.length?<Loading>{t("Loading jobs and policies…")}</Loading>:matched.length?<div className={ops.tableScroll} tabIndex={0} role="region" aria-label={t("Scrollable job inventory")}>
        <table className={cn(ops.table,styles.table)}>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <SortableTableHead native key={header.id} header={header}/>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>:<Empty>{data.length?t("No jobs match these filters. Clear all or adjust your search."):error?t("Job inventory is unavailable. Refresh to try again."):t("No jobs were returned. Create a job to start protecting workloads.")}</Empty>}
<Pager page={table.getState().pagination.pageIndex} count={matched.length} size={15} onChange={page=>table.setPageIndex(page)} label={t("jobs")}/>
</FilterWorkspace></Panel>
  )
}
