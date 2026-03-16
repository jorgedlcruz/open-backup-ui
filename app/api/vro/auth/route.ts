// API Route for Veeam Recovery Orchestrator Authentication
// This route proxies authentication requests to VRO API

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const VRO_API_URL = process.env.VRO_API_URL;
const VRO_USERNAME = process.env.VRO_USERNAME;
const VRO_PASSWORD = process.env.VRO_PASSWORD;

export async function POST(request: NextRequest) {
  try {
    if (!VRO_API_URL || !VRO_USERNAME || !VRO_PASSWORD) {
      console.error('[VRO AUTH] Missing configuration:', {
        hasUrl: !!VRO_API_URL,
        hasUsername: !!VRO_USERNAME,
        hasPassword: !!VRO_PASSWORD,
      });
      return NextResponse.json(
        { error: 'Server configuration error: Missing VRO credentials' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { grant_type, refresh_token } = body;

    console.log('[VRO AUTH] Authentication request, grant_type:', grant_type);

    let authBody: Record<string, string>;
    
    if (grant_type === 'refresh_token' && refresh_token) {
      authBody = {
        grant_type: 'refresh_token',
        refresh_token: refresh_token,
      };
    } else {
      authBody = {
        grant_type: 'password',
        username: VRO_USERNAME,
        password: VRO_PASSWORD,
      };
    }

    const authUrl = `${VRO_API_URL}/api/token`;
    console.log('[VRO AUTH] Authenticating with VRO at:', authUrl);

    // Create FormData for application/x-www-form-urlencoded as per VRO API spec
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

    console.log('[VRO AUTH] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[VRO AUTH] Authentication failed:', errorText);
      return NextResponse.json(
        { error: `VRO authentication failed: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('[VRO AUTH] Authentication successful');
    return NextResponse.json(data);

  } catch (error) {
    console.error('[VRO AUTH] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'VRO authentication failed' },
      { status: 500 }
    );
  }
}
