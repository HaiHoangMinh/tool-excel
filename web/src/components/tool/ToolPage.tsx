import type { AppController } from '../../hooks/useAppController'
import { ExcelUploadHero } from '../upload/ExcelUploadHero'
import { ValidationBanner } from '../workflow/WorkflowStepper'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'

export function ToolPage({ app }: { app: AppController }) {
  const lastJob = app.jobs[0]

  return (
    <div className="tool-page">
      <header className="tool-header">
        <div>
          <h1>Tool Excel — Báo cáo theo đội</h1>
          <p className="tool-header__sub">
            Upload · xuất ảnh · gửi WhatsApp (cần WA Bridge trên Windows)
          </p>
        </div>
        <div className="tool-header__meta">
          <Badge tone={app.bridgeOnline ? 'success' : 'warning'}>
            {app.bridgeOnline ? 'WA Bridge: bật' : 'WA Bridge: tắt'}
          </Badge>
          <Badge tone={app.busy ? 'warning' : 'neutral'}>
            {app.busy ? 'Đang xử lý' : 'Sẵn sàng'}
          </Badge>
          <span data-testid="tool-status" className="tool-status">
            {app.status}
          </span>
        </div>
      </header>

      <ExcelUploadHero app={app} />
      <ValidationBanner app={app} />

      <section className="tool-actions panel-block">
        <Button onClick={app.handleSave} disabled={app.busy}>
          Lưu cài đặt
        </Button>
        <Button onClick={() => app.runExport(false)} disabled={app.busy}>
          Xuất ảnh (tải PNG)
        </Button>
        <Button onClick={() => app.runExport(true)} disabled={app.busy}>
          Tải ZIP ảnh
        </Button>
        <Button
          onClick={() => app.runJob('send')}
          disabled={app.busy || !app.bridgeOnline}
          title={app.bridgeOnline ? '' : 'Chạy Mo Web + WA Bridge.bat'}
        >
          Gửi WhatsApp
        </Button>
        <Button
          variant="primary"
          onClick={() => app.runJob('both')}
          disabled={app.busy || !app.bridgeOnline}
          title={app.bridgeOnline ? '' : 'Chạy Mo Web + WA Bridge.bat'}
        >
          Xuất ảnh + Gửi WhatsApp
        </Button>
        {lastJob && (
          <span className="muted tool-actions__hint">
            Lần xuất gần nhất: {lastJob.imagesOk} ảnh · {(lastJob.durationMs / 1000).toFixed(1)}s
          </span>
        )}
      </section>

      <section className="panel-block">
        <header className="panel-block__head">
          <h3>Cấu hình đội & WhatsApp</h3>
          <div className="panel-block__tools">
            <label className="check-inline">
              <input
                type="checkbox"
                checked={app.allSelected}
                onChange={(e) => app.toggleSelectAll(e.target.checked)}
              />
              Chọn tất cả (xuất / gửi)
            </label>
            <button type="button" className="link-quiet" onClick={() => app.importRef.current?.click()}>
              Nhập settings_cache.json
            </button>
            <input
              ref={app.importRef}
              data-testid="import-json-input"
              type="file"
              accept=".json"
              onChange={app.importSettingsJson}
              hidden
            />
          </div>
        </header>
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Gửi</th>
                <th>Tên đội</th>
                <th>Tên nhóm WhatsApp</th>
                <th>Tên trong tin (XLSC/TKM)</th>
              </tr>
            </thead>
            <tbody>
              {app.teamNames.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-cell">
                    Tải file Excel để hiện danh sách đội.
                  </td>
                </tr>
              ) : (
                app.teamNames.map((team) => {
                  const cfg = app.cache.teams[team]
                  return (
                    <tr key={team}>
                      <td>
                        <input
                          type="checkbox"
                          checked={cfg?.send ?? false}
                          onChange={(e) => app.updateTeam(team, { send: e.target.checked })}
                        />
                      </td>
                      <td className="team-name">{team}</td>
                      <td>
                        <input
                          className="field"
                          type="text"
                          value={cfg?.whatsapp_group ?? ''}
                          onChange={(e) =>
                            app.updateTeam(team, { whatsapp_group: e.target.value })
                          }
                          placeholder="Tên nhóm trên WhatsApp Web"
                        />
                      </td>
                      <td>
                        <input
                          className="field"
                          type="text"
                          value={cfg?.message_text ?? team}
                          onChange={(e) =>
                            app.updateTeam(team, { message_text: e.target.value })
                          }
                        />
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel-block">
        <h3>WhatsApp</h3>
        <p className="muted tool-wa-intro">
          {app.bridgeOnline
            ? 'Nút Gửi WhatsApp dùng Chrome + Playwright giống tool desktop (lần đầu quét QR).'
            : 'Chạy file Mo Web + WA Bridge.bat cùng thư mục tool để bật gửi tự động. Tạm thời có thể copy tin bên dưới.'}
        </p>
        {Object.keys(app.waMap).length === 0 ? (
          <p className="muted">Bật &quot;Gửi&quot; và điền tên nhóm cho ít nhất 1 đội.</p>
        ) : (
          <ul className="wa-send-list">
            {Object.entries(app.waMap).map(([team, group]) => (
              <li key={team}>
                <div>
                  <strong>{team}</strong>
                  <span className="muted"> → {group}</span>
                </div>
                <div className="wa-send-list__actions">
                  <Button size="sm" onClick={() => app.copyMessage(team)}>
                    Copy tin
                  </Button>
                  {app.lastExports.some((x) => x.team === team) && (
                    <Badge tone="success">Đã có ảnh</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-block log-panel">
        <h3>Nhật ký</h3>
        <pre data-testid="tool-log" className="log">
          {app.logs.join('\n') || '—'}
        </pre>
      </section>
    </div>
  )
}
