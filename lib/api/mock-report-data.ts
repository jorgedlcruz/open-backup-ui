// Open Backup UI v1.0.2

export const MOCK_PROTECTED_VMS_SUMMARY = {
    "columns": [
        { "name": "Metric", "type": "String" },
        { "name": "Value", "type": "Integer" }
    ],
    "rows": [
        ["Total VMs", 50],
        ["Protected VMs", 45],
        ["Unprotected VMs", 5],
        ["Excluded VMs", 0]
    ]
};

export const MOCK_PROTECTED_VMS_CHART = {
    "series": [
        {
            "name": "Status",
            "data": [
                { "name": "Protected", "y": 45, "color": "#4caf50" },
                { "name": "Unprotected", "y": 5, "color": "#f44336" }
            ]
        }
    ]
};

export const MOCK_LAST_BACKUP_AGE_CHART = {
    "series": [
        {
            "name": "Age",
            "data": [
                { "name": "< 24 hours", "y": 40 },
                { "name": "24-48 hours", "y": 3 },
                { "name": "> 48 hours", "y": 2 }
            ]
        }
    ]
};

export const MOCK_VM_DETAILS_TABLE = {
    "columns": [
        { "name": "VM Name", "title": "VM Name" },
        { "name": "Platform", "title": "Platform" },
        { "name": "Last Backup", "title": "Last Backup" },
        { "name": "Restore Points", "title": "Restore Points" },
        { "name": "Status", "title": "Status" }
    ],
    "rows": Array.from({ length: 15 }).map((_, i) => [
        `VM-${i + 100}`,
        i % 2 === 0 ? "VMware vSphere" : "Hyper-V",
        new Date(Date.now() - i * 3600000).toISOString(),
        Math.floor(Math.random() * 10) + 1,
        i < 13 ? "Protected" : "Unprotected"
    ])
};
