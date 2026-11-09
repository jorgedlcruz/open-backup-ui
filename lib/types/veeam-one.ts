// Open Backup UI v1.0.2
export interface VeeamOneReportTemplate {
    reportTemplateId: number;
    name: string;
    description: string;
    packName: string;
    infrastructure: number | string;
    infrastructureId?: number;
    tags: number[]; // Array of tag IDs
    uid?: string;
    hasWebPreview?: boolean;
    previewImageId?: number;
    community?: boolean;
    viewsCount?: number;
    restrictionType?: string;
    offlineReport?: boolean;
}

export interface VeeamOneTag {
    tagId: number;
    tag: string;
}

export interface VeeamOneGridNode {
    id: string;
    name: string;
    type: "Folder" | "Report";
    children?: VeeamOneGridNode[];
    // helper fields for UI
    hasChildren?: boolean;
}

// Response wrappers
export interface VeeamOneTemplatesResponse {
    total: number;
    results: VeeamOneReportTemplate[];
}

export interface VeeamOneTagsResponse {
    results: VeeamOneTag[];
}

// --- Report Details Types ---

export interface VeeamOneReportParameter {
    name: string
    value: string
}

export interface VeeamOneSummaryItem {
    name: string
    value: string
    indent?: number
}

// Chart Data Types
export interface VeeamOneChartItem {
    value_formatted_?: string
    value: string
    group?: string
    key?: string
    group_string?: string
    group_datetime?: string
    color: string
    [key: string]: string | number | boolean | null | undefined
}

// Table Data Types (Dynamic generic structure as observed)
export interface VeeamOneTableItem {
    row_id: string
    [key: string]: string | number | boolean | null
}

export interface VeeamOneTableResponse {
    items: VeeamOneTableItem[]
    totalCount: number
}

export interface VeeamOneChartResponse {
    items: VeeamOneChartItem[]
    totalCount: number
}

export interface VeeamOneSummaryResponse {
    items: {
        name: string
        data: VeeamOneSummaryItem[]
    }[]
    totalCount: number
}

export interface VeeamOneParametersResponse {
    items: VeeamOneReportParameter[]
    totalCount: number
}

// --- Report Metadata Types (from /api/v2.3/resources/{id}) ---

export interface ReportMetadata {
    name: string
    description: string
    uid: string
    sections: ReportSection[]
    datasets: ReportDataset[]
    parameters: ReportMetadataParameter[]
    styles: { columnsCount: number, pageWidth: number }
}

export interface ReportSection {
    id: string
    type: 'name' | 'description' | 'parameters' | 'summary' | 'chart' | 'table' | 'overviewTable'
    data: ChartSectionData | TableSectionData | SummarySectionData | ParametersSectionData | object
}

export interface ChartSectionData {
    dataset: string
    sectionId: number
    name: string
    chartType: 'Line' | 'BarGrouped' | 'Pie' | 'Bar' | 'Area' | 'StackedArea100'
    fieldX: string
    groupBy?: string
    series: ChartSeries[]
    yAxisLabel?: string
    xAxisLabel?: string
    colorsRefs?: Record<string, string>
    stacked?: 'normal' | null
    defaultSorting?: SortConfig[]
    columns?: ChartColumn[]
    style?: { size?: string, width?: number }
    xAxisSlantedLabels?: boolean
}

export interface ChartSeries {
    fieldY: string
    colorRefField?: string
    name?: string
    color?: string
}

export interface ChartColumn {
    field: string
    formatter?: ColumnFormatter
    extraInvariantColumn?: boolean
}

export interface TableSectionData {
    dataset: string
    sectionId: number
    label: string
    columns: TableColumnDef[]
    defaultSorting?: SortConfig[]
    idColumns: string[]
}

export interface TableColumnDef {
    label: string
    field: string
    width?: number
    align?: 'left' | 'right' | 'center'
    groupable?: boolean
    formatter?: ColumnFormatter
}

export interface ColumnFormatter {
    formatterType: 'Default' | 'DateTime' | 'Number' | 'DateOnly' | 'Size' | 'Duration' | 'Percent'
    configuration?: {
        nullReplaceStrategy?: 'Dash' | 'Empty' | 'Zero'
        dateTimePart?: 'Full' | 'DateOnly' | 'TimeOnly'
        decimalPlaces?: number
    }
}

export interface SortConfig {
    column: string
    direction: 'ascending' | 'descending'
}

export interface SummarySectionData {
    items: SummaryGroupConfig[]
}

export interface SummaryGroupConfig {
    group: string
    sectionId: number
    dataset: string
    type: 'group'
    rows: { label: string, field: string }[]
}

export interface ParametersSectionData {
    items: ParameterDisplayConfig[]
}

export interface ParameterDisplayConfig {
    label: string
    type: 'datasetValue' | 'arrayValue' | 'parameterValue'
    data: object
}

export interface ReportDataset {
    name: string
    fields: DatasetField[]
    query?: object
    options?: string
    internal?: boolean
}

export interface DatasetField {
    name: string
    title: string
    type: string // e.g. 'System.String', 'System.Int32', 'System.DateTime'
}

export interface ReportMetadataParameter {
    name: string
    dataType: string
    nullable: boolean
    defaultValue: string
    prompt: string
}

