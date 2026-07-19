import { NextRequest, NextResponse } from 'next/server';
import { settingsStore } from '@/lib/server/settings-store';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const settings = settingsStore.getMasked();
        return NextResponse.json(settings.ai);
    } catch (error) {
        console.error('Error fetching AI settings:', error);
        return NextResponse.json(
            { error: 'Failed to fetch AI settings' },
            { status: 500 }
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        
        settingsStore.save({
            ai: body
        });
        
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error saving AI settings:', error);
        return NextResponse.json(
            { error: 'Failed to save AI settings' },
            { status: 500 }
        );
    }
}
