/** Khớp caption_for_image trong send_whatsapp.py */
export function captionForImage(fileName: string, messageTeam: string): string {
  const label = messageTeam.trim()
  const upper = fileName.toUpperCase()
  if (upper.includes('_XLSC')) return `Tồn XLSC ${label}`
  if (upper.includes('_TKM')) return `Tồn TKM ${label}`
  return ''
}
