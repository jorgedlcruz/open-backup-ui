// Open Backup UI v1.0.2

import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.VEEAM_API_URL;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: backupId } = await params;
        if (!API_BASE_URL) {
            return NextResponse.json(
                { error: 'Server configuration error: Missing VEEAM_API_URL' },
                { status: 500 }
            );
        }

        const authHeader = request.headers.get('authorization');
        if (!authHeader) {
            return NextResponse.json(
                { error: 'Authorization header required' },
                { status: 401 }
            );
        }

        const urlObj = new URL(request.url);
        const queryString = urlObj.searchParams.toString();
        const endpoint = queryString
            ? `/api/v1/backups/${backupId}/backupFiles?${queryString}`
            : `/api/v1/backups/${backupId}/backupFiles`;
        const fullUrl = `${API_BASE_URL}${endpoint}`;

        const response = await fetch(fullUrl, {
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'x-api-version': '1.3-rev1',
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[BACKUPFILES] Veeam error for ${backupId}:`, errorText);
            return NextResponse.json(
                { error: `Failed to fetch files: ${response.status} - ${errorText}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error('Error fetching backup files:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch backup files' },
            { status: 500 }
        );
    }
}
