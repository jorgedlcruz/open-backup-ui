// Open Backup UI v1.3.0
// Session enums and backup-object discriminators can name the same platform differently.
// Keep GA filter values stable for links and cached records. This maps incoming data only.
export function normalizeVbrPlatform<T extends string | null | undefined>(value: T): T | 'AWSEC2' | 'GCE' {
  if (value === 'AWS' || value === 'EC2') return 'AWSEC2'
  if (value === 'GoogleCloud') return 'GCE'
  return value
}
