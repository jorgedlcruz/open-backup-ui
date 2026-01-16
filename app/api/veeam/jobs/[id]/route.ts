// API Route for Individual Veeam Backup Job Operations
// This route proxies requests to the Veeam API for specific job operations

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { tokenManager } from '@/lib/server/token-manager';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const cookieStore = await cookies();
    const sourceId = cookieStore.get('veeam_source_id')?.value;
    const cookieUrl = cookieStore.get('veeam_vbr_token_url')?.value;
    const baseUrl = cookieUrl || process.env.VEEAM_API_URL;

    if (!baseUrl && !sourceId) {
      return NextResponse.json(
        { error: 'Server configuration error: No configured Data Source' },
        { status: 500 }
      );
    }

    let token: string | null = null;
    if (sourceId) {
      token = await tokenManager.getToken(sourceId);
    }

    if (!token) {
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return NextResponse.json(
        { error: 'Authorization required' },
        { status: 401 }
      );
    }

    const { id } = await params;

    // Explicit check to prevent treating 'states' as an ID, though Next.js routing should handle this if a parallel route existed.
    if (id === 'states') {
      // Pass through to standard API if it exists on backend, otherwise it will 404 from Veeam
    }

    const url = `${baseUrl}/api/v1/jobs/${id}`;
    let response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-api-version': '1.3-rev1',
      },
    });

    // Auto-refresh mechanism
    if (response.status === 401 && sourceId) {
      console.log(`[JOB ${id}] 401 received, refreshing token...`);
      const newToken = await tokenManager.refreshToken(sourceId);
      if (newToken) {
        response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${newToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'x-api-version': '1.3-rev1',
          },
        });
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Failed to fetch job: ${response.status} - ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('Error fetching job:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch job' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const cookieStore = await cookies();
    const sourceId = cookieStore.get('veeam_source_id')?.value;
    const cookieUrl = cookieStore.get('veeam_vbr_token_url')?.value;
    const baseUrl = cookieUrl || process.env.VEEAM_API_URL;

    if (!baseUrl && !sourceId) {
      return NextResponse.json(
        { error: 'Server configuration error: No configured Data Source' },
        { status: 500 }
      );
    }

    let token: string | null = null;
    if (sourceId) {
      token = await tokenManager.getToken(sourceId);
    }

    if (!token) {
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return NextResponse.json(
        { error: 'Authorization required' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const body = await request.json();
    const { action } = body; // 'start', 'stop', 'retry', 'disable', 'enable'

    if (!action || !['start', 'stop', 'retry', 'disable', 'enable'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be start, stop, retry, disable, or enable' },
        { status: 400 }
      );
    }

    const url = `${baseUrl}/api/v1/jobs/${id}/${action}`;
    let response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-api-version': '1.3-rev1',
      },
    });

    // Auto-refresh mechanism
    if (response.status === 401 && sourceId) {
      console.log(`[JOB ${id} ACTION] 401 received, refreshing token...`);
      const newToken = await tokenManager.refreshToken(sourceId);
      if (newToken) {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${newToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'x-api-version': '1.3-rev1',
          },
        });
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Failed to ${action} job: ${response.status} - ${errorText}` },
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error performing job action:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to perform job action' },
      { status: 500 }
    );
  }
}
