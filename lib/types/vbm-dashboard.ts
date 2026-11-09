// Open Backup UI v1.0.2
export interface VBMLicense {
    licenseID: string;
    email: string;
    status: string; // "Valid"
    licenseExpires: string;
    gracePeriodExpires: string;
    type: string; // "Rental"
    package: string; // "M365Suite"
    licensedTo: string;
    totalNumber: number;
    usedNumber: number;
    newNumber: number;
    supportID: string;
}

export interface VBMHealth {
    status: string; // "Healthy"
    entries: {
        configurationDb: {
            status: string;
        };
        nats: {
            status: string;
        };
    };
}

export interface VBMServiceInstance {
    installationId: string;
    version: string;
}
