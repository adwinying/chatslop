// Attachment rules the browser's intake and the server's re-checks share (#8).

export type AttachmentKind = 'image' | 'pdf' | 'text'

/** Intake stores images, PDFs, and everything else as `text/plain`. */
export const kindOf = (mediaType: string): AttachmentKind =>
  mediaType === 'application/pdf'
    ? 'pdf'
    : mediaType.startsWith('image/')
      ? 'image'
      : 'text'

export const KIND_PLURAL = { image: 'images', pdf: 'PDFs', text: 'text files' }

export const MAX_ATTACHMENTS = 10

const MB = 1024 * 1024
/** Images are small once the browser downscales them; their cap only guards the server. */
export const MAX_BYTES = { image: 10 * MB, pdf: 10 * MB, text: 256 * 1024 }
export const SIZE_LABEL = { image: '10 MB', pdf: '10 MB', text: '256 KB' }

/** UTF-8 text without NUL, or null. */
export function decodeText(bytes: Uint8Array) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.includes('\0') ? null : text
  } catch {
    return null
  }
}
