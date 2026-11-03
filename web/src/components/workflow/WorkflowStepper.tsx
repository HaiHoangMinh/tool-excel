import type { AppController } from '../../hooks/useAppController'
import { Badge } from '../ui/Badge'

export function ValidationBanner({ app }: { app: AppController }) {
  if (!app.validation) return null
  const { ok, errors, warnings, teamCount } = app.validation
  return (
    <div className={`validation ${ok ? 'validation--ok' : 'validation--err'}`}>
      <div className="validation__head">
        <strong>{ok ? 'Dữ liệu hợp lệ' : 'Cần kiểm tra dữ liệu'}</strong>
        <Badge tone={ok ? 'success' : 'error'}>{teamCount} đội</Badge>
      </div>
      {errors.length > 0 && (
        <ul className="validation__list">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="validation__list validation__list--warn">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
