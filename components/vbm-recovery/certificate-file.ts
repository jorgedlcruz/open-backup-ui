// Open Backup UI v1.3.0
// The Veeam restore payload accepts up to 131072 Base64 characters.
const maxCertificateBytes = 96 * 1024

export function certificateFileError(file: File) {
  if (!/\.(pfx|p12)$/i.test(file.name) || file.size === 0) return 'Choose a PFX or P12 certificate file.'
  if (file.size > maxCertificateBytes) return 'Choose a certificate file of 96 KiB or less.'
}

export async function readRestoreCertificate(file: File) {
  if (certificateFileError(file)) throw new Error('Invalid certificate selection')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength !== file.size) throw new Error('Incomplete certificate file')
  let binary = ''
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192))
  }
  return btoa(binary)
}
