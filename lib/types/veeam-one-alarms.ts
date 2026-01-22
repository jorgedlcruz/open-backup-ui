export interface TriggeredAlarmItem {
    status: 'Resolved' | 'Information' | 'Warning' | 'Error';
    latitude?: number | null;
    longitude?: number | null;
    region?: string | null;
    subregion?: string | null;
    cityName?: string | null;
    isCustomCity?: boolean | null;
    status_Count?: number;
    // For list view
    triggeredAlarmId?: number;
    triggeredSubAlarmId?: number;
    alarmId?: number;
    alarmName?: string;
    time?: string;
    entityName?: string;
    entityType?: string;
    description?: string;
    source?: string;
    remediation?: { items: unknown[] };
}

export interface AlarmHistoryItem {
    time: string;
    status: 'Resolved' | 'Information' | 'Warning' | 'Error';
    status_Count: number;
}

export interface AlarmTemplate {
    alarmTemplateId: number;
    name: string;
    type: string;
    predefinedAlarmId: number;
    knowledgeSummary: string;
    knowledgeCause: string;
    knowledgeResolution: string;
    isEnabled: boolean;
    isPredefined: boolean;
}

export interface ResolveAlarmRequest {
    comment: string;
    triggeredChildAlarmIds: number[];
    resolveType: 'Resolve';
}

export interface AlarmsApiResponse<T> {
    items: T[];
    totalCount: number;
}
