// API Route for Veeam Authentication
// This route handles authentication with the Veeam API server-side to avoid CORS issues

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getChunkedCookie } from '@/lib/utils/cookie-manager';
import { tokenManager } from '@/lib/server/token-manager';

const API_BASE_URL = process.env.VEEAM_API_URL;
const API_USERNAME = process.env.VEEAM_USERNAME;
const API_PASSWORD = process.env.VEEAM_PASSWORD;

interface TokenResponse {
  access_token: string;
  token_type: string;
  refresh_token: string;
  expires_in: number;
  '.issued': string;
  '.expires': string;
  username: string;
}

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const cookieToken = getChunkedCookie(cookieStore, 'veeam_vbr_token');
    const sourceId = cookieStore.get('veeam_source_id')?.value;

    // 1. If we have a sourceId, use TokenManager (Preferred)
    if (sourceId) {
      const token = await tokenManager.getToken(sourceId);
      if (token) {
        console.log('[AUTH] Returning session token from TokenManager');
        return NextResponse.json({
          access_token: token,
          token_type: 'bearer',
          refresh_token: 'managed_by_server',
          expires_in: 900, // 15 mins
          '.issued': new Date().toISOString(),
          '.expires': new Date(Date.now() + 900 * 1000).toISOString(),
          username: 'SessionUser'
        } as TokenResponse);
      }
    }

    // 2. Fallback: If we have a legacy valid session cookie
    if (cookieToken) {
      console.log('[AUTH] Returning existing session token from cookie');
      return NextResponse.json({
        access_token: cookieToken,
        token_type: 'bearer',
        refresh_token: 'dummy_refresh_token',
        expires_in: 3600,
        '.issued': new Date().toISOString(),
        '.expires': new Date(Date.now() + 3600 * 1000).toISOString(),
        username: 'SessionUser'
      } as TokenResponse);
    }

    // 3. Fallback: Env Var-based Auth (Legacy)
    if (!API_BASE_URL || !API_USERNAME || !API_PASSWORD) {
      return NextResponse.json(
        { error: 'Server configuration error: Missing required environment variables and no active session.' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { grant_type, refresh_token } = body;

    console.log('[AUTH] Request received:', { grant_type });

    // Build authentication headers
    const headers: HeadersInit = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'x-api-version': '1.3-rev1',
    };

    let requestBody: string;

    if (grant_type === 'refresh_token' && refresh_token) {
      // Refresh token flow
      requestBody = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refresh_token,
      }).toString();
    } else {
      // Initial authentication flow with username/password in body
      const params: Record<string, string> = {
        grant_type: 'Password',
        username: API_USERNAME || '',
        password: API_PASSWORD || '',
      };
      requestBody = new URLSearchParams(params).toString();
    }

    const response = await fetch(`${API_BASE_URL}/api/oauth2/token`, {
      method: 'POST',
      headers,
      body: requestBody,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Authentication failed: ${response.status} - ${errorText}` },
        { status: response.status }
      );
    }

    const data: TokenResponse = await response.json();
    console.log('[AUTH] Success - token acquired');
    return NextResponse.json(data);

  } catch (error) {
    console.error('Authentication error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Authentication failed' },
      { status: 500 }
    );
  }
}
