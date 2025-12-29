# Veeam Single-UI

A Next.js 15 application providing a unified monitoring dashboard for Veeam Data Protection products through an intuitive web interface.

![VBR Connect Walkthrough](https://jorgedelacruz.uk/wp-content/uploads/2025/12/ezgif-656c493097a494bd.gif)

## Features

### Veeam Backup & Replication (VBR)

#### Dashboard View
- **Security Score & Best Practices**: Simplified top-level widget for immediate security posture visibility
- **Transferred Data Widget**: Visual representation of data transfer rates over time
- **Real-time Statistics**: Active jobs, success rate, storage usage, protected VMs, and data processed
- **Malware Detection**: Recent malware scan events and alerts
- **Recent Sessions**: Overview of the latest backup sessions with status and details
- **Time Range Selection**: 7-day and 30-day views for historical analysis

#### Jobs Management
- **Comprehensive Jobs Table**: All backup jobs with status, type, and schedule information
- **Advanced Filtering**: Filter by job status (Running, Success, Warning, Failed)
- **Job Details**: Click any job to view detailed session history
- **Search Capability**: Quick search across all job names
- **Last/Next Run Tracking**: See when jobs last ran and when they'll run next

#### Job Details View
- **Enhanced Session History**: Complete history with default filtering for Backup Jobs
- **Unified Filtering**: Filters apply to both the transfer rate chart and the sessions grid
- **Task-Level Breakdown**: Detailed task information for each session
- **Transfer Rates**: Visual representation of backup transfer rates over time
- **Session Status**: Success, Warning, Failed, and Running session tracking
- **Time-based Filtering**: Filter sessions by time range

#### Backup Infrastructure
- **Backup Proxies**:
  - **Performance Monitoring**: Track concurrent tasks
  - **Configuration**: View transport modes, OS type, and details
  - **Status**: Visual health indicators (Online/Offline) and maintenance mode status
- **Backup Repositories**:
  - **Capacity Planning**: Visual capacity bars showing Used vs Free space
  - **Type Support**: Windows, Linux, NFS, SMB, and Object Storage repository support
  - **Properties**: Monitor immutability settings, task limits, and overall health
- **Managed Servers**:
  - **Infrastructure Overview**: View all managed backup infrastructure servers
  - **Server Details**: Name, type, description, and version information

#### Inventory Management
- **Virtual Infrastructure**:
  - Complete view of VMware vSphere, Microsoft Hyper-V, and Nutanix AHV virtual machines
  - **Protection Status**: Instantly identify protected vs. unprotected VMs with visual indicators
  - **Rich Metadata**: Access detailed info including vCenter, Datacenter, Cluster, Guest OS, and DNS names
  - **Advanced Filtering**: Faceted filtering by protection status, platform, and state
- **Protected Data**: 
  - **Rich Grid View**: Detailed list of all protected workloads
  - **Calendar View**: Toggleable monthly calendar view for restore points visualization
  - **Restore Points**: Deep dive into restore points with derived type (Full/Incremental) and size data
- **Physical & Cloud Infrastructure**:
  - **Protection Groups**: Monitor physical agent deployment and status
  - **Discovered Entities**: Track individual machines/cloud instances with agent status
  - **Agent Health**: Last connection time, version, and operation mode tracking
- **Unstructured Data**:
  - **File Shares**: Monitor protected file servers and NAS devices
  - **Object Storage**: Track object storage repositories and credential mappings
  - **IO Control**: View processing limits and configurations

### Veeam Recovery Orchestrator (VRO)
- **Recovery Plans Table**: Overview of all orchestration plans
- **Plan Status**: Monitor plan state and configuration
- **Plan Details**: Name, description, and VM counts
- **Search and Filter**: Quick access to specific recovery plans

### Veeam Backup for Microsoft 365 (VBM)
- **Microsoft 365 Jobs**: Monitor all M365 backup jobs
- **Job Status Tracking**: Success, warning, and failure states
- **Last Run Information**: Track when M365 jobs last executed
- **Job Type Support**: Multiple M365 job types and configurations

### Kasten K10
- **Coming Soon**: Kubernetes backup platform monitoring

### General Features
- **Real-time Updates**: Automatic 30-second data refresh across all views
- **Unified Global Search**: Search across all backup jobs and recovery plans from any page
- **Theme Support**: Dark/Light mode with automatic system preference detection
- **Responsive Design**: Optimized for desktop, tablet, and mobile devices
- **Secure API Proxy**: Server-side API calls protect credentials from client exposure
- **Interactive Visualizations**: Charts and graphs using Recharts library
- **Data Tables**: Sortable, filterable tables with TanStack Table
- **Toast Notifications**: User-friendly error and success messages

## Getting Started

### Prerequisites

- Node.js 20.x or later
- npm, yarn, pnpm, or bun package manager
- Access to at least one Veeam product REST API:
  - Veeam Backup & Replication REST API (v1.3-rev1) - **Required**
  - Veeam Recovery Orchestrator REST API (v7.21) - Optional
  - Veeam Backup for Microsoft 365 REST API (v8) - Optional

### Environment Variables

Create a `.env.local` file in the root directory:

```env
# Veeam Backup & Replication (Required)
VEEAM_API_URL=https://your-vbr-server:9419
VEEAM_USERNAME=your-username
VEEAM_PASSWORD=your-password

# Veeam Recovery Orchestrator (Optional)
VRO_API_URL=https://your-vro-server:9898
VRO_USERNAME=your-vro-username
VRO_PASSWORD=your-vro-password

# Veeam Backup for Microsoft 365 (Optional)
VBM_API_URL=https://your-vbm-server:4443
VBM_USERNAME=your-vbm-username
VBM_PASSWORD=your-vbm-password

# Allow self-signed certificates (development only)
NODE_TLS_REJECT_UNAUTHORIZED=0
```

**Note**: VBR configuration is required. VRO and VBM are optional - their respective pages will display an error message if not configured.

### Development

1. Install dependencies:

```bash
npm install
```

2. Run the development server:

```bash
npm run dev
```

The application uses Next.js 15 with Turbopack for fast development builds.

3. Open [http://localhost:3000](http://localhost:3000) with your browser to see the application.

### Production Build

```bash
npm run build
npm start
```

## Container Deployment

See [CONTAINER.md](./CONTAINER.md) for detailed instructions on building and running this application as a container.

## API Integration

### Veeam Backup & Replication
- **API Version**: v1.3-rev1
- **Default Port**: 9419
- **Authentication**: Basic Auth with session tokens
- **Documentation**: [VBR REST API Reference](https://helpcenter.veeam.com/docs/backup/vbr_rest/reference/vbr-rest-v1-3-rev1.html)
- **Endpoints Used**:
  - `/api/v1/inventory` - Virtual infrastructure inventory
  - `/api/v1/agents/protectionGroups` - Protection groups (Physical/Cloud)
  - `/api/v1/agents/protectionGroups/{id}/discoveredEntities` - Discovered agent status
  - `/api/v1/inventory/unstructuredDataServers` - Unstructured data servers
  - `/api/v1/backupInfrastructure/jobs` - Backup jobs list
  - `/api/v1/jobs/states` - Advanced job monitoring
  - `/api/v1/backupInfrastructure/jobs/{id}/sessions` - Job sessions
  - `/api/v1/backupInfrastructure/backupServers` - Managed servers
  - `/api/v1/backupInfrastructure/backupProxies` - Backup proxies
  - `/api/v1/backupInfrastructure/backupRepositories` - Backup repositories
  - `/api/v1/backupInfrastructure/repositories/states` - Repository states
  - `/api/v1/license` - License information
  - `/api/v1/malware-detection` - Malware events
  - `/api/v1/security/best-practices` - Security best practices
  - `/api/v1/backupObjects` - Backup objects lookup
  - `/api/v1/backups/{id}` - Backup details
  - `/api/v1/backups/{id}/backupFiles` - Backup files (sizes)
  - `/api/v1/restorePoints` - Restore points inventory

### Veeam Recovery Orchestrator
- **API Version**: v7.21
- **Default Port**: 9898
- **Authentication**: Basic Auth
- **Documentation**: [VRO REST API Reference](https://helpcenter.veeam.com/references/vro/7.2/rest/7.2.1/)
- **Endpoints Used**:
  - `/api/v7.2/Plans` - Recovery orchestration plans

### Veeam Backup for Microsoft 365
- **API Version**: v8
- **Default Port**: 4443
- **Authentication**: Basic Auth
- **Documentation**: [VBM REST API Reference](https://helpcenter.veeam.com/docs/vbo365/rest/reference/vbo-rest-v8.html)
- **Endpoints Used**:
  - `/v8/Jobs` - Microsoft 365 backup jobs
  - `/v8/JobSessions` - Job history and status
  - `/v8/Organizations` - M365 Organizations
  - `/v8/ProtectedUsers` - Protected Users inventory
  - `/v8/ProtectedGroups` - Protected Groups inventory
  - `/v8/ProtectedSites` - Protected Sites inventory
  - `/v8/ProtectedTeams` - Protected Teams inventory
  - `/v8/RestorePoints` - Global restore point search
  - `/v8/License` - License status
  - `/v8/Health` - API service health

## Project Structure

```
├── app/
│   ├── api/                          # API routes (secure proxy to Veeam APIs)
│   │   ├── veeam/                    # VBR API routes
│   │   │   ├── auth/                 # VBR authentication
│   │   │   ├── jobs/                 # Backup jobs endpoint
│   │   │   ├── sessions/             # Job sessions endpoint
│   │   │   ├── backupInfrastructure/ # Infrastructure endpoints
│   │   │   │   ├── proxies/          # Backup proxies
│   │   │   │   └── repositories/     # Backup repositories
│   │   │   ├── license/              # License information
│   │   │   ├── malware-detection/    # Malware events
│   │   │   └── security/             # Security best practices
│   │   ├── vro/                      # VRO API routes
│   │   │   ├── auth/                 # VRO authentication
│   │   │   └── plans/                # Recovery plans endpoint
│   │   └── vbm/                      # VBM API routes
│   │       ├── auth/                 # VBM authentication
│   │       └── jobs/                 # Microsoft 365 jobs endpoint
│   ├── vbr/                          # VBR monitoring pages
│   │   ├── page.tsx                  # VBR jobs overview
│   │   ├── dashboard/                # VBR dashboard with stats
│   │   ├── jobs/                     # Jobs list and details
│   │   │   ├── page.tsx              # All jobs view
│   │   │   └── [id]/                 # Individual job details
│   │   ├── inventory/                # Inventory management
│   │   │   ├── virtual/              # Virtual infrastructure (VMware/Hyper-V)
│   │   │   ├── protection-groups/    # Physical & Cloud infrastructure
│   │   │   └── unstructured/         # Unstructured data (NAS/Object)
│   │   └── infrastructure/           # Infrastructure management
│   │       ├── proxies/              # Backup proxies view
│   │       ├── repositories/         # Backup repositories view
│   │       └── managed-servers/      # Managed servers view
│   ├── vro/                          # VRO monitoring page
│   ├── vbm/                          # VBM monitoring page
│   ├── k10/                          # K10 placeholder page
│   ├── layout.tsx                    # Root layout with sidebar
│   └── page.tsx                      # Home (redirects to /vbr/dashboard)
├── components/
│   ├── ui/                           # shadcn/ui components (20+ components)
│   ├── app-header.tsx                # Application header with search
│   ├── app-sidebar.tsx               # Navigation sidebar
│   ├── backup-jobs-table.tsx         # VBR jobs table
│   ├── dashboard-stats.tsx           # Dashboard statistics cards
│   ├── security-widget.tsx           # Security compliance widget
│   ├── storage-capacity-widget.tsx   # Storage capacity widget
│   ├── sessions-overview.tsx         # Recent sessions widget with chart
│   ├── transfer-rate-chart.tsx       # Transfer rate visualization
│   ├── session-tasks-table.tsx       # Session tasks breakdown
│   ├── job-details-header.tsx        # Job details header component
│   ├── backup-proxies-table.tsx      # Backup proxies table
│   ├── backup-repositories-table.tsx # Backup repositories table
│   ├── managed-servers-table.tsx     # Managed servers table
│   ├── virtual-infrastructure-table.tsx # Virtual inventory with protection status
│   ├── protection-groups-table.tsx   # Protection groups inventory
│   ├── discovered-entities-table.tsx # Physical/Cloud agent inventory
│   ├── unstructured-data-table.tsx   # Unstructured data inventory
│   ├── vbr-protected-data-table.tsx  # Protected workloads grid
│   ├── vbr-restore-points-table.tsx  # Restore points grid
│   ├── vbr-restore-points-calendar.tsx # Restore points calendar view
│   ├── recovery-plans-table.tsx      # VRO plans table
│   ├── vbm-jobs-table.tsx            # VBM jobs table
│   ├── global-search.tsx             # Global search component
│   ├── data-table-faceted-filter.tsx # Advanced table filtering
│   ├── search-provider.tsx           # Global search context
│   ├── theme-provider.tsx            # Dark/Light theme provider
│   └── mode-toggle.tsx               # Theme toggle button
├── lib/
│   ├── api/
│   │   └── veeam-client.ts           # API client utilities
│   ├── types/
│   │   ├── veeam.ts                  # VBR TypeScript types (comprehensive)
│   │   └── vbm.ts                    # VBM TypeScript types
│   └── utils/
│       ├── utils.ts                  # General utilities (cn, formatters)
│       ├── transfer-rate.ts          # Transfer rate calculations
│       └── rate-limiter.ts           # API rate limiting
├── hooks/
│   └── use-mobile.ts                 # Mobile detection hook
└── public/
    ├── favicon.ico                   # Application favicon
    └── logo.webp                     # Application logo
```

## Technology Stack

- **Framework**: [Next.js 15](https://nextjs.org/docs) with App Router and Turbopack
- **Language**: [TypeScript 5](https://www.typescriptlang.org/)
- **UI Components**: [shadcn/ui](https://ui.shadcn.com/) built on [Radix UI](https://www.radix-ui.com/)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/)
- **Charts**: [Recharts](https://recharts.org/)
- **Data Tables**: [TanStack Table](https://tanstack.com/table/latest)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Theme**: [next-themes](https://github.com/pacocoursey/next-themes)

## Documentation

### Veeam Product Documentation
- [Veeam Backup & Replication REST API](https://helpcenter.veeam.com/docs/backup/vbr_rest/)
- [Veeam Recovery Orchestrator REST API](https://helpcenter.veeam.com/references/vro/)
- [Veeam Backup for Microsoft 365 REST API](https://helpcenter.veeam.com/docs/vbo365/rest/)

### Application Documentation
- [Container Deployment Guide](./CONTAINER.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md) - Solutions for common issues including 403 errors

## Contributing

This project was developed originally as part of the Veeam Community Hackathon 2025. With a limited and static subset of funcionality, it can be found here - https://github.com/VeeamCommunity/veeamcommunity-2025-Team-1/ Since then, many features have been added and the codebase has been refactored to be more maintainable and extensible. 

If you are interested in contributing to this project, please see [CONTRIBUTING.md](./CONTRIBUTING.md) and [DCO.md](./DCO.md) for contribution guidelines.

## License

See [LICENSE](./LICENSE) file for details.
