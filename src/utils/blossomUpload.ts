/**
 * Blossom image upload utility.
 *
 * Implements NIP-98 HTTP Auth for Blossom blob uploads:
 *  1. Compute SHA-256 of the file using Web Crypto API.
 *  2. Create and sign a kind:27235 (NIP-98) auth event.
 *  3. PUT the file to <blossomUrl>/upload with the auth header.
 *  4. Return the URL of the uploaded blob.
 *
 * The returned URL is suitable for use as an <img src>.
 *
 * Reference: https://github.com/hzrd149/blossom/blob/master/docs/auth.md
 */

import type { SignerInterface } from '@cloistr/auth'

/** Convert ArrayBuffer to lowercase hex string. */
function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Compute the SHA-256 hex digest of a file. */
async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return bufToHex(digest)
}

/** The shape expected by the signer's signEvent method. */
interface UnsignedEvent {
  kind: number
  created_at: number
  tags: string[][]
  content: string
  pubkey?: string
}

interface BlobDescriptor {
  url: string
  sha256?: string
  size?: number
  type?: string
}

/** Blossom server error response. */
export class BlossomUploadError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'BlossomUploadError'
  }
}

/**
 * Upload a file to a Blossom server using NIP-98 HTTP Auth.
 *
 * @param file - The image / media file to upload.
 * @param blossomUrl - Base URL of the Blossom server (e.g. https://files.cloistr.xyz).
 * @param signer - NIP-46 signer providing signEvent().
 * @returns The public URL of the uploaded blob.
 */
export async function uploadToBlossom(
  file: File,
  blossomUrl: string,
  signer: SignerInterface,
): Promise<string> {
  const uploadUrl = `${blossomUrl.replace(/\/$/, '')}/upload`

  // 1. Hash the file so we can include it in the auth event.
  const fileHash = await sha256Hex(file)

  // 2. Build the NIP-98 auth event.
  const now = Math.floor(Date.now() / 1000)
  const authEvent: UnsignedEvent = {
    kind: 27235,
    created_at: now,
    tags: [
      ['u', uploadUrl],
      ['method', 'PUT'],
      ['payload', fileHash],
      // Blossom-specific: content hash for the blob being uploaded.
      ['x', fileHash],
      ['expiration', String(now + 300)], // 5-minute window
    ],
    content: '',
  }

  // signer.signEvent fills in pubkey and id, then returns the signed event.
  const signed = await (signer as unknown as { signEvent: (e: UnsignedEvent) => Promise<Record<string, unknown>> }).signEvent(authEvent)
  const authBase64 = btoa(JSON.stringify(signed))

  // 3. Upload.
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Nostr ${authBase64}`,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  })

  if (!response.ok) {
    let detail = ''
    try {
      const json = (await response.json()) as { message?: string }
      detail = json.message ?? ''
    } catch {
      detail = await response.text().catch(() => '')
    }
    throw new BlossomUploadError(
      response.status,
      `Blossom upload failed (${response.status})${detail ? ': ' + detail : ''}`,
    )
  }

  const descriptor = (await response.json()) as BlobDescriptor
  // Prefer the explicit URL; fall back to the canonical blob address.
  return descriptor.url ?? `${blossomUrl.replace(/\/$/, '')}/${descriptor.sha256 ?? fileHash}`
}
