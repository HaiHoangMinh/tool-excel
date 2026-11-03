import html2canvas from 'html2canvas'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import type { TableData } from './excel'
import { sanitizeFilename } from './excel'

const TABLE_STYLES: Record<string, string> = {
  borderCollapse: 'collapse',
  fontFamily: 'Calibri, Arial, sans-serif',
  fontSize: '11px',
  background: '#fff',
  color: '#000',
}

const TH_STYLES: Record<string, string> = {
  border: '1px solid #b4b4b4',
  padding: '4px 6px',
  background: '#d9d9d9',
  fontWeight: '700',
  textAlign: 'left',
  whiteSpace: 'nowrap',
}

const TD_STYLES: Record<string, string> = {
  border: '1px solid #d4d4d4',
  padding: '3px 6px',
  verticalAlign: 'top',
  maxWidth: '220px',
  wordBreak: 'break-word',
}

/** Tạo DOM bảng tạm để chụp ảnh (không phụ thuộc React render). */
function buildTableElement(
  title: string,
  data: TableData,
): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.style.cssText =
    'position:fixed;left:-10000px;top:0;background:#fff;padding:8px;z-index:-1;'
  const caption = document.createElement('div')
  caption.textContent = title
  caption.style.cssText = 'font:bold 13px Calibri,Arial;margin-bottom:6px;'
  wrap.appendChild(caption)

  const table = document.createElement('table')
  Object.assign(table.style, TABLE_STYLES)

  const thead = document.createElement('thead')
  const hr = document.createElement('tr')
  for (const h of data.headers) {
    const th = document.createElement('th')
    Object.assign(th.style, TH_STYLES)
    th.textContent = h
    hr.appendChild(th)
  }
  thead.appendChild(hr)
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  for (const row of data.rows) {
    const tr = document.createElement('tr')
    for (const cell of row) {
      const td = document.createElement('td')
      Object.assign(td.style, TD_STYLES)
      td.textContent = cell
      tr.appendChild(td)
    }
    tbody.appendChild(tr)
  }
  table.appendChild(tbody)
  wrap.appendChild(table)
  document.body.appendChild(wrap)
  return wrap
}

export async function tableToPngBlob(data: TableData, title: string): Promise<Blob> {
  const el = buildTableElement(title, data)
  try {
    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
    })
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Không tạo được PNG'))),
        'image/png',
      )
    })
  } finally {
    el.remove()
  }
}

export type ExportItem = {
  team: string
  suffix: string
  fileName: string
  blob: Blob
}

export async function zipExportItems(items: ExportItem[], zipName: string): Promise<void> {
  const zip = new JSZip()
  const root = zip.folder(zipName.replace(/\.zip$/i, ''))
  for (const item of items) {
    const safe = sanitizeFilename(item.team)
    const folder = root?.folder(safe)
    folder?.file(item.fileName, item.blob)
  }
  const content = await zip.generateAsync({ type: 'blob' })
  saveAs(content, zipName)
}

export function downloadBlob(blob: Blob, fileName: string): void {
  saveAs(blob, fileName)
}
