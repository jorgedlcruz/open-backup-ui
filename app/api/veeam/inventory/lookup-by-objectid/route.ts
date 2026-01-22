import { NextRequest, NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';

interface InventoryItem {
    type: string;
    hostName: string;
    name: string;
    objectId: string;
    urn: string;
    platform: string;
    size?: string;
    isEnabled?: boolean;
    metadata?: Array<{ field: string; data: string }>;
}

/**
 * Parse URN to extract component IDs
 * Example URN: "vc:vcsa.jorgedelacruz.es;datacenter:datacenter-2;cluster:domain-c7;vm:vm-132701"
 */
function parseUrn(urn: string): { datacenterId?: string; clusterId?: string; esxHostId?: string } {
    const result: { datacenterId?: string; clusterId?: string; esxHostId?: string } = {};

    const dcMatch = urn.match(/datacenter:([^;]+)/);
    if (dcMatch) result.datacenterId = dcMatch[1];

    const clusterMatch = urn.match(/cluster:([^;]+)/);
    if (clusterMatch) result.clusterId = clusterMatch[1];

    const esxMatch = urn.match(/esx:([^;]+)/);
    if (esxMatch) result.esxHostId = esxMatch[1];

    return result;
}

/**
 * API Route: Lookup workload details by name from VBR inventory
 * 
 * This endpoint queries the VBR inventory API through our own proxy routes
 * and filters by the provided workload name to return detailed workload 
 * information including metadata (guest OS, IP, DNS, etc.)
 * 
 * Also resolves Datacenter and Cluster names from their IDs in the URN.
 */
export async function POST(request: NextRequest) {
    try {
        // Get the host from the request headers to build absolute URLs for internal calls
        const headersList = await headers();
        const host = headersList.get('host') || 'localhost:3000';

        // Determine protocol: default to https in production unless running locally
        const isLocal = host.includes('localhost') || host.includes('127.0.0.1') || host.startsWith('192.168.') || host.startsWith('10.');
        const protocol = (process.env.NODE_ENV === 'production' && !isLocal) ? 'https' : 'http';
        const baseInternalUrl = `${protocol}://${host}`;

        // Forward cookies for authentication
        const cookieStore = await cookies();
        const cookieHeader = cookieStore.getAll()
            .map(c => `${c.name}=${c.value}`)
            .join('; ');

        // Parse request body
        const body = await request.json();
        const { name } = body;

        if (!name) {
            return NextResponse.json(
                { error: 'name is required' },
                { status: 400 }
            );
        }

        console.log(`[Inventory Lookup] Searching for workload: "${name}"`);

        // Call our internal inventory proxy to get the inventory root
        const inventoryUrl = `${baseInternalUrl}/api/veeam/inventory`;
        console.log(`[Inventory Lookup] Calling internal proxy: ${inventoryUrl}`);

        let inventoryResponse;
        try {
            inventoryResponse = await fetch(inventoryUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': cookieHeader,
                },
                body: JSON.stringify({}),
            });
        } catch (fetchError) {
            console.error('[Inventory Lookup] Fetch error on inventory proxy:', fetchError);
            return NextResponse.json(
                { error: 'Network error connecting to inventory proxy', workload: null },
                { status: 502 }
            );
        }

        if (!inventoryResponse.ok) {
            const errorText = await inventoryResponse.text().catch(() => '');
            console.error(`[Inventory Lookup] Inventory proxy failed: ${inventoryResponse.status} - ${errorText}`);
            return NextResponse.json(
                { error: `Failed to query inventory: ${inventoryResponse.status}`, workload: null },
                { status: inventoryResponse.status }
            );
        }

        const inventoryData = await inventoryResponse.json();
        console.log(`[Inventory Lookup] Inventory root returned ${inventoryData.data?.length || 0} items`);

        // Find vCenter servers
        const vCenters = inventoryData.data?.filter((item: { type: string }) =>
            item.type === 'vCenterServer'
        ) || [];

        console.log(`[Inventory Lookup] Found ${vCenters.length} vCenters`);

        if (vCenters.length === 0) {
            return NextResponse.json(
                { error: 'No vCenter servers found in inventory', workload: null },
                { status: 404 }
            );
        }

        // Try each vCenter to find the workload by name
        for (const vCenter of vCenters) {
            const searchUrl = `${baseInternalUrl}/api/veeam/inventory/${vCenter.hostName}`;
            console.log(`[Inventory Lookup] Searching vCenter: ${vCenter.hostName} for "${name}"`);

            // Build filter to search VMs by name
            const filterBody = {
                filter: {
                    type: "GroupExpression",
                    operation: "and",
                    items: [
                        {
                            type: "PredicateExpression",
                            operation: "in",
                            property: "Type",
                            value: "VirtualMachine"
                        },
                        {
                            type: "PredicateExpression",
                            operation: "equals",
                            property: "name",
                            value: name
                        }
                    ]
                }
            };

            try {
                const searchResponse = await fetch(searchUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Cookie': cookieHeader,
                    },
                    body: JSON.stringify(filterBody),
                });

                if (searchResponse.ok) {
                    const searchData = await searchResponse.json();
                    console.log(`[Inventory Lookup] vCenter ${vCenter.hostName} returned ${searchData.data?.length || 0} results`);

                    if (searchData.data && searchData.data.length > 0) {
                        const workload = searchData.data[0] as InventoryItem;
                        console.log(`[Inventory Lookup] Found workload: ${workload.name}`);

                        // Parse URN to get datacenter and cluster IDs
                        const { datacenterId, clusterId, esxHostId } = parseUrn(workload.urn || '');
                        console.log(`[Inventory Lookup] Parsed URN - DC: ${datacenterId}, Cluster: ${clusterId}, ESX: ${esxHostId}`);

                        // Resolve Datacenter and Cluster names
                        let datacenterName: string | null = null;
                        let clusterName: string | null = null;
                        let esxHostName: string | null = null;

                        if (datacenterId || clusterId || esxHostId) {
                            // Query to get Datacenters and Clusters
                            // Use OR group since 'in' with array causes 400 error
                            const resolveFilterBody = {
                                filter: {
                                    type: "GroupExpression",
                                    operation: "or",
                                    items: [
                                        {
                                            type: "PredicateExpression",
                                            operation: "equals",
                                            property: "Type",
                                            value: "Datacenter"
                                        },
                                        {
                                            type: "PredicateExpression",
                                            operation: "equals",
                                            property: "Type",
                                            value: "Cluster"
                                        },
                                        {
                                            type: "PredicateExpression",
                                            operation: "equals",
                                            property: "Type",
                                            value: "Host"
                                        }
                                    ]
                                }
                            };

                            try {
                                const resolveResponse = await fetch(searchUrl, {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Cookie': cookieHeader,
                                    },
                                    body: JSON.stringify(resolveFilterBody),
                                });

                                if (resolveResponse.ok) {
                                    const resolveData = await resolveResponse.json();
                                    const items = resolveData.data as InventoryItem[] || [];

                                    console.log(`[Inventory Lookup] Resolve query returned ${items.length} DC/Cluster/Host items`);

                                    // Find Datacenter by objectId
                                    if (datacenterId) {
                                        const dc = items.find(item =>
                                            item.type === 'Datacenter' && item.objectId === datacenterId
                                        );
                                        if (dc) {
                                            datacenterName = dc.name;
                                            console.log(`[Inventory Lookup] Resolved DC: ${datacenterId} -> ${datacenterName}`);
                                        }
                                    }

                                    // Find Cluster by objectId
                                    if (clusterId) {
                                        const cluster = items.find(item =>
                                            item.type === 'Cluster' && item.objectId === clusterId
                                        );
                                        if (cluster) {
                                            clusterName = cluster.name;
                                            console.log(`[Inventory Lookup] Resolved Cluster: ${clusterId} -> ${clusterName}`);
                                        }
                                    }

                                    // Find ESXi Host by objectId
                                    if (esxHostId) {
                                        const esxHost = items.find(item =>
                                            item.type === 'Host' && item.objectId === esxHostId
                                        );
                                        if (esxHost) {
                                            esxHostName = esxHost.name;
                                            console.log(`[Inventory Lookup] Resolved ESX: ${esxHostId} -> ${esxHostName}`);
                                        }
                                    }
                                }
                            } catch (resolveErr) {
                                console.warn('[Inventory Lookup] Error resolving DC/Cluster names:', resolveErr);
                            }
                        }

                        return NextResponse.json({
                            workload,
                            vCenter: vCenter.hostName,
                            datacenterName,
                            clusterName,
                            esxHostName
                        });
                    }
                } else {
                    const errText = await searchResponse.text().catch(() => '');
                    console.warn(`[Inventory Lookup] vCenter ${vCenter.hostName} search failed: ${searchResponse.status} - ${errText}`);
                }
            } catch (err) {
                console.warn(`[Inventory Lookup] Error querying vCenter ${vCenter.hostName}:`, err);
                // Continue to next vCenter
            }
        }

        // If name search didn't find anything, log it
        console.log(`[Inventory Lookup] Workload not found: name="${name}"`);

        return NextResponse.json(
            { error: 'Workload not found in inventory', workload: null },
            { status: 404 }
        );

    } catch (error) {
        console.error('[INVENTORY LOOKUP] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal Server Error' },
            { status: 500 }
        );
    }
}
