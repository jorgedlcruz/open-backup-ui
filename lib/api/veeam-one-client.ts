import { VeeamOneReportTemplate, VeeamOneTag, VeeamOneGridNode, VeeamOneReportParameter } from '@/lib/types/veeam-one';
import { MOCK_PROTECTED_VMS_SUMMARY, MOCK_PROTECTED_VMS_CHART, MOCK_LAST_BACKUP_AGE_CHART, MOCK_VM_DETAILS_TABLE } from './mock-report-data';
import { configStore } from "@/lib/server/config-store";
import process from 'process';

interface TokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
}

interface DynamicConfig {
    url: string;
    username: string;
    password: string;
}

class VeeamOneClient {
    private token: string | null = null;
    private tokenExpiry: Date | null = null;
    private connectionId: string | null = null;
    private sessionCookie: string | null = null;  // Reporter_SessionId cookie from auth

    constructor() {
        // No-op, config is resolved dynamically
    }

    private getDynamicConfig(): DynamicConfig | null {
        // Priority 1: Env Vars
        if (process.env.VEEAM_ONE_API_URL && process.env.VEEAM_ONE_USERNAME && process.env.VEEAM_ONE_PASSWORD) {
            let url = process.env.VEEAM_ONE_API_URL;
            if (url.endsWith('/')) url = url.slice(0, -1);
            return {
                url,
                username: process.env.VEEAM_ONE_USERNAME!,
                password: process.env.VEEAM_ONE_PASSWORD!
            };
        }

        // Priority 2: Config Store - find source ID first, then get full details with password
        const sources = configStore.getAll();
        const oneSourceSummary = sources.find(s => s.platform === 'one');
        if (oneSourceSummary) {
            // Use getById to retrieve the DECRYPTED password
            const fullSource = configStore.getById(oneSourceSummary.id);
            if (fullSource && fullSource.password) {
                return {
                    url: `${fullSource.protocol}://${fullSource.host}:${fullSource.port}`,
                    username: fullSource.username,
                    password: fullSource.password
                };
            }
        }

        return null;
    }

    public isConfigured(): boolean {
        return !!this.getDynamicConfig();
    }

    private async getConnectionId(): Promise<string> {
        // Return cached connectionId if available
        if (this.connectionId) {
            return this.connectionId;
        }

        const config = this.getDynamicConfig();
        if (!config) return '';

        // Get token first
        const token = await this.authenticate();

        try {
            // Call SignalR negotiate endpoint to establish session and get connectionId
            const response = await fetch(`${config.url}/notifications/negotiate?negotiateVersion=1`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'text/plain;charset=UTF-8',
                    'Accept': '*/*',
                    'x-requested-with': 'XMLHttpRequest',
                    'x-signalr-user-agent': 'Microsoft SignalR/6.0 (6.0.15; Unknown OS; Browser; Unknown Runtime Version)'
                },
                body: '', // Empty body
                cache: 'no-store',
            });

            if (response.ok) {
                const data = await response.json();
                this.connectionId = data.connectionId;
                console.log('[VeeamOneClient] Negotiate successful. connectionId:', this.connectionId);
                return this.connectionId!;
            } else {
                console.error('[VeeamOneClient] Negotiate failed:', response.status);
            }
        } catch (e) {
            console.error('[VeeamOneClient] Negotiate error:', e);
        }

        // Fallback to generated ID if negotiate fails
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 22; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        this.connectionId = result;
        console.log('[VeeamOneClient] Using fallback connectionId:', this.connectionId);
        return this.connectionId;
    }

    private async authenticate(): Promise<string> {
        // Check if we have a valid token AND the critical Reporter_SessionId cookie
        const hasValidSession = this.sessionCookie && this.sessionCookie.includes('Reporter_SessionId=');

        if (this.token && this.tokenExpiry && new Date() < this.tokenExpiry && hasValidSession) {
            return this.token;
        }

        // Force fresh auth if Reporter_SessionId is missing
        if (this.token && !hasValidSession) {
            console.log('[VeeamOneClient] Reporter_SessionId missing, forcing re-authentication...');
            this.token = null;
            this.tokenExpiry = null;
            this.sessionCookie = null;
        }

        const config = this.getDynamicConfig();
        if (!config) {
            console.warn('Veeam ONE not configured');
            return '';
        }

        try {
            // Use multipart/form-data with ui_login=true to get UI token and reporter_pt cookie
            // This is CRITICAL for webview APIs (reports)
            const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
            const bodyParts = [
                `--${boundary}`,
                'Content-Disposition: form-data; name="grant_type"',
                '',
                'password',
                `--${boundary}`,
                'Content-Disposition: form-data; name="username"',
                '',
                config.username,
                `--${boundary}`,
                'Content-Disposition: form-data; name="password"',
                '',
                config.password,
                `--${boundary}`,
                'Content-Disposition: form-data; name="ui_login"',
                '',
                'true',
                `--${boundary}--`,
                ''
            ];

            const response = await fetch(`${config.url}/api/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Accept': 'application/json'
                },
                body: bodyParts.join('\r\n'),
                cache: 'no-store',
            });

            if (!response.ok) {
                const text = await response.text();
                // Avoid logging full error in prod, but essential for debug
                console.error('[VeeamOneClient] Auth failed:', response.status, text);
                throw new Error(`Authentication failed: ${response.status} ${text} `);
            }

            const data: TokenResponse = await response.json();
            this.token = data.access_token;
            // expires_in is in seconds (899 approx 15 mins)
            this.tokenExpiry = new Date(Date.now() + (data.expires_in - 60) * 1000); // 1 min buffer

            // Capture ALL cookies from the response - both Reporter_SessionId AND reporter_pt are needed
            // Node.js fetch may have multiple set-cookie headers; use getSetCookie() if available
            let allSetCookies: string[] = [];

            // Try getSetCookie first (modern Node.js)
            if (typeof response.headers.getSetCookie === 'function') {
                allSetCookies = response.headers.getSetCookie();

            } else {
                // Fallback: try to get combined header
                const setCookie = response.headers.get('set-cookie');
                if (setCookie) {
                    // Split by comma followed by space and cookie name pattern
                    allSetCookies = setCookie.split(/,(?=\s*[a-zA-Z_]+=)/);
                }

            }



            if (allSetCookies.length > 0) {
                const cookies: string[] = [];
                const fullCookieStr = allSetCookies.join('; ');

                // Extract Reporter_SessionId
                const sessionMatch = fullCookieStr.match(/Reporter_SessionId=([^;,\s]+)/);
                if (sessionMatch) cookies.push(`Reporter_SessionId=${sessionMatch[1]}`);

                // Extract reporter_pt (JWT cookie) - specific check for this one
                const ptMatch = fullCookieStr.match(/reporter_pt=([^;,\s]+)/);
                if (ptMatch) cookies.push(`reporter_pt=${ptMatch[1]}`);

                // Extract reporter_notify_id if present
                const notifyMatch = fullCookieStr.match(/reporter_notify_id=([^;,\s]+)/);
                if (notifyMatch) cookies.push(`reporter_notify_id=${notifyMatch[1]}`);

                if (cookies.length > 0) {
                    this.sessionCookie = cookies.join('; ');

                }
            }

            return this.token;
        } catch (error) {
            console.error('Veeam ONE Auth Error:', error);
            throw error;
        }
    }

    private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
        const config = this.getDynamicConfig();
        if (!config) throw new Error("Veeam ONE not configured");

        const token = await this.authenticate();

        // Ensure connectionId is available
        const connId = await this.getConnectionId();

        const url = `${config.url}${path}`;



        const headers: Record<string, string> = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            ...(connId ? { 'veeam-connection-id': connId } : {}),
            ...(this.sessionCookie ? { 'Cookie': this.sessionCookie } : {})
        };



        const fetchOptions: RequestInit = {
            ...options,
            headers: {
                ...headers,
                ...options.headers,
            },
            credentials: 'include', // Important for cookies
        };

        try {
            const response = await fetch(url, fetchOptions);

            if (!response.ok) {
                // On 401, try to re-authenticate once
                if (response.status === 401 && !path.includes('/token')) {
                    console.log('[VeeamOneClient] Got 401, forcing re-authentication...');
                    this.token = null;
                    this.tokenExpiry = null;
                    this.sessionCookie = null;
                    this.connectionId = null;

                    // Retry once with fresh auth
                    const freshToken = await this.authenticate();
                    const freshConnId = await this.getConnectionId();

                    const retryHeaders: Record<string, string> = {
                        'Authorization': `Bearer ${freshToken}`,
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    };
                    if (freshConnId) retryHeaders['veeam-connection-id'] = freshConnId;
                    if (this.sessionCookie) retryHeaders['Cookie'] = this.sessionCookie;

                    const retryResponse = await fetch(url, {
                        ...options,
                        headers: { ...retryHeaders, ...options.headers },
                        credentials: 'include'
                    });

                    if (retryResponse.ok) {
                        if (retryResponse.status === 204) return {} as T;
                        return await retryResponse.json();
                    }
                }

                // Try reading body
                const text = await response.text();
                throw new Error(`API Request failed: ${response.status} ${path} - ${text}`);
            }

            // Handle 204
            if (response.status === 204) {
                return {} as T;
            }

            return await response.json();
        } catch (error) {
            console.error(`[VeeamOneClient] Request Error ${path}: `, error);
            throw error;
        }
    }

    async getReportTemplates(): Promise<VeeamOneReportTemplate[]> {
        // URL: /api/v2.3/reportPacks/templates
        try {
            const data = await this.request<{ templates: VeeamOneReportTemplate[] }>('/api/v2.3/reportPacks/templates?Limit=1000');
            // Check structure. User provided JSON suggests top level array or object?
            // User said: "Result: [ { ... } ]". Assuming array.
            // Result format: { items: [...], totalCount: number }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((data as any).items) return (data as any).items;

            // Fallback checks
            if (Array.isArray(data)) return data;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((data as any).results) return (data as any).results;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((data as any).templates) return (data as any).templates;

            return []
        } catch (e) {
            console.error("Error fetching report templates", e);
            return [];
        }
    }

    async getReportTags(): Promise<VeeamOneTag[]> {
        // URL: /api/v2.3/reportPacks/tags
        try {
            const data = await this.request<VeeamOneTag[]>('/api/v2.3/reportPacks/tags');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((data as any).items) return (data as any).items;
            if (Array.isArray(data)) return data;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((data as any).results) return (data as any).results;
            return [];
        } catch (e) {
            console.error("Error fetching tags", e);
            return [];
        }
    }

    async getSavedReports(): Promise<VeeamOneGridNode[]> {
        // URL: /api/v2.3/folders/gridTree
        try {
            const config = await this.getConfiguration();
            const userContextId = config.userContextId;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = await this.request<any>(`/api/v2.3/folders/gridTree?userContextId=${userContextId}`);

            // Log keys to identify the correct structure
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                console.log("Saved Reports Keys:", Object.keys(data));
            } else {
                console.log("Saved Reports is Array/Primitive. IsArray:", Array.isArray(data));
            }

            // Robustness checks
            if (Array.isArray(data)) return data;
            if (data?.items) return data.items;
            if (data?.results) return data.results;
            if (data?.data) return data.data;
            if (data?.children) return data.children;
            if (data?.folders) return data.folders;
            // Check if it's a single root node (e.g. has id/children)
            if (data?.id && (data?.children || data?.parentId === 0)) return [data];

            return [];
        } catch (e) {
            console.error("Error fetching saved reports", e);
            return [];
        }
    }

    async getReportParameters(taskId: string, sessionId?: string, resourceId?: string): Promise<VeeamOneReportParameter[]> {
        // DEMO OVERRIDE
        const DEMO_TASK_ID = '8a56d84f-1790-4f54-ab20-2e0bfdefa16b';

        try {
            const config = await this.getConfiguration();
            const userContextId = config.userContextId;

            const url = `/api/v2.3/webview/report/tasks/${taskId}/sections/parameters/data?userContextId=${userContextId}`;

            // Use passed sessionId and resourceId from the report execution flow
            const effectiveSessionId = sessionId || "missing-session-id";
            const effectiveResourceId = resourceId || "missing-resource-id";

            const body = {
                "session": { "sessionId": effectiveSessionId },
                "resourceId": effectiveResourceId,
                "query": {}
            };

            // The response has 'items' array with {name, value} objects directly
            const result = await this.request<{ parameters?: VeeamOneReportParameter[], items?: { name: string, value: string }[], totalCount?: number }>(url, {
                method: 'POST',
                body: JSON.stringify(body)
            });


            // Check both possible structures - items contains {name, value} directly
            if (result.parameters && result.parameters.length > 0) {
                return result.parameters;
            }
            // Items array contains {name, value} objects directly
            if (result.items && result.items.length > 0) {
                return result.items as VeeamOneReportParameter[];
            }
            return [];
        } catch (e) {
            console.warn("Error fetching report parameters, using mock for demo if applicable", e);
            if (taskId === DEMO_TASK_ID) {
                return [
                    { name: "Scope", value: "Virtual Infrastructure" },
                    { name: "Exclusions", value: "None" },
                    { name: "Period", value: "Last 24 Hours" }
                ];
            }
            return [];
        }
    }



    async getConfiguration(): Promise<{ userContextId: string }> {
        // Cache could be added here if needed
        try {
            const result = await this.request<{ userContextId: string }>('/api/v2.3/configuration');
            return result;
        } catch (e) {
            console.error("[VeeamOneClient] Error fetching config:", e);
            // Fallback to known working (or mocked) context for dev, though likely will fail if expired
            console.warn('[VeeamOneClient] Using FALLBACK userContextId (will likely fail)');
            return { userContextId: '663e07ff-d485-4f7a-a60d-b0f5cd591026' };
        }
    }

    // Dynamic Report Generation Methods

    private getAuthSessionId(): string | null {
        if (this.sessionCookie) {
            const match = this.sessionCookie.match(/Reporter_SessionId=([a-f0-9]{32})/i);
            if (match && match[1]) {
                const raw = match[1];
                return `${raw.substring(0, 8)}-${raw.substring(8, 12)}-${raw.substring(12, 16)}-${raw.substring(16, 20)}-${raw.substring(20)}`;
            }
        }
        return null;
    }

    /**
     * Start a webview session to get a valid sessionId.
     * This MUST be called before startReportSession to get a server-registered sessionId.
     */
    async startWebviewSession(): Promise<string> {
        const config = await this.getConfiguration();
        const userContextId = config.userContextId;

        const url = `/api/v2.3/webview/sessions/start?userContextId=${userContextId}`;

        try {
            const response = await this.request<{ sessionId: string }>(url, { method: 'POST' });
            return response.sessionId;
        } catch (e) {
            console.error('[VeeamOneClient] Failed to start webview session:', e);
            throw e;
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async startReportSession(taskId: string, parameters: any[], sessionId: string): Promise<{ id: string, state: string } | null> {
        const config = await this.getConfiguration();
        const userContextId = config.userContextId;

        const url = `/api/v2.3/webview/report/tasks/${taskId}/dataset/dsData/start?userContextId=${userContextId}`;

        // Send provided parameters, or empty array to let the API use report defaults
        const body = {
            "parameters": parameters,
            "session": { "sessionId": sessionId }
        };

        try {
            return await this.request<{ id: string, state: string }>(url, {
                method: 'POST',
                body: JSON.stringify(body)
            });
        } catch (e) {
            console.error("Error starting report session", e);
            throw e;
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async getReportSessionStatus(executionId: string): Promise<{ state: string, result?: { data?: { resourceId: string, sections: any[] } } } | null> {
        const config = await this.getConfiguration();
        const userContextId = config.userContextId;



        // Short-circuit for mock ID only
        if (executionId === "mock-execution-id" || executionId.includes("mock")) {
            return {
                state: "Completed",
                result: {
                    data: {
                        resourceId: "mock-resource-id",
                        sections: []
                    }
                }
            };
        }

        const url = `/api/v2.3/webview/report/tasks/${executionId}/status?userContextId=${userContextId}`;

        try {
            const response = await this.request<{ state: string, result?: { data?: { resourceId: string, sections: unknown[] } } }>(url);
            return response;
        } catch (e) {
            console.error("Error checking report status", e);
            return null;
        }
    }

    async getReportSectionData<T>(taskId: string, sectionId: string, sessionId?: string, resourceId?: string): Promise<T | null> {
        const config = await this.getConfiguration();
        const userContextId = config.userContextId;

        // Use passed session/resource IDs from the report execution flow
        const effectiveSessionId = sessionId || "missing-session-id";
        const effectiveResourceId = resourceId || "missing-resource-id";

        // Short-circuit for mock data
        if (sessionId === "mock-execution-id" || resourceId === "mock-resource-id") {
            console.log(`[VeeamOneClient] Serving MOCK data for ${sectionId}`);
            if (sectionId === 'summry1') return MOCK_PROTECTED_VMS_SUMMARY as unknown as T;
            if (sectionId === 'chart_protected_vms') return MOCK_PROTECTED_VMS_CHART as unknown as T;
            if (sectionId === 'chart_vm_last_backup_age') return MOCK_LAST_BACKUP_AGE_CHART as unknown as T;
            if (sectionId === 'table_details') return MOCK_VM_DETAILS_TABLE as unknown as T;
            return null;
        }



        const url = `/api/v2.3/webview/report/tasks/${taskId}/sections/${sectionId}/data?userContextId=${userContextId}`;

        const body = {
            "session": { "sessionId": effectiveSessionId },
            "resourceId": effectiveResourceId,
            "query": { "offset": 0, "limit": 500 }
        };

        try {
            const data = await this.request<T>(url, {
                method: 'POST',
                body: JSON.stringify(body)
            });
            return data;
        } catch (e) {
            console.error(`Error fetching section ${sectionId}`, e);

            // MOCK FALLBACK
            if (sessionId === "mock-execution-id" || resourceId === "mock-resource-id" || (sessionId === "demo" && taskId === '8a56d84f-1790-4f54-ab20-2e0bfdefa16b')) {
                console.log(`[VeeamOneClient] Serving MOCK data for ${sectionId}`);
                if (sectionId === 'summry1') return MOCK_PROTECTED_VMS_SUMMARY as unknown as T;
                if (sectionId === 'chart_protected_vms') return MOCK_PROTECTED_VMS_CHART as unknown as T;
                if (sectionId === 'chart_vm_last_backup_age') return MOCK_LAST_BACKUP_AGE_CHART as unknown as T;
                if (sectionId === 'table_details') return MOCK_VM_DETAILS_TABLE as unknown as T;
            }

            return null;
        }
    }

    async getReportTemplate(id: string | number): Promise<VeeamOneReportTemplate | undefined> {
        // Since we don't have a direct "get one" endpoint confirmed, we fetch all and find types.
        // Optimally we'd cache this or use a real endpoint.
        const templates = await this.getReportTemplates();
        return templates.find(t => t.reportTemplateId.toString() === id.toString() || t.uid === id);
    }
    async getReportPreviewLink(templateId: string | number): Promise<string | null> {
        // This returns a direct link to view the report in Veeam ONE's native viewer
        try {
            const url = await this.request<string>(`/api/v2.3/reportPacks/templates/${templateId}/link`);
            // The API returns a quoted string, so we strip quotes if present
            return typeof url === 'string' ? url.replace(/^"|"$/g, '') : null;
        } catch (e) {
            console.error("Error fetching report link", e);
            return null;
        }
    }
}

export const veeamOneClient = new VeeamOneClient();
