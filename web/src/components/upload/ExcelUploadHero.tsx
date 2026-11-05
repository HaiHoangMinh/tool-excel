import type { AppController } from '../../hooks/useAppController'
import { Button } from '../ui/Button'

export function ExcelUploadHero({ app }: { app: AppController }) {
  const dragging = false
  return (
    <section
      className={`upload-hero ${app.uploadProgress != null ? 'upload-hero--busy' : ''}`}
      data-testid="excel-drop-zone"
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={app.onExcelDrop}
    >
      <div className="upload-hero__inner">
        <div className="upload-hero__icon" aria-hidden />
        <h2 className="upload-hero__title">Kéo thả file Excel vào đây</h2>
        <p className="upload-hero__sub">
          Hỗ trợ .xlsx, .xlsm, .xls, .csv · xử lý trên trình duyệt · tối đa theo bộ nhớ
          thiết bị
        </p>
        {app.fileMeta && (
          <div className="upload-hero__meta">
            <span>{app.fileMeta.name}</span>
            <span>{app.fileMeta.sizeLabel}</span>
            <span>{app.fileMeta.sheetNames.join(' · ')}</span>
          </div>
        )}
        {app.uploadProgress != null && (
          <div className="upload-progress">
            <div
              className="upload-progress__bar"
              style={{ width: `${app.uploadProgress}%` }}
            />
          </div>
        )}
        <div className="upload-hero__actions">
          <label className="upload-hero__file-label">
            Chọn file Excel
            <input
              ref={app.fileRef}
              data-testid="excel-file-input"
              type="file"
              accept=".xlsx,.xlsm,.xls,.csv"
              onChange={app.onFileChange}
              disabled={app.busy}
            />
          </label>
          <Button
            type="button"
            onClick={() => void app.pickExcelViaDialog()}
            disabled={app.busy}
          >
            Chọn file (hộp thoại)
          </Button>
          {import.meta.env.DEV && (
            <Button
              type="button"
              data-testid="dev-load-book1"
              onClick={() => void app.loadDevBook1()}
              disabled={app.busy}
            >
              Tải Book1 local
            </Button>
          )}
          <Button onClick={app.onSyncClick} disabled={app.busy || !app.workbook}>
            Đồng bộ đội từ Excel
          </Button>
        </div>
        {!dragging && (
          <p className="upload-hero__hint">
            Trình duyệt nhúng có thể chặn chọn file — kéo thả, Chrome/Edge, nút hộp thoại, hoặc
            (dev) Tải Book1 local.
          </p>
        )}
      </div>
    </section>
  )
}
