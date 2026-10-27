import { NextRequest, NextResponse } from 'next/server';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { cookies } from 'next/headers';
import { VeeamApiClient } from '@/lib/api/veeam-client';
import { settingsStore } from '@/lib/server/settings-store';
import { tokenManager } from '@/lib/server/token-manager';
import { getChunkedCookie } from '@/lib/utils/cookie-manager';
import { resolveCredential } from '@/lib/ai-integrations/credentials';
import { providerSchema, providers } from '@/lib/ai-integrations/model';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    console.log('[AI Health Summary] Request received');
    try {
        const { prompt } = await req.json();
        console.log('[AI Health Summary] Prompt:', prompt);

        // 1. Get user configuration
        const aiSettings = settingsStore.get().ai;
        const providerStr = providerSchema.parse(aiSettings.provider);
        const { key: apiKey } = resolveCredential(providerStr, aiSettings, '', process.env);

        if (!apiKey) {
            return NextResponse.json(
                { error: 'AI API Key is missing. Please configure it in Administration > AI Integrations.' },
                { status: 500 }
            );
        }

        const modelName = aiSettings?.modelName || providers[providerStr].defaultModel;

        let model;
        if (providerStr === 'gemini') {
            const google = createGoogleGenerativeAI({ apiKey });
            model = google(modelName);
        } else if (providerStr === 'anthropic') {
            const anthropic = createAnthropic({ apiKey });
            model = anthropic(modelName);
        } else {
            const openai = createOpenAI({ apiKey });
            model = openai(modelName);
        }

        // 2. Fetch Veeam Data
        const cookieStore = await cookies();
        const sourceId = cookieStore.get('veeam_source_id')?.value;
        let token = getChunkedCookie(cookieStore, 'veeam_vbr_token');
        if (sourceId) {
            token = await tokenManager.getToken(sourceId) || token;
        }

        if (!token) {
            return NextResponse.json({ error: 'Authorization required. Please log in again.' }, { status: 401 });
        }

        const serverVeeamApi = new VeeamApiClient();
        serverVeeamApi.setToken(token);

        // Forward cookies so the proxy API can read them (e.g. veeam_vbr_token_url)
        const cookieStr = cookieStore.getAll().map(c => `${c.name}=${c.value}`).join('; ');
        serverVeeamApi.setServerHeaders({ 'Cookie': cookieStr });

        const now = new Date();
        const fromDate = new Date();
        fromDate.setHours(now.getHours() - 24); // Last 24 hours

        console.log('[AI Health Summary] Fetching Veeam telemetry data...');
        const [sessions, bestPractices, authEvents, jobs] = await Promise.all([
            serverVeeamApi.getSessions({
                limit: 200,
                createdAfterFilter: fromDate.toISOString(),
                orderColumn: 'CreationTime',
                orderAsc: false
            }),
            serverVeeamApi.getSecurityBestPractices(),
            serverVeeamApi.getAuthorizationEvents({ limit: 100 }),
            serverVeeamApi.getBackupJobs()
        ]);

        try {
            // Using a fetch to our local proxy or directly if serverVeeamApi supports it.
            // Actually, the serverVeeamApi client handles token automatically. Let's rely on that.
        } catch (e) {
            console.warn("Could not fetch backups trend", e);
        }

        // 3. Assemble Prompt Context
        const failedSessions = sessions.filter(s => s.result?.result === 'Failed');
        const warnings = sessions.filter(s => s.result?.result === 'Warning');
        const securityViolations = bestPractices.filter(bp => bp.status === 'Violation');

        // Summarize data for the LLM
        const context = `
            Veeam Backup & Replication Environment Health Context:
            - Timeframe: Last 24 Hours
            - Total Sessions: ${sessions.length}
            - Failed Sessions: ${failedSessions.length} (${failedSessions.map(s => s.name).join(', ')})
            - Sessions with Warnings: ${warnings.length}
            - Total Jobs Configured: ${jobs.length}

            Security Best Practices:
            - Total Checks: ${bestPractices.length}
            - Violations: ${securityViolations.length}
            - Key Violations: ${securityViolations.map(bp => bp.bestPractice).join('; ')}

            Recent Authorization/Audit Events (Last 100):
            - Total Events: ${authEvents.length}
            - Example Events: ${authEvents.slice(0, 5).map(e => `[${e.state}] ${e.name} by ${e.createdBy}`).join('; ')}
        `;

        const systemPrompt = `
            You are an expert AI Backup Administrator specializing in Veeam Backup & Replication.
            Analyze the provided context and give a highly detailed, professional health summary of the environment.
            Focus on actionable insights, security risks, and overall trends.
            Format your response in beautiful Markdown.

            CRITICAL INSTRUCTIONS FOR FORMATTING:
            1. You MUST output EXACTLY these 4 sections in order, and absolutely NO OTHER sections:
               - ### Overview | Confidence: [XX]%
               - ### Operations Health | Confidence: [XX]%
               - ### Security Posture | Confidence: [XX]%
               - ### Audit Events | Confidence: [XX]%
            2. For EVERY section, the VERY FIRST THING immediately after the ### header MUST be a thinking block wrapped in <thinking>...</thinking> XML tags. DO NOT use blockquotes.
            3. Inside the <thinking> tags, provide a numbered list of your analytical steps.
               Example:
               ### Overview | Confidence: 99%
               <thinking>
               1. Retrieved data from endpoints (sessions, best_practices).
               2. Analyzed ${sessions.length} sessions using ${modelName} to determine root cause.
               3. Formulated actionable recommendations.
               </thinking>

               [Your detailed multi-paragraph overview goes here, outside the thinking tags]
            4. Every single ### header MUST have a confidence score appended with a pipe character.
            5. The Overview section MUST be comprehensive and highly detailed, spanning multiple paragraphs discussing the broader implications.
            6. Use standard bullet points ("- ") for listing specific failures, violations, or successes. ALWAYS leave a space after the dash.
            7. If you have a recommendation or an urgent action, DO NOT put it inside a bullet point. Create a brand new paragraph and start the line exactly with "Recommendation: " or "Urgent: " so the UI can highlight it as an alert block.
        `;

        // 4. Generate Stream
        console.log(`[AI Health Summary] Calling AI Provider using model: ${modelName}`);
        const result = streamText({
            model: model,
            system: systemPrompt,
            prompt: `User request: ${prompt}\n\nContext:\n${context}`,
        });

        return result.toTextStreamResponse();
    } catch (error) {
        console.error('AI Health Summary Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Unknown error during AI generation' },
            { status: 500 }
        );
    }
}
