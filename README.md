# Veeam Single-UI

A Next.js 15 application providing a unified monitoring dashboard for Veeam Data Protection products through an intuitive web interface.

![Veeam Single-UI Walkthrough](https://jorgedelacruz.uk/wp-content/uploads/2026/01/ezgif-668cdc4ebc95a18c.gif)

## What's New in v0.2.0

### 🚀 Redesigned Authentication Experience
- **New Landing Page**: Beautiful onboarding experience with animated feature carousel
- **Dynamic Credentials**: Add and manage data sources directly from the UI—no `.env` files required!
- **Auto-Connect**: Credentials are securely stored and encrypted; just click "Connect" on subsequent visits
- **Multi-Source Support**: Connect VBR, VB365, Veeam ONE, and VRO from a single interface

### 🛠️ Data Sources Management
- **Administration > Data Sources**: New dedicated page to view, add, edit, and remove data sources
- **Real-time Status**: See connection status (Connected/Ready/Setup) at a glance
- **Platform Types**: Full support for VBR, VB365, Veeam ONE, VRO, and Kasten K10

### 📊 Veeam ONE Integration
- **Report Catalog**: Browse and run Veeam ONE reports directly from the UI
- **Saved Reports**: Access previously generated reports
- **Dynamic Configuration**: Veeam ONE credentials persist and auto-connect like VBR/VB365

---

## Features

### Veeam Backup & Replication (VBR)

#### Dashboard View
- **Security Score & Best Practices**: Simplified top-level widget for immediate security posture visibility
- **Transferred Data Widget**: Visual representation of data transfer rates over time
- **Real-time Statistics**: Active jobs, success rate, storage usage, protected VMs, and data processed
- **Malware Detection**: Recent malware scan events and alerts
- **Recent Sessions**: Overview of the latest backup sessions with status and details
  - **Time Range Dropdown**: Quick selection for 7-day, 14-day, and 30-day views
  - **Export Capability**: Export filtered session data to CSV or JSON format
  - **Type Filtering**: Auto-filters to "BackupJob" type for clarity

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
  - **Rich Grid View**: Detailed list of all protected workloads with sortable columns
  - **HexGrid Visualization**: Toggleable hexagonal protection map with RPO-based coloring
    - Green (Protected within RPO), Orange (Unprotected/Outside RPO)
    - Hover effects and click-to-detail dialog
    - Filters by type and status with search capability
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
- **Dashboard**: M365 specific statistics and session overview (auto-filtered to "Backup" type)
- **Microsoft 365 Jobs**: Monitor all M365 backup jobs
- **Job Status Tracking**: Success, warning, and failure states
- **Job Type Support**: Multiple M365 job types and configurations
- **Calendar View**: Interactive calendar for visualizing restore points availability
- **Organizations**: Track multiple M365 organizations and their storage usage
- **Backup Infrastructure**:
  - **Backup Proxies**: Status, CPU/Memory usage, version, roles, and actions (rescan, maintenance mode)
  - **Backup Repositories**: Capacity visualization, retention settings, immutability, encryption status

### Administration & Branding
- **Data Sources** (NEW in v0.2.0):
  - **Centralized Management**: Add, edit, and remove Veeam data sources from the UI
  - **Multi-Platform**: VBR, VB365, Veeam ONE, VRO, and Kasten K10 support
  - **Connection Status**: Real-time status indicators (Connected/Ready/Setup)
  - **Secure Storage**: Credentials encrypted using AES-256 and stored locally
  - **Auto-Connect**: One-click re-authentication for stored credentials
- **Licensing**: 
  - **Tabbed Interface**: Toggle between VBR and VB365 license views
  - **VBR License**: Detailed license report generation with PDF/HTML download
  - **VB365 License**: Licensed users table with revoke capability
  - **Instance and Capacity Usage**: Breakdown by workload type
  - **PDF Report Generation**: Download license overview reports
- **Theme Customizer**:
  - **Color Presets**: Blue, Green, Orange, Red, Violet, Yellow, and Default
  - **Radius Control**: Adjust UI corner roundness (0 to 1.0rem)
  - **Scaling**: Adjust font and element scaling (90% to 110%)
  - **Mode**: Seamless Dark/Light mode switching
  - **Cookie Persistence**: Theme settings persist across sessions via server-side cookies
- **Identity Management**:
  - **User Directory**: View and filter users with metadata
- **Security Settings**:
  - **MFA Enforcement**: Toggle with real-time API sync
  - **Service Accounts**: Per-user management with role assignment
  - **RBAC Roles**: View and manage role-based permissions

### Kasten K10
- **Coming Soon**: Kubernetes backup platform monitoring

### General Features
- **Real-time Updates**: Automatic 30-second data refresh across all views
- **Unified Global Search**: Search across all backup jobs and recovery plans from any page
- **Responsive Design**: Optimized for desktop, tablet, and mobile devices
- **Secure API Proxy**: Server-side API calls protect credentials from client exposure
- **Interactive Visualizations**: Charts and graphs using Recharts library
- **Data Tables**: Sortable, filterable tables with TanStack Table
  - **Standardized Headers**: Consistent column toggle and search across all tables
  - **Column Visibility**: Hide/show columns via dropdown menu
- **Toast Notifications**: User-friendly error and success messages
- **Environment-Based Visibility**: VBM, VRO sections auto-hide when not configured

## Getting Started

### Prerequisites

- Node.js 20.x or later
- npm, yarn, pnpm, or bun package manager
- Access to at least one Veeam product REST API:
  - Veeam Backup & Replication REST API (v1.3-rev1)
  - Veeam Backup for Microsoft 365 REST API (v8)
  - Veeam ONE REST API (v12.3)
  - Veeam Recovery Orchestrator REST API (v7.21)

### Quick Start (Recommended)

1. Install dependencies and start the application:

```bash
npm install
npm run dev
```

2. Open [http://localhost:3000](http://localhost:3000) in your browser

3. **Add your first data source** using the Landing Page:
   - Click **"Add Your First Data Source"**
   - Select platform type (VBR, VB365, Veeam ONE, etc.)
   - Enter the server hostname/IP and port
   - Click **"Add Source"**, then **"Connect"**
   - Enter your credentials and authenticate

4. Once connected, click **"Continue to Dashboard"** to access the monitoring interface

> 💡 **Credentials are encrypted and stored locally.** On your next visit, just click "Connect All Sources" to auto-authenticate!

### Managing Data Sources

After initial setup, you can manage your data sources from **Administration > Data Sources**:
- View all configured platforms with connection status
- Add new data sources
- Edit existing source URLs and names
- Remove data sources
- Re-authenticate when credentials expire

### Environment Variables (Legacy/Advanced)

> ⚠️ **Deprecated for v0.2.0+**: We recommend using the UI-based Data Sources management instead of environment variables. Environment variables are still supported for backward compatibility and CI/CD deployments.

If you prefer environment-based configuration, create a `.env.local` file:

```env
# Veeam Backup & Replication
VEEAM_API_URL=https://your-vbr-server:9419
VEEAM_USERNAME=your-username
VEEAM_PASSWORD=your-password

# Veeam Backup for Microsoft 365
VBM_API_URL=https://your-vbm-server:4443
VBM_USERNAME=your-vbm-username
VBM_PASSWORD=your-vbm-password

# Veeam ONE
VEEAM_ONE_API_URL=https://your-vone-server:1239
VEEAM_ONE_USERNAME=your-vone-username
VEEAM_ONE_PASSWORD=your-vone-password

# Veeam Recovery Orchestrator
VRO_API_URL=https://your-vro-server:9898
VRO_USERNAME=your-vro-username
VRO_PASSWORD=your-vro-password

# Allow self-signed certificates (development only)
NODE_TLS_REJECT_UNAUTHORIZED=0
```

**Note**: Environment variables take precedence over UI-configured sources. If both are configured, the env var source will be used.

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
  - `/api/v1/license` - License information overview
  - `/api/v1/license/instances` - License instance details
  - `/api/v1/license/capacity` - License capacity details
  - `/api/v1/malware-detection` - Malware events
  - `/api/v1/security/best-practices` - Security best practices
  - `/api/v1/security/settings` - MFA and security settings
  - `/api/v1/accounts/users` - User accounts management
  - `/api/v1/roles` - RBAC role definitions
  - `/api/v1/roles/{id}/permissions` - Role permissions
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
  - `/v8/License` - License status and info
  - `/v8/LicensedUsers` - Licensed user management (GET/DELETE)
  - `/v8/Proxies` - Backup proxy servers
  - `/v8/BackupRepositories` - Backup repository management
  - `/v8/Reports/GenerateLicenseOverview` - PDF report generation
  - `/v8/Health` - API service health

## Project Structure

```
├── app/
│   ├── administration/               # Administration Area
│   │   ├── branding/                 # Branding settings (Theme Customizer)
│   │   ├── licensing/                # Licensing reports & status
│   │   └── layout.tsx                # Administration layout
│   ├── api/                          # API routes (secure proxy to Veeam APIs)
│   │   ├── veeam/                    # VBR API routes
│   │   │   ├── auth/                 # VBR authentication
│   │   │   ├── jobs/                 # Backup jobs endpoint
│   │   │   ├── sessions/             # Job sessions endpoint
│   │   │   ├── backupInfrastructure/ # Infrastructure endpoints
│   │   │   ├── license/              # License endpoints (inc. reports)
│   │   │   ├── malware-detection/    # Malware events
│   │   │   └── security/             # Security best practices
│   │   ├── vro/                      # VRO API routes
│   │   └── vbm/                      # VBM API routes
│   │       ├── LicensedUsers/        # Licensed user management
│   │       ├── Proxies/              # Proxy servers
│   │       ├── Reports/              # PDF report generation
│   │       └── ...                   # Other VBM endpoints
│   ├── vbr/                          # VBR monitoring pages
│   │   ├── dashboard/                # VBR dashboard with stats
│   │   ├── jobs/                     # Jobs list and details
│   │   ├── inventory/                # Inventory management
│   │   ├── infrastructure/           # Infrastructure management
│   │   ├── protected-data/           # Restore points & calendar view
│   │   └── page.tsx                  # Redirects to dashboard
│   ├── vro/                          # VRO monitoring page
│   ├── vbm/                          # VBM monitoring pages
│   │   ├── dashboard/                # VBM dashboard with stats
│   │   ├── jobs/                     # M365 backup jobs list
│   │   ├── protected-items/          # Protected objects view
│   │   ├── organizations/            # M365 organizations
│   │   └── infrastructure/           # Backup infrastructure
│   │       ├── proxies/              # Backup proxies page
│   │       └── repositories/         # Backup repositories page
│   ├── k10/                          # K10 placeholder page
│   ├── layout.tsx                    # Root layout with sidebar & theme provider
│   └── page.tsx                      # Home (redirects to /vbr/dashboard)
├── components/
│   ├── ui/                           # shadcn/ui components (20+ components)
│   ├── theme-customizer/             # Branding components (Radius, Mode, Preset)
│   │   ├── color-mode-selector.tsx
│   │   ├── content-layout-selector.tsx
│   │   ├── preset-selector.tsx
│   │   └── theme-radius-selector.tsx
│   ├── app-header.tsx                # Application header with search
│   ├── app-sidebar.tsx               # Navigation sidebar
│   ├── active-theme.tsx              # Theme state management component
│   ├── administration-nav.tsx        # Administration sidebar
│   ├── dashboard-stats.tsx           # Dashboard statistics cards
│   ├── sessions-overview.tsx         # Recent sessions widget with chart
│   ├── transfer-rate-chart.tsx       # Transfer rate visualization
│   ├── job-details-header.tsx        # Job details header component
│   ├── vbr-restore-points-calendar.tsx # VBR Calendar View
│   ├── vbm-restore-points-calendar.tsx # VBM Calendar View
│   ├── hexgrid-protection-view.tsx   # HexGrid protection visualization
│   └── ...                           # Various data tables
├── lib/
│   ├── api/
│   │   └── veeam-client.ts           # API client utilities
│   ├── types/
│   │   ├── veeam.ts                  # VBR TypeScript types
│   │   └── vbm.ts                    # VBM TypeScript types
│   └── utils/
│       ├── utils.ts                  # General utilities
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
