"use client";

import React, { useEffect, useState } from 'react';
import { VeeamProxy } from '@/lib/types/veeam';
import { veeamApi as veeamApiClient } from '@/lib/api/veeam-client';
import { BackupProxiesTable } from '@/components/backup-proxies-table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Server } from 'lucide-react';

export default function BackupProxiesPage() {
    const [proxies, setProxies] = useState<VeeamProxy[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchProxies = async () => {
        setLoading(true);
        try {
            const data = await veeamApiClient.getEnrichedBackupProxies();
            setProxies(data);
        } catch (error) {
            console.error('Failed to fetch proxies:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProxies();
    }, []);

    return (
        <div className="container mx-auto py-8 px-4 space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Backup Proxies</h1>
                    <p className="text-muted-foreground">
                        Manage your backup proxy infrastructure effectively.
                    </p>
                </div>
            </div>

            <BackupProxiesTable
                data={proxies}
                isLoading={loading}
                onRefresh={fetchProxies}
            />
        </div>
    );
}
