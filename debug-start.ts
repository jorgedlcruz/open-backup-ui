// Open Backup UI v1.0.2
/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv').config();
const { veeamOneClient } = require('./lib/api/veeam-one-client');
// Mocking RequestInit and fetch for node environment if not polyfilled, 
// but assuming environment has fetch (Node 18+)
// We need to bypass TS compilation for this quick script, running with ts-node or just simple node if compiled.
// Actually, let's just make it a simple JS script that imports the DIST/compiled version if available, or uses ts-node.
// Since we have next.js, the 'lib' is typescript.
// Best way is to make a file that can be run with `npx tsx debug-start.ts`

/*
 Run with: npx tsx debug-start.ts
*/

async function run() {
    console.log("Authenticating...");
    try {
        // Force auth to ensure we have tokens
        // Accessing private method via any cast or just making a request that triggers auth
        // The client exposes public methods that call request() -> authenticate().

        const taskId = '8a56d84f-1790-4f54-ab20-2e0bfdefa16b'; // Protected VMs

        // Default Params
        const parameters = [
            { "name": "RootIDsXml", "reportParameterId": 845, "value": ["1000"] },
            { "name": "RootIDsXml2", "reportParameterId": 846, "value": [] },
            { "name": "RootIDsXml3", "reportParameterId": 847, "value": [] },
            { "name": "BusinessView", "reportParameterId": 848, "value": [] },
            { "name": "ScopeParams", "reportParameterId": 849, "value": "scopeVBR" },
            { "name": "Interval", "reportParameterId": 850, "value": 24 },
            { "name": "IntervalPeriod", "reportParameterId": 851, "value": "hour" },
            { "name": "ExcludeMask", "reportParameterId": 852, "value": "" },
            { "name": "JobType", "reportParameterId": 853, "value": ["-1"] },
            { "name": "ShowTemplates", "reportParameterId": 854, "value": false },
            { "name": "ExcludeJobs", "reportParameterId": 855, "value": null },
            { "name": "ScopeVBR", "reportParameterId": 2052, "value": ["1002"] }
        ];

        // Generate client-side session ID
        const sessionId = require('crypto').randomUUID();
        console.log("Client Session ID:", sessionId);

        console.log("Starting Report Session...");
        const startResult = await veeamOneClient.startReportSession(taskId, parameters, sessionId);
        console.log("Start Result:", startResult);

        if (!startResult || !startResult.id) {
            console.error("Failed to start session");
            return;
        }

        const executionId = startResult.id;
        console.log("Execution ID:", executionId);

        // Poll
        let attempts = 0;
        while (attempts < 20) {
            attempts++;
            console.log(`Polling status... (${attempts})`);
            const status = await veeamOneClient.getReportSessionStatus(executionId);
            console.log("Status:", status ? status.state : 'null');

            if (status && status.state === 'Completed') {
                console.log("Completed! Result:", JSON.stringify(status.result, null, 2));

                const resourceId = status.result.data.resourceId;
                console.log("ResourceId:", resourceId);

                // Try fetching data
                console.log("Fetching Summary Data...");
                const summary = await veeamOneClient.getReportSectionData(taskId, 'summry1', sessionId, resourceId);
                console.log("Summary Data:", summary ? "OK (Received Data)" : "NULL");

                break;
            }

            if (status && status.state === 'Failed') {
                console.error("Report Generation Failed");
                break;
            }

            await new Promise(r => setTimeout(r, 2000));
        }

    } catch (e) {
        console.error("Error:", e);
    }
}

run();
