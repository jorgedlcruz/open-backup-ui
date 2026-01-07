import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const token = request.headers.get('Authorization');
        const apiUrl = process.env.VBM_API_URL || 'https://127.0.0.1:4443';

        const body = await request.json();
        const endpoint = `/v8/Reports/GenerateLicenseOverview`;
        const fullUrl = `${apiUrl}${endpoint}`;

        console.log('[VBM LICENSE_REPORT] Generating report...');

        const response = await fetch(fullUrl, {
            method: 'POST',
            headers: {
                'Authorization': token || '',
                'Accept': 'application/octet-stream',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[VBM LICENSE_REPORT] API error:', response.status, errorText);
            return NextResponse.json(
                { error: `VBM API error: ${response.status} - ${errorText}` },
                { status: response.status }
            );
        }

        // Get the PDF content as ArrayBuffer
        const pdfBuffer = await response.arrayBuffer();

        // Extract filename from Content-Disposition header
        const contentDisposition = response.headers.get('content-disposition');
        let filename = 'Veeam_LicenseOverviewReport.pdf';
        if (contentDisposition) {
            const match = contentDisposition.match(/filename=([^;]+)/);
            if (match) {
                filename = match[1].replace(/['"]/g, '').trim();
            }
        }

        // Return the PDF as binary response
        return new NextResponse(pdfBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': pdfBuffer.byteLength.toString()
            }
        });
    } catch (error) {
        console.error('[VBM LICENSE_REPORT] Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
