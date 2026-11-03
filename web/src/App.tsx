import { ToastProvider } from './components/ui/Toast'
import { ToolPage } from './components/tool/ToolPage'
import { useAppController } from './hooks/useAppController'
import './styles/app.css'

function AppRoutes() {
  const app = useAppController()
  return (
    <div className="app-root">
      <ToolPage app={app} />
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AppRoutes />
    </ToastProvider>
  )
}
