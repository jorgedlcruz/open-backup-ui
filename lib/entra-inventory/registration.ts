// Open Backup UI v1.3.0
import { z } from 'zod'
import type { VbrRevision } from '../vbr/revision'

export const maxPfxBytes = 1024 * 1024
const certificate = z.string().min(4).max(4 * Math.ceil(maxPfxBytes / 3))
  .regex(/^[A-Za-z0-9+/]+={0,2}$/)
  .refine(value => value.length % 4 === 0 && Buffer.byteLength(value, 'base64') <= maxPfxBytes)
export const tenantRegistration = z.object({
  sourceKey: z.string().regex(/^[a-f0-9]{64}$/),
  azureTenantId: z.string().uuid(),
  applicationId: z.string().uuid(),
  region: z.enum(['Global', 'China', 'Government']).default('Global'),
  cacheRepositoryId: z.string().uuid().optional(),
  description: z.string().trim().max(1024).optional(),
  credential: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('secret'), secret: z.string().min(1).max(8192) }).strict(),
    z.object({ kind: z.literal('certificate'), certificate, password: z.string().max(8192).optional() }).strict(),
  ]),
}).strict()

export function registrationPayload(form: z.infer<typeof tenantRegistration>, revision: VbrRevision) {
  const { credential, applicationId, azureTenantId, description, cacheRepositoryId, region } = form
  const firstRelease = revision === '1.3-rev0'
  const authentication = credential.kind === 'secret'
    ? { applicationId, secret: credential.secret }
    : { applicationId, certificate: { formatType: firstRelease ? 'pfx' : 'Pfx', certificate: credential.certificate, password: credential.password } }
  return { azureTenantId, creationMode: firstRelease ? 'existingAccount' : 'ExistingAccount',
    existingAccount: { authentication }, description, cacheRepositoryId, region }
}
