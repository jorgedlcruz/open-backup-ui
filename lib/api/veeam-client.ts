// Veeam Backup & Replication API Client
// This client now uses Next.js API routes to avoid CORS issues

import {
  VeeamBackupJob,
  VeeamSession,
  JobsResult,
  SessionsResult,
  VeeamApiError,
  ManagedServer,
  ManagedServersResult,
  RepositoryModel,
  RepositoriesResult,
  LicenseModel,
  MalwareEventModel,
  MalwareEventsResult,
  SecurityBestPracticeItem,
  SecurityBestPracticesResult,
  VeeamTaskSession,
  TaskSessionsResult,
  VRORecoveryPlan,
  PlansResult,
  VeeamBackup,
  VeeamBackupFile,
  BackupsResult,
  VeeamProtectedWorkload,
  VeeamRestorePoint,
  VeeamProtectionGroup,
  ProtectionGroupsResult,
  VeeamDiscoveredEntity,
  DiscoveredEntitiesResult,
  VeeamUnstructuredServer,
  UnstructuredServersResult,
  VeeamCredential,
  VeeamRepositoryDetailed,
  VeeamRepository, // New
  VeeamRepositoryState, // New
  VeeamRepositoryEnriched, // New
  VeeamProxy,
  VeeamProxyState,
  ProxiesResult,
  ProxyStatesResult,
  VeeamInventoryItem,
  InventoryResult,
  InventoryFilter,
  VeeamBackupObject,
  BackupObjectsResult
} from '@/lib/types/veeam';
import { VBMJob, VBMJobsResponse, VBMJobSession, VBMJobSessionsResponse, VBMLicense, VBMHealth, VBMServiceInstance, VBMOrganization, VBMOrganizationsResponse, VBMUsedRepositoriesResponse, VBMUsedRepository, VBMProtectedUser, VBMProtectedUsersResponse, VBMProtectedGroup, VBMProtectedGroupsResponse, VBMProtectedSite, VBMProtectedSitesResponse, VBMProtectedTeam, VBMProtectedTeamsResponse, VBMRestorePoint, VBMRestorePointsResponse, VBMBackupRepository, VBMBackupRepositoriesResponse } from '@/lib/types/vbm';
import { AuthDebouncer, RateLimiter } from '@/lib/utils/rate-limiter';

interface TokenResponse {
  access_token: string;
  token_type: string;
  refresh_token: string;
  expires_in: number;
  '.issued': string;
  '.expires': string;
  username: string;
}

class VeeamApiClient {
  private token: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: Date | null = null;

  // VRO tokens (separate from VBR)
  private vroToken: string | null = null;
  private vroRefreshToken: string | null = null;
  private vroTokenExpiry: Date | null = null;

  // VBM tokens (separate from VBR and VRO)
  private vbmToken: string | null = null;
  private vbmRefreshToken: string | null = null;
  private vbmTokenExpiry: Date | null = null;

  // Rate limiting and debouncing for VBM (1 request per second limit)
  private vbmRateLimiter = new RateLimiter(1);
  private vbmAuthDebouncer = new AuthDebouncer<string>(3000); // Cache auth for 3 seconds

  private async authenticate(): Promise<string> {
    // Check if token exists and is still valid (with 5 minute buffer)
    if (this.token && this.tokenExpiry) {
      const now = new Date();
      const bufferMs = 5 * 60 * 1000; // 5 minutes
      if (now.getTime() < this.tokenExpiry.getTime() - bufferMs) {
        return this.token;
      }

      // Token expired, try to refresh if we have a refresh token
      if (this.refreshToken) {
        try {
          return await this.refreshAccessToken();
        } catch (error) {
          console.warn('Token refresh failed, re-authenticating:', error);
          // Fall through to full authentication
        }
      }
    }

    try {
      const response = await fetch('/api/veeam/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ grant_type: 'password' }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Authentication failed: ${response.status}`);
      }

      const data: TokenResponse = await response.json();
      this.token = data.access_token;
      this.refreshToken = data.refresh_token;

      // Calculate token expiry (expires_in is in seconds)
      this.tokenExpiry = new Date(Date.now() + data.expires_in * 1000);

      return this.token;
    } catch (error) {
      console.error('Authentication error:', error);
      throw error;
    }
  }

  private async refreshAccessToken(): Promise<string> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await fetch('/api/veeam/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Token refresh failed: ${response.status}`);
      }

      const data: TokenResponse = await response.json();
      this.token = data.access_token;
      this.refreshToken = data.refresh_token;
      this.tokenExpiry = new Date(Date.now() + data.expires_in * 1000);

      return this.token;
    } catch (error) {
      // Clear tokens on refresh failure
      this.token = null;
      this.refreshToken = null;
      this.tokenExpiry = null;
      throw error;
    }
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const token = await this.authenticate();

    const url = `/api/veeam${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    // Handle empty responses (204 No Content)
    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text };
    }

    if (!response.ok) {
      const errorMessage = data.error || data.message || `API request failed: ${response.status} ${response.statusText}`;
      // Throw a proper Error object so that calling code (like catch blocks) can access .message
      throw new Error(errorMessage);
    }

    return data as T;
  }

  async logout(): Promise<void> {
    // Clear local tokens (server-side logout is handled by token expiration)
    this.token = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
  }

  async getBackupJobs(options?: {
    skip?: number;
    limit?: number;
    orderColumn?: string;
    orderAsc?: boolean;
    nameFilter?: string;
    typeFilter?: string;
  }): Promise<VeeamBackupJob[]> {
    try {
      const params = new URLSearchParams();
      if (options?.skip !== undefined) params.append('skip', options.skip.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.orderAsc !== undefined) params.append('orderAsc', options.orderAsc.toString());
      if (options?.nameFilter) params.append('nameFilter', options.nameFilter);
      if (options?.typeFilter) params.append('typeFilter', options.typeFilter);

      const queryString = params.toString();
      // Use the new /jobs/states endpoint for better performance and more data
      const endpoint = queryString ? `/jobs/states?${queryString}` : '/jobs/states';

      const response = await this.request<JobsResult>(endpoint);
      return response.data || [];
    } catch (error) {
      console.error('Error fetching backup jobs:', error);
      throw error;
    }
  }

  async getBackupJobById(id: string): Promise<VeeamBackupJob> {
    try {
      return await this.request<VeeamBackupJob>(`/jobs/${id}`);
    } catch (error) {
      console.error(`Error fetching backup job ${id}:`, error);
      throw error;
    }
  }

  async startJob(id: string): Promise<void> {
    try {
      await this.request(`/jobs/${id}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'start' }),
      });
    } catch (error) {
      console.error(`Error starting job ${id}:`, error);
      throw error;
    }
  }

  async stopJob(id: string): Promise<void> {
    try {
      await this.request(`/jobs/${id}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'stop' }),
      });
    } catch (error) {
      console.error(`Error stopping job ${id}:`, error);
      throw error;
    }
  }

  async retryJob(id: string): Promise<void> {
    try {
      await this.request(`/jobs/${id}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'retry' }),
      });
    } catch (error) {
      console.error(`Error retrying job ${id}:`, error);
      throw error;
    }
  }

  async disableJob(id: string): Promise<void> {
    try {
      await this.request(`/jobs/${id}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'disable' }),
      });
    } catch (error) {
      console.error(`Error disabling job ${id}:`, error);
      throw error;
    }
  }

  async enableJob(id: string): Promise<void> {
    try {
      await this.request(`/jobs/${id}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'enable' }),
      });
    } catch (error) {
      console.error(`Error enabling job ${id}:`, error);
      throw error;
    }
  }

  async getSessions(options?: {
    skip?: number;
    limit?: number;
    orderColumn?: string;
    orderAsc?: boolean;
    nameFilter?: string;
    jobIdFilter?: string;
    stateFilter?: string;
    resultFilter?: string[];
    createdAfterFilter?: string;
    createdBeforeFilter?: string;
    endedAfterFilter?: string;
    endedBeforeFilter?: string;
  }): Promise<VeeamSession[]> {
    try {
      const params = new URLSearchParams();
      if (options?.skip !== undefined) params.append('skip', options.skip.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.orderColumn) params.append('orderColumn', options.orderColumn);
      if (options?.orderAsc !== undefined) params.append('orderAsc', options.orderAsc.toString());
      if (options?.nameFilter) params.append('nameFilter', options.nameFilter);
      if (options?.jobIdFilter) params.append('jobIdFilter', options.jobIdFilter);
      if (options?.stateFilter) params.append('stateFilter', options.stateFilter);
      if (options?.resultFilter) {
        options.resultFilter.forEach(r => params.append('resultFilter', r));
      }
      if (options?.createdAfterFilter) params.append('createdAfterFilter', options.createdAfterFilter);
      if (options?.createdBeforeFilter) params.append('createdBeforeFilter', options.createdBeforeFilter);
      if (options?.endedAfterFilter) params.append('endedAfterFilter', options.endedAfterFilter);
      if (options?.endedBeforeFilter) params.append('endedBeforeFilter', options.endedBeforeFilter);

      const queryString = params.toString();
      const endpoint = queryString ? `/sessions?${queryString}` : '/sessions';

      const response = await this.request<SessionsResult>(endpoint);
      return response.data || [];
    } catch (error) {
      console.error('Error fetching sessions:', error);
      throw error;
    }
  }

  async getSessionById(id: string): Promise<VeeamSession> {
    try {
      return await this.request<VeeamSession>(`/sessions/${id}`);
    } catch (error) {
      console.error(`Error fetching session ${id}:`, error);
      throw error;
    }
  }

  async getJobSessions(jobId: string, limit: number = 10): Promise<VeeamSession[]> {
    return this.getSessions({
      jobIdFilter: jobId,
      limit,
      orderColumn: 'CreationTime',
      orderAsc: false,
    });
  }

  async getManagedServers(options?: {
    skip?: number;
    limit?: number;
    orderColumn?: string;
    orderAsc?: boolean;
    nameFilter?: string;
    typeFilter?: string;
  }): Promise<ManagedServer[]> {
    try {
      const params = new URLSearchParams();
      if (options?.skip !== undefined) params.append('skip', options.skip.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.orderColumn) params.append('orderColumn', options.orderColumn);
      if (options?.orderAsc !== undefined) params.append('orderAsc', options.orderAsc.toString());
      if (options?.nameFilter) params.append('nameFilter', options.nameFilter);
      if (options?.typeFilter) params.append('typeFilter', options.typeFilter);

      const queryString = params.toString();
      const endpoint = queryString ? `/backupInfrastructure/managedServers?${queryString}` : '/backupInfrastructure/managedServers';

      const response = await this.request<ManagedServersResult>(endpoint);
      return response.data || [];
    } catch (error) {
      console.error('Error fetching managed servers:', error);
      throw error;
    }
  }

  async getRepositories(): Promise<RepositoryModel[]> {
    try {
      const response = await this.request<RepositoriesResult>('/backupInfrastructure/repositories');
      return response.data || [];
    } catch (error) {
      console.error('Error fetching repositories:', error);
      // Return empty array instead of throwing to prevent dashboard crash
      return [];
    }
  }

  // ============================================
  // Backup Proxies
  // ============================================

  async getBackupProxies(options?: { limit?: number; skip?: number }): Promise<VeeamProxy[]> {
    try {
      const params = new URLSearchParams();
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.skip !== undefined) params.append('skip', options.skip.toString());

      const queryString = params.toString();
      const endpoint = queryString ? `/backupInfrastructure/proxies?${queryString}` : '/backupInfrastructure/proxies';

      const response = await this.request<ProxiesResult>(endpoint);
      return response.data || [];
    } catch (error) {
      console.error('Error fetching backup proxies:', error);
      throw error;
    }
  }

  async getBackupProxyStates(options?: { limit?: number; skip?: number }): Promise<VeeamProxyState[]> {
    try {
      const params = new URLSearchParams();
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.skip !== undefined) params.append('skip', options.skip.toString());

      const queryString = params.toString();
      const endpoint = queryString ? `/backupInfrastructure/proxies/states?${queryString}` : '/backupInfrastructure/proxies/states';

      const response = await this.request<ProxyStatesResult>(endpoint);
      return response.data || [];
    } catch (error) {
      console.error('Error fetching backup proxy states:', error);
      throw error;
    }
  }

  async enableBackupProxy(id: string): Promise<void> {
    try {
      await this.request(`/backupInfrastructure/proxies/${id}/enable`, {
        method: 'POST'
      });
    } catch (error) {
      console.error(`Error enabling proxy ${id}:`, error);
      throw error;
    }
  }

  async disableBackupProxy(id: string): Promise<void> {
    try {
      await this.request(`/backupInfrastructure/proxies/${id}/disable`, {
        method: 'POST'
      });
    } catch (error) {
      console.error(`Error disabling proxy ${id}:`, error);
      throw error;
    }
  }

  async deleteBackupProxy(id: string): Promise<void> {
    try {
      await this.request(`/backupInfrastructure/proxies/${id}`, {
        method: 'DELETE'
      });
    } catch (error) {
      console.error(`Error deleting proxy ${id}:`, error);
      throw error;
    }
  }

  async getEnrichedBackupProxies(): Promise<VeeamProxy[]> {
    try {
      const [proxiesRes, statesRes, serversRes] = await Promise.allSettled([
        this.getBackupProxies({ limit: 500 }), // Fetch enough to cover basic needs
        this.getBackupProxyStates({ limit: 500 }),
        this.getManagedServers({ limit: 500 })
      ]);

      const proxies = proxiesRes.status === 'fulfilled' ? proxiesRes.value : [];
      const states = statesRes.status === 'fulfilled' ? statesRes.value : [];
      const servers = serversRes.status === 'fulfilled' ? serversRes.value : [];

      const stateMap = new Map(states.map(s => [s.id, s]));
      const serverMap = new Map(servers.map(s => [s.id, s]));

      return proxies.map(proxy => {
        const state = stateMap.get(proxy.id);
        const server = serverMap.get(proxy.server.hostId);

        // Calculate final name: Use managed server name if available, especially if hostName is "This server"
        // User requested extracting "final name" from managed server call.
        const derivedName = server ? server.name : proxy.name;

        return {
          ...proxy,
          name: derivedName, // Use the managed server name as the primary name
          description: server?.description || proxy.description, // Prefer server description
          osType: server?.type,
          isOnline: state?.isOnline,
          isDisabled: state?.isDisabled,
          isOutOfDate: state?.isOutOfDate,
          isVBRLinuxAppliance: server?.isVBRLinuxAppliance
        };
      });
    } catch (error) {
      console.error('Error fetching enriched proxies:', error);
      return [];
    }
  }

  async getLicenseInfo(): Promise<LicenseModel | null> {
    try {
      // The API endpoint might return direct model or wrapped
      // Based on Swagger proxy: /api/v1/license
      return await this.request<LicenseModel>('/license');
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      // Check if it's a permission error
      if (err?.status === 403 || err?.message?.includes('403') || err?.message?.includes('Permission denied')) {
        console.warn('⚠️ License info unavailable: User lacks GetInstalledLicense permission (Veeam Backup Administrator role required)');
      } else {
        console.error('Error fetching license info:', error);
      }
      return null;
    }
  }

  async getMalwareEvents(options?: {
    limit?: number;
  }): Promise<MalwareEventModel[]> {
    try {
      const params = new URLSearchParams();
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());

      const queryString = params.toString();
      const endpoint = queryString ? `/malware-detection?${queryString}` : '/malware-detection';

      const response = await this.request<MalwareEventsResult>(endpoint);
      return response.data || [];
    } catch (error) {
      console.error('Error fetching malware events:', error);
      return [];
    }
  }

  async getSecurityBestPractices(): Promise<SecurityBestPracticeItem[]> {
    try {
      const response = await this.request<SecurityBestPracticesResult>('/security/best-practices');
      return response.items || [];
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      // Check if it's a permission error
      if (err?.status === 403 || err?.message?.includes('403') || err?.message?.includes('Permission denied')) {
        console.warn('⚠️ Security best practices unavailable: User lacks GetBestPracticesComplianceResult permission (Veeam Backup/Security Administrator role required)');
      } else {
        console.error('Error fetching security best practices:', error);
      }
      return [];
    }
  }

  async getSessionTasks(sessionId: string): Promise<VeeamTaskSession[]> {
    try {
      // Fetch details including task sessions
      const response = await this.request<TaskSessionsResult>(`/sessions/${sessionId}/tasks`);
      return response.data || [];
    } catch (error) {
      console.error(`Error fetching tasks for session ${sessionId}:`, error);
      throw error;
    }
  }

  async getProtectedData(): Promise<VeeamProtectedWorkload[]> {
    try {
      const token = await this.authenticate();
      const response = await fetch('/api/vbr/protected-data', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch protected data: ${response.statusText}`);
      }

      const result = await response.json();
      return result.data || [];
    } catch (error) {
      console.error('Error fetching protected data:', error);
      throw error;
    }
  }

  async getBackupFiles(backupId: string): Promise<VeeamBackupFile[]> {
    try {
      const token = await this.authenticate();
      const response = await fetch(`/api/vbr/backups/${backupId}/files`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch backup files: ${response.statusText}`);
      }

      const result = await response.json();
      return result.data || [];
    } catch (error) {
      console.error(`Error fetching backup files for ${backupId}:`, error);
      throw error;
    }
  }



  async getVBRRestorePoints(params: { objectId?: string, backupId?: string }): Promise<VeeamRestorePoint[]> {
    try {
      const token = await this.authenticate();
      const query = new URLSearchParams();
      if (params.objectId) query.append('objectId', params.objectId);
      if (params.backupId) query.append('backupId', params.backupId);

      const response = await fetch(`/api/vbr/restore-points?${query.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch restore points: ${response.statusText}`);
      }

      const result = await response.json();
      return result.data || [];
    } catch (error) {
      console.error('Error fetching VBR restore points:', error);
      throw error;
    }
  }

  // ============================================
  // Inventory & Protection Groups
  // ============================================

  async getProtectionGroups(options?: {
    skip?: number;
    limit?: number;
    orderColumn?: string;
    orderAsc?: boolean;
    nameFilter?: string;
    typeFilter?: string;
  }): Promise<VeeamProtectionGroup[]> {
    try {
      const params = new URLSearchParams();
      if (options?.skip !== undefined) params.append('skip', options.skip.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.orderColumn) params.append('orderColumn', options.orderColumn);
      if (options?.orderAsc !== undefined) params.append('orderAsc', options.orderAsc.toString());
      if (options?.nameFilter) params.append('nameFilter', options.nameFilter);
      if (options?.typeFilter) params.append('typeFilter', options.typeFilter);

      const queryString = params.toString();
      const endpoint = queryString ? `/agents/protectionGroups?${queryString}` : '/agents/protectionGroups';

      const response = await this.request<ProtectionGroupsResult>(endpoint);
      return response.data || [];
    } catch (error) {
      console.error('Error fetching protection groups:', error);
      throw error;
    }
  }

  async getProtectionGroupById(id: string): Promise<VeeamProtectionGroup> {
    try {
      return await this.request<VeeamProtectionGroup>(`/agents/protectionGroups/${id}`);
    } catch (error) {
      console.error(`Error fetching protection group ${id}:`, error);
      throw error;
    }
  }

  async rescanProtectionGroup(id: string): Promise<void> {
    try {
      await this.request(`/agents/protectionGroups/${id}/rescan`, {
        method: 'POST'
      });
    } catch (error) {
      console.error(`Error rescanning protection group ${id}:`, error);
      throw error;
    }
  }

  async enableProtectionGroup(id: string): Promise<void> {
    try {
      await this.request(`/agents/protectionGroups/${id}/enable`, {
        method: 'POST'
      });
    } catch (error) {
      console.error(`Error enabling protection group ${id}:`, error);
      throw error;
    }
  }

  async disableProtectionGroup(id: string): Promise<void> {
    try {
      await this.request(`/agents/protectionGroups/${id}/disable`, {
        method: 'POST'
      });
    } catch (error) {
      console.error(`Error disabling protection group ${id}:`, error);
      throw error;
    }
  }

  async getDiscoveredEntities(groupId: string, options?: {
    skip?: number;
    limit?: number;
    orderColumn?: string;
    orderAsc?: boolean;
    nameFilter?: string;
    typeFilter?: string;
  }): Promise<VeeamDiscoveredEntity[]> {
    try {
      const params = new URLSearchParams();
      if (options?.skip !== undefined) params.append('skip', options.skip.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.orderColumn) params.append('orderColumn', options.orderColumn);
      if (options?.orderAsc !== undefined) params.append('orderAsc', options.orderAsc.toString());
      if (options?.nameFilter) params.append('nameFilter', options.nameFilter);
      if (options?.typeFilter) params.append('typeFilter', options.typeFilter);

      const queryString = params.toString();
      const endpoint = queryString
        ? `/agents/protectionGroups/${groupId}/discoveredEntities?${queryString}`
        : `/agents/protectionGroups/${groupId}/discoveredEntities`;

      const response = await this.request<DiscoveredEntitiesResult>(endpoint);
      return response.data || [];
    } catch (error) {
      console.error(`Error fetching discovered entities for group ${groupId}:`, error);
      throw error;
    }
  }

  // Discovered Entity Actions
  private async performDiscoveredEntityAction(groupId: string, action: string, entityIds: string[]): Promise<void> {
    try {
      await this.request(`/agents/protectionGroups/${groupId}/discoveredEntities/${action}`, {
        method: 'POST',
        body: JSON.stringify({ entityIds })
      });
    } catch (error) {
      console.error(`Error performing ${action} on entities in group ${groupId}:`, error);
      throw error;
    }
  }

  async rescanDiscoveredEntities(groupId: string, entityIds: string[]): Promise<void> {
    await this.performDiscoveredEntityAction(groupId, 'rescan', entityIds);
  }

  async installAgent(groupId: string, entityIds: string[]): Promise<void> {
    await this.performDiscoveredEntityAction(groupId, 'installAgent', entityIds);
  }

  async uninstallAgent(groupId: string, entityIds: string[]): Promise<void> {
    await this.performDiscoveredEntityAction(groupId, 'uninstallAgent', entityIds);
  }

  async upgradeAgent(groupId: string, entityIds: string[]): Promise<void> {
    await this.performDiscoveredEntityAction(groupId, 'upgradeAgent', entityIds);
  }

  async installCBTDriver(groupId: string, entityIds: string[]): Promise<void> {
    await this.performDiscoveredEntityAction(groupId, 'installCBTDriver', entityIds);
  }

  async uninstallCBTDriver(groupId: string, entityIds: string[]): Promise<void> {
    await this.performDiscoveredEntityAction(groupId, 'uninstallCBTDriver', entityIds);
  }


  async uninstallAllComponents(groupId: string, entityIds: string[]): Promise<void> {
    await this.performDiscoveredEntityAction(groupId, 'uninstallAllComponents', entityIds);
  }

  // ============================================
  // Unstructured Data
  // ============================================

  async getUnstructuredServers(): Promise<VeeamUnstructuredServer[]> {
    try {
      const response = await this.request<UnstructuredServersResult>('/inventory/unstructuredDataServers?limit=200');
      const servers = response.data || [];

      // Enrich with credentials and repository info
      const enrichedServers = await Promise.all(servers.map(async (server) => {
        let enriched = { ...server };

        // Enrich Credentials
        if (server.accessCredentialsId) {
          try {
            const cred = await this.request<VeeamCredential>(`/credentials/${server.accessCredentialsId}`);
            enriched.credentialsName = cred.username;
            enriched.credentialsDescription = cred.description ? ` (${cred.description})` : '';
            enriched.credentialsUserName = cred.username;
            enriched.credentialsCreationTime = cred.creationTime;
          } catch {
            console.warn(`Failed to fetch credentials for server ${server.id}`);
          }
        }

        // Enrich Repository (Cache)
        if (server.processing?.cacheRepositoryId) {
          try {
            const repo = await this.request<VeeamRepositoryDetailed>(`/backupInfrastructure/repositories/${server.processing.cacheRepositoryId}`);
            enriched.repositoryName = repo.name;
            enriched.repositoryDescription = repo.description;
          } catch {
            console.warn(`Failed to fetch repository for server ${server.id}`);
          }
        }

        return enriched;
      }));

      return enrichedServers;
    } catch (error) {
      console.error('Error fetching unstructured servers:', error);
      throw error;
    }
  }

  async deleteUnstructuredServer(id: string): Promise<void> {
    try {
      await this.request(`/inventory/unstructuredDataServers/${id}`, {
        method: 'DELETE'
      });
    } catch (error) {
      console.error(`Error deleting unstructured server ${id}:`, error);
      throw error;
    }
  }

  // ============================================
  // Virtual Infrastructure Inventory
  // ============================================

  async getInventory(filter?: InventoryFilter): Promise<VeeamInventoryItem[]> {
    try {
      // 1. Get root objects (vCenters/Servers)
      // We fetch the root nodes first.
      const rootResponse = await this.request<InventoryResult>('/inventory?limit=5000', {
        method: 'POST',
        body: JSON.stringify({})
      });

      const rootItems = rootResponse.data || [];
      const allItems: VeeamInventoryItem[] = [...rootItems];

      // 2. Identify drill-down targets (e.g., vCenterServer)
      // We want to drill down into platforms that hold VMs.
      // Based on user feedback: "type": "vCenterServer"
      const platformsToDrill = ['vCenterServer', 'VMC', 'HyperV', 'SCVMMServer'];

      const drillTargets = rootItems.filter(item => platformsToDrill.includes(item.type));

      // 3. Drill down into each target
      const drillPromises = drillTargets.map(async (target) => {
        try {
          // Use the item's name (e.g., vcsa.jorgedelacruz.es) to fetch its children
          if (!target.name) return [];

          const drillResponse = await this.request<InventoryResult>(`/inventory/${target.name}?limit=5000`, {
            method: 'POST',
            body: JSON.stringify({}) // Fetch everything for this host
          });
          return drillResponse.data || [];
        } catch (e) {
          console.warn(`Failed to drill down into ${target.name}`, e);
          return [];
        }
      });

      const drilledResults = await Promise.all(drillPromises);

      drilledResults.forEach(items => {
        allItems.push(...items);
      });

      return allItems;

    } catch (error) {
      console.error('Error fetching inventory:', error);
      throw error;
    }
  }




  // Cache for global search
  private searchInventory: any[] = [];
  private inventoryLastUpdated: number = 0;
  private readonly INVENTORY_TTL = 30 * 60 * 1000; // 30 minutes

  private async ensureInventory(): Promise<void> {
    const now = Date.now();
    if (this.searchInventory.length > 0 && (now - this.inventoryLastUpdated < this.INVENTORY_TTL)) {
      return;
    }

    try {
      // Fetch everything without filters



      const [
        vbrJobsRes,
        vbrObjectsRes,
        vbmJobsRes,
        vbmUsersRes,
        vbmGroupsRes,
        vbmSitesRes,
        vbmTeamsRes
      ] = await Promise.allSettled([

        this.getBackupJobs({}), // No filter
        this.getProtectedData(),
        this.requestVBM<any>('/jobs?limit=5000'),
        this.requestVBM<any>('/ProtectedUsers?limit=5000'),
        this.requestVBM<any>('/ProtectedGroups?limit=5000'),
        this.requestVBM<any>('/ProtectedSites?limit=5000'),
        this.requestVBM<any>('/ProtectedTeams?limit=5000')
      ]);

      const newInventory: any[] = [];

      // Process VBR Jobs
      if (vbrJobsRes.status === 'fulfilled') {
        vbrJobsRes.value.forEach(job => {
          newInventory.push({
            id: job.id,
            name: job.name,
            type: 'VBR Job',
            url: `/vbr/jobs/${job.id}`,
            description: job.type,
            searchStr: (job.name || '').toLowerCase()
          });
        });
      }

      // Process VBR Workloads
      if (vbrObjectsRes.status === 'fulfilled') {
        vbrObjectsRes.value.forEach(obj => {
          newInventory.push({
            id: obj.id,
            name: obj.name,
            type: 'VBR Workload',
            url: `/vbr/protected-data/restore-points?objectId=${obj.id}&name=${encodeURIComponent(obj.name)}`,
            description: obj.platformName,
            searchStr: (obj.name || '').toLowerCase()
          });
        });
      }

      // Process VBM Jobs
      if (vbmJobsRes.status === 'fulfilled') {
        const jobs = vbmJobsRes.value.results || [];
        jobs.forEach((job: any) => {
          newInventory.push({
            id: job.id,
            name: job.name,
            type: 'VB365 Job',
            url: `/vb365/jobs/${job.id}/sessions`,
            description: job.description,
            searchStr: (job.name || '').toLowerCase()
          });
        });
      }

      // Helper for VBM Items
      const processVbmItems = (res: PromiseSettledResult<any>, type: string) => {
        if (res.status === 'fulfilled') {
          const items = res.value.results || [];
          items.forEach((item: any) => {
            const displayName = item.displayName || item.name || item.url || '';
            const searchTerms = [
              displayName,
              item.email,
              item.description
            ].filter(Boolean).join(' ').toLowerCase();

            newInventory.push({
              id: item.id,
              name: displayName,
              type: 'VB365 Item',
              url: `/vbm/protected-items/restore-points?type=${type}&id=${item.id}&name=${encodeURIComponent(displayName)}`,
              description: `${type} • ${item.email || item.description || ''}`,
              searchStr: searchTerms
            });
          });
        }
      };

      processVbmItems(vbmUsersRes, 'User');
      processVbmItems(vbmGroupsRes, 'Group');
      processVbmItems(vbmSitesRes, 'Site');
      processVbmItems(vbmTeamsRes, 'Team');

      this.searchInventory = newInventory;
      this.inventoryLastUpdated = now;

    } catch (error) {
      console.error('Error building search inventory:', error);
      // Keep old inventory if update fails
    }
  }

  async globalSearch(query: string): Promise<any[]> {
    if (!query || query.length < 2) return [];

    // Ensure we have data
    await this.ensureInventory();

    const lowerQuery = query.toLowerCase();

    // Perform filtering in memory
    const results = this.searchInventory.filter(item =>
      item.searchStr.includes(lowerQuery)
    );

    // Sort by name
    results.sort((a, b) => a.name.localeCompare(b.name));

    // Limit results
    return results.slice(0, 20);
  }

  // ============================================
  // Veeam Recovery Orchestrator (VRO) Methods
  // ============================================

  private async authenticateVRO(): Promise<string> {
    // Check if token exists and is still valid (with 5 minute buffer)
    if (this.vroToken && this.vroTokenExpiry) {
      const now = new Date();
      const bufferMs = 5 * 60 * 1000; // 5 minutes
      if (now.getTime() < this.vroTokenExpiry.getTime() - bufferMs) {
        return this.vroToken;
      }

      // Token expired, try to refresh if we have a refresh token
      if (this.vroRefreshToken) {
        try {
          return await this.refreshVROAccessToken();
        } catch (error) {
          console.warn('VRO token refresh failed, re-authenticating:', error);
          // Fall through to full authentication
        }
      }
    }

    try {
      const response = await fetch('/api/vro/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ grant_type: 'password' }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `VRO authentication failed: ${response.status}`);
      }

      const data: TokenResponse = await response.json();
      this.vroToken = data.access_token;
      this.vroRefreshToken = data.refresh_token;

      // Calculate token expiry (expires_in is in seconds)
      this.vroTokenExpiry = new Date(Date.now() + data.expires_in * 1000);

      return this.vroToken;
    } catch (error) {
      console.error('VRO authentication error:', error);
      throw error;
    }
  }

  private async refreshVROAccessToken(): Promise<string> {
    if (!this.vroRefreshToken) {
      throw new Error('No VRO refresh token available');
    }

    try {
      const response = await fetch('/api/vro/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: this.vroRefreshToken,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `VRO token refresh failed: ${response.status}`);
      }

      const data: TokenResponse = await response.json();
      this.vroToken = data.access_token;
      this.vroRefreshToken = data.refresh_token;
      this.vroTokenExpiry = new Date(Date.now() + data.expires_in * 1000);

      return this.vroToken;
    } catch (error) {
      // Clear tokens on refresh failure
      this.vroToken = null;
      this.vroRefreshToken = null;
      this.vroTokenExpiry = null;
      throw error;
    }
  }

  private async requestVRO<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const token = await this.authenticateVRO();

    const url = `/api/vro${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      const error: VeeamApiError = {
        message: errorData.error || `VRO API request failed: ${response.status} ${response.statusText}`,
        code: response.status.toString(),
      };
      throw error;
    }

    return response.json();
  }

  async getRecoveryPlans(options?: {
    start?: number;
    limit?: number;
    onlyEnabled?: boolean;
  }): Promise<VRORecoveryPlan[]> {
    try {
      const params = new URLSearchParams();
      if (options?.start !== undefined) params.append('start', options.start.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.onlyEnabled !== undefined) params.append('onlyEnabled', options.onlyEnabled.toString());

      const queryString = params.toString();
      const endpoint = queryString ? `/plans?${queryString}` : '/plans';

      const response = await this.requestVRO<PlansResult>(endpoint);
      return response.data || [];
    } catch (error) {
      console.error('Error fetching recovery plans:', error);
      throw error;
    }
  }

  async getRecoveryPlanById(id: string): Promise<VRORecoveryPlan> {
    try {
      return await this.requestVRO<VRORecoveryPlan>(`/plans/${id}`);
    } catch (error) {
      console.error(`Error fetching recovery plan ${id}:`, error);
      throw error;
    }
  }

  async logoutVRO(): Promise<void> {
    // Clear local VRO tokens
    this.vroToken = null;
    this.vroRefreshToken = null;
    this.vroTokenExpiry = null;
  }

  // ============================================
  // Veeam Backup for Microsoft 365 (VBM) Methods
  // ============================================

  private async authenticateVBM(): Promise<string> {
    // Use debouncer to prevent multiple simultaneous auth calls
    return this.vbmAuthDebouncer.execute(async () => {
      // Check if token exists and is still valid (with 5 minute buffer)
      if (this.vbmToken && this.vbmTokenExpiry) {
        const now = new Date();
        const bufferMs = 5 * 60 * 1000; // 5 minutes
        if (now.getTime() < this.vbmTokenExpiry.getTime() - bufferMs) {
          return this.vbmToken;
        }

        // Token expired, try to refresh if we have a refresh token
        if (this.vbmRefreshToken) {
          try {
            return await this.refreshVBMAccessToken();
          } catch (error) {
            console.warn('VBM token refresh failed, re-authenticating:', error);
            // Fall through to full authentication
          }
        }
      }

      try {
        const response = await fetch('/api/vbm/auth', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ grant_type: 'password' }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `VBM authentication failed: ${response.status}`);
        }

        const data: TokenResponse = await response.json();
        this.vbmToken = data.access_token;
        this.vbmRefreshToken = data.refresh_token;

        // Calculate token expiry (expires_in is in seconds)
        this.vbmTokenExpiry = new Date(Date.now() + data.expires_in * 1000);

        return this.vbmToken;
      } catch (error) {
        console.error('VBM authentication error:', error);
        throw error;
      }
    });
  }

  private async refreshVBMAccessToken(): Promise<string> {
    if (!this.vbmRefreshToken) {
      throw new Error('No VBM refresh token available');
    }

    try {
      const response = await fetch('/api/vbm/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: this.vbmRefreshToken,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `VBM token refresh failed: ${response.status}`);
      }

      const data: TokenResponse = await response.json();
      this.vbmToken = data.access_token;
      this.vbmRefreshToken = data.refresh_token;
      this.vbmTokenExpiry = new Date(Date.now() + data.expires_in * 1000);

      return this.vbmToken;
    } catch (error) {
      // Clear tokens on refresh failure
      this.vbmToken = null;
      this.vbmRefreshToken = null;
      this.vbmTokenExpiry = null;
      throw error;
    }
  }

  private async requestVBM<T>(endpoint: string, options?: RequestInit): Promise<T> {
    // Use rate limiter to ensure we don't exceed API quota (1 req/sec)
    return this.vbmRateLimiter.execute(async () => {
      const token = await this.authenticateVBM();

      const url = `/api/vbm${endpoint}`;

      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      // Handle empty responses (204 No Content)
      if (response.status === 204) {
        return {} as T;
      }

      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { error: text };
      }

      if (!response.ok) {
        const errorMessage = data.error || data.message || `VBM API request failed: ${response.status} ${response.statusText}`;
        // Throw a proper Error object so that calling code (like catch blocks) can access .message
        throw new Error(errorMessage);
      }

      return data as T;
    });
  }

  async getVBMJobs(options?: {
    offset?: number;
    limit?: number;
  }): Promise<VBMJob[]> {
    try {
      const params = new URLSearchParams();
      if (options?.offset !== undefined) params.append('offset', options.offset.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());

      const queryString = params.toString();
      const endpoint = queryString ? `/jobs?${queryString}` : '/jobs';

      const response = await this.requestVBM<VBMJobsResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error('Error fetching VBM jobs:', error);
      throw error;
    }
  }

  async startVBMJob(jobId: string): Promise<void> {
    try {
      await this.requestVBM(`/jobs/${jobId}/start`, {
        method: 'POST',
      });
    } catch (error) {
      console.error(`Error starting VBM job ${jobId}:`, error);
      throw error;
    }
  }

  async stopVBMJob(jobId: string): Promise<void> {
    try {
      await this.requestVBM(`/jobs/${jobId}/stop`, {
        method: 'POST',
      });
    } catch (error) {
      console.error(`Error stopping VBM job ${jobId}:`, error);
      throw error;
    }
  }

  async enableVBMJob(jobId: string): Promise<void> {
    try {
      await this.requestVBM(`/jobs/${jobId}/enable`, {
        method: 'POST',
      });
    } catch (error) {
      console.error(`Error enabling VBM job ${jobId}:`, error);
      throw error;
    }
  }

  async disableVBMJob(jobId: string): Promise<void> {
    try {
      await this.requestVBM(`/jobs/${jobId}/disable`, {
        method: 'POST',
      });
    } catch (error) {
      console.error(`Error disabling VBM job ${jobId}:`, error);
      throw error;
    }
  }

  async getVBMJobSessions(jobId?: string, options?: {
    offset?: number;
    limit?: number;
    endTimeLowerBound?: string;
  }): Promise<VBMJobSession[]> {
    try {
      const params = new URLSearchParams();
      // Use proper server-side filtering with jobId parameter
      if (jobId) params.append('jobId', jobId);
      if (options?.offset !== undefined) params.append('offset', options.offset.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.endTimeLowerBound) params.append('endTimeLowerBound', options.endTimeLowerBound);

      const queryString = params.toString();
      const endpoint = queryString ? `/JobSessions?${queryString}` : '/JobSessions';

      const response = await this.requestVBM<VBMJobSessionsResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error(`Error fetching VBM sessions for job ${jobId}:`, error);
      throw error;
    }
  }

  async getVBMLicense(): Promise<VBMLicense> {
    return this.requestVBM<VBMLicense>('/License')
  }

  async getVBMHealth(): Promise<VBMHealth> {
    return this.requestVBM<VBMHealth>('/Health')
  }

  async getBackups(params: { limit?: number; offset?: number } = {}): Promise<VeeamBackup[]> {
    try {
      const searchParams = new URLSearchParams();
      if (params.limit !== undefined) searchParams.append('limit', params.limit.toString());
      if (params.offset !== undefined) searchParams.append('offset', params.offset.toString());

      const queryString = searchParams.toString();
      const endpoint = queryString ? `/backups?${queryString}` : '/backups';
      const response = await this.request<BackupsResult>(endpoint);
      return response.data || [];
    } catch (error) {
      console.error('Error fetching backups:', error);
      return [];
    }
  }



  async getVBMServiceInstance(): Promise<VBMServiceInstance> {
    return this.requestVBM<VBMServiceInstance>('/ServiceInstance')
  }

  async getVBMOrganizations(options?: {
    offset?: number;
    limit?: number;
    extendedView?: boolean;
  }): Promise<VBMOrganization[]> {
    try {
      const params = new URLSearchParams();
      if (options?.offset !== undefined) params.append('offset', options.offset.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      if (options?.extendedView !== undefined) params.append('extendedView', options.extendedView.toString());

      const queryString = params.toString();
      const endpoint = queryString ? `/Organizations?${queryString}` : '/Organizations';

      const response = await this.requestVBM<VBMOrganizationsResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error('Error fetching VBM organizations:', error);
      throw error;
    }
  }

  async getVBMOrganizationUsedRepositories(orgId: string): Promise<VBMUsedRepository[]> {
    try {
      const response = await this.requestVBM<VBMUsedRepositoriesResponse>(`/Organizations/${orgId}/usedRepositories`);
      return response.results || [];
    } catch (error) {
      console.error(`Error fetching used repositories for org ${orgId}:`, error);
      // Return empty array instead of throwing to prevent dashboard calculation failure from one bad org
      return [];
    }
  }

  async getVBMProtectedUsers(options?: { offset?: number; limit?: number }): Promise<VBMProtectedUser[]> {
    try {
      const params = new URLSearchParams();
      if (options?.offset !== undefined) params.append('offset', options.offset.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      const queryString = params.toString();
      const endpoint = queryString ? `/ProtectedUsers?${queryString}` : '/ProtectedUsers';
      const response = await this.requestVBM<VBMProtectedUsersResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error('Error fetching VBM protected users:', error);
      return [];
    }
  }

  async getVBMProtectedGroups(options?: { offset?: number; limit?: number }): Promise<VBMProtectedGroup[]> {
    try {
      const params = new URLSearchParams();
      if (options?.offset !== undefined) params.append('offset', options.offset.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      const queryString = params.toString();
      const endpoint = queryString ? `/ProtectedGroups?${queryString}` : '/ProtectedGroups';
      const response = await this.requestVBM<VBMProtectedGroupsResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error('Error fetching VBM protected groups:', error);
      return [];
    }
  }

  async getVBMProtectedSites(options?: { offset?: number; limit?: number }): Promise<VBMProtectedSite[]> {
    try {
      const params = new URLSearchParams();
      if (options?.offset !== undefined) params.append('offset', options.offset.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      const queryString = params.toString();
      const endpoint = queryString ? `/ProtectedSites?${queryString}` : '/ProtectedSites';
      const response = await this.requestVBM<VBMProtectedSitesResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error('Error fetching VBM protected sites:', error);
      return [];
    }
  }

  async getVBMProtectedTeams(options?: { offset?: number; limit?: number }): Promise<VBMProtectedTeam[]> {
    try {
      const params = new URLSearchParams();
      if (options?.offset !== undefined) params.append('offset', options.offset.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      const queryString = params.toString();
      const endpoint = queryString ? `/ProtectedTeams?${queryString}` : '/ProtectedTeams';
      const response = await this.requestVBM<VBMProtectedTeamsResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error('Error fetching VBM protected teams:', error);
      return [];
    }
  }

  async getVBMRestorePoints(params: {
    userId?: string;
    groupId?: string;
    siteId?: string;
    teamId?: string;
    limit?: number;
    offset?: number;
  }): Promise<VBMRestorePoint[]> {
    try {
      const searchParams = new URLSearchParams();
      if (params.userId) searchParams.append('userId', params.userId);
      if (params.groupId) searchParams.append('groupId', params.groupId);
      if (params.siteId) searchParams.append('siteId', params.siteId);
      if (params.teamId) searchParams.append('teamId', params.teamId);
      if (params.limit !== undefined) searchParams.append('limit', params.limit.toString());
      if (params.offset !== undefined) searchParams.append('offset', params.offset.toString());

      const queryString = searchParams.toString();
      const endpoint = queryString ? `/RestorePoints?${queryString}` : '/RestorePoints';
      const response = await this.requestVBM<VBMRestorePointsResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error('Error fetching VBM restore points:', error);
      return [];
    }
  }

  async getVBMBackupRepositories(options?: { offset?: number; limit?: number }): Promise<VBMBackupRepository[]> {
    try {
      const params = new URLSearchParams();
      if (options?.offset !== undefined) params.append('offset', options.offset.toString());
      if (options?.limit !== undefined) params.append('limit', options.limit.toString());
      const queryString = params.toString();
      const endpoint = queryString ? `/BackupRepositories?${queryString}` : '/BackupRepositories';
      const response = await this.requestVBM<VBMBackupRepositoriesResponse>(endpoint);
      return response.results || [];
    } catch (error) {
      console.error('Error fetching VBM backup repositories:', error);
      return [];
    }
  }


  // ============================================
  // Backup Objects (Protection Status)
  // ============================================

  async getAllBackupObjects(): Promise<VeeamBackupObject[]> {
    try {
      const allObjects: VeeamBackupObject[] = [];
      let skip = 0;
      const limit = 500; // Fetch in chunks
      let hasMore = true;

      while (hasMore) {
        const response = await this.request<BackupObjectsResult>(`/backupObjects?skip=${skip}&limit=${limit}`);
        const items = response.data || [];

        if (items.length > 0) {
          allObjects.push(...items);
          skip += limit;
        }

        // If we got fewer items than limit, we're done
        if (items.length < limit) {
          hasMore = false;
        }

        // Safety break for extremely large envs to prevent infinite loops if API misbehaves
        if (allObjects.length > 20000) {
          console.warn('Backup objects limit reached (20k), stopping fetch.');
          hasMore = false;
        }
      }

      return allObjects;
    } catch (error) {
      console.error('Error fetching all backup objects:', error);
      return [];
    }
  }
  // ============================================
  // Backup Infrastructure: Repositories
  // ============================================

  async getBackupRepositories(): Promise<VeeamRepository[]> {
    try {
      // Use internal API route which proxies to /api/v1/backupInfrastructure/repositories
      const response = await this.request<{ data: VeeamRepository[] }>('/backupInfrastructure/repositories');
      return response.data;
    } catch (error) {
      console.error('Failed to get backup repositories:', error);
      throw error;
    }
  }

  async getBackupRepositoryStates(): Promise<VeeamRepositoryState[]> {
    try {
      const response = await this.request<{ data: VeeamRepositoryState[] }>('/backupInfrastructure/repositories/states');
      return response.data;
    } catch (error) {
      console.error('Failed to get backup repository states:', error);
      throw error;
    }
  }

  async getEnrichedBackupRepositories(): Promise<VeeamRepositoryEnriched[]> {
    try {
      const [repos, states] = await Promise.all([
        this.getBackupRepositories(),
        this.getBackupRepositoryStates()
      ]);

      const repoMap = new Map(repos.map(r => [r.id, r]));

      return states.map(state => {
        const repo = repoMap.get(state.id);

        // Extract config details
        let taskLimitEnabled = false;
        let maxTaskCount = 0;
        let immutabilityEnabled = false;
        let immutabilityDays = 0;
        let perVmBackup = false;

        if (repo) {
          // Task limits are usually in repository object
          if (repo.repository) {
            taskLimitEnabled = repo.repository.taskLimitEnabled ?? false;
            maxTaskCount = repo.repository.maxTaskCount ?? 0;
            if (repo.repository.advancedSettings) {
              perVmBackup = repo.repository.advancedSettings.perVmBackup ?? false;
            }
          }

          // Immutability in bucket for object storage
          if (repo.bucket?.immutability) {
            immutabilityEnabled = repo.bucket.immutability.isEnabled;
            immutabilityDays = repo.bucket.immutability.daysCount;
          } else if (repo.type === 'LinuxHardened' && repo.repository) {
            // Hardened repository immutability often corresponds to 'makeRecentBackupsImmutableDays' 
            // but the user JSON shows it at the top level of repository object for LinuxHardened?
            // Wait, checking user JSON: 
            // "repository": { "makeRecentBackupsImmutableDays": 7, ... }
            // I need to update my VeeamRepository type to include this field if it's there.
            // Let's add dynamic access or update type.
            const anyRepo = repo.repository as any;
            if (anyRepo.makeRecentBackupsImmutableDays) {
              immutabilityEnabled = true;
              immutabilityDays = anyRepo.makeRecentBackupsImmutableDays;
            }
          }
        }

        return {
          ...state,
          taskLimitEnabled,
          maxTaskCount,
          immutabilityEnabled,
          immutabilityDays,
          perVmBackup
        };
      });

    } catch (error) {
      console.error('Failed to get enriched backup repositories:', error);
      throw error;
    }
  }

  async rescanBackupRepository(ids: string[]): Promise<any> {
    try {
      return await this.request('/backupInfrastructure/repositories/rescan', {
        method: 'POST',
        body: JSON.stringify({ repositoryIds: ids })
      });
    } catch (error) {
      console.error('Failed to rescan backup repository:', error);
      throw error;
    }
  }

  async deleteBackupRepository(id: string): Promise<any> {
    try {
      return await this.request(`/backupInfrastructure/repositories/${id}`, {
        method: 'DELETE'
      });
    } catch (error) {
      console.error('Failed to delete backup repository:', error);
      throw error;
    }
  }
}

export const veeamApi = new VeeamApiClient();
