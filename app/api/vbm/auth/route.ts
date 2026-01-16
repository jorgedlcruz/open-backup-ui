// API Route for Veeam Backup for Microsoft 365 Authentication
// This route handles authentication with the VBM API server-side (same pattern as VBR)

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getChunkedCookie } from '@/lib/utils/cookie-manager';
import { tokenManager } from '@/lib/server/token-manager';

const VBM_API_URL = process.env.VBM_API_URL;
const VBM_USERNAME = process.env.VBM_USERNAME;
const VBM_PASSWORD = process.env.VBM_PASSWORD;

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const cookieToken = getChunkedCookie(cookieStore, 'veeam_vb365_token');
    const sourceId = cookieStore.get('veeam_vb365_source_id')?.value;

    // 1. If we have a sourceId, use TokenManager (Preferred)
    if (sourceId) {
      const token = await tokenManager.getToken(sourceId);
      if (token) {
        console.log('[VBM AUTH] Returning session token from TokenManager');
        return NextResponse.json({
          access_token: token,
          token_type: 'bearer',
          expires_in: 900, // 15 mins
        } as TokenResponse);
      }
    }

    // 2. Fallback: If we have a legacy valid session cookie
    if (cookieToken) {
      console.log('[VBM AUTH] Returning existing session token from cookie');
      return NextResponse.json({
        access_token: cookieToken,
        token_type: 'bearer',
        expires_in: 3600,
      } as TokenResponse);
    }

    // 3. Fallback: Env Var-based Auth (Legacy)
    if (!VBM_API_URL || !VBM_USERNAME || !VBM_PASSWORD) {
      return NextResponse.json(
        { error: 'No VB365 session. Please add and connect a VB365 data source.' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { grant_type, refresh_token } = body;

    console.log('[VBM AUTH] Authentication request via env vars, grant_type:', grant_type);

    let authBody: Record<string, string>;

    if (grant_type === 'refresh_token' && refresh_token) {
      authBody = {
        grant_type: 'refresh_token',
        refresh_token: refresh_token,
      };
    } else {
      authBody = {
        grant_type: 'password',
        username: VBM_USERNAME,
        password: VBM_PASSWORD,
      };
    }

    const authUrl = `${VBM_API_URL}/v7/Token`;
    const formData = new URLSearchParams();
    Object.entries(authBody).forEach(([key, value]) => {
      formData.append(key, value);
    });

    const response = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[VBM AUTH] Authentication failed:', errorText);
      return NextResponse.json(
        { error: `VBM authentication failed: ${response.status} - ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('[VBM AUTH] Authentication successful via env vars');
    return NextResponse.json(data);

  } catch (error) {
    console.error('[VBM AUTH] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'VBM authentication failed' },
      { status: 500 }
    );
  }
}
