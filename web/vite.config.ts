import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Dev only: tải Book1 / settings khi trình duyệt chặn input file. */
function devLocalFilesPlugin() {
  return {
    name: 'dev-local-files',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use('/dev-local/book1.xlsm', (_req, res, _next) => {
        const p = path.join(repoRoot, 'Book1.xlsm')
        if (!fs.existsSync(p)) {
          res.statusCode = 404
          res.end('Thiếu Book1.xlsm ở thư mục gốc repo')
          return
        }
        res.setHeader(
          'Content-Type',
          'application/vnd.ms-excel.sheet.macroEnabled.12',
        )
        fs.createReadStream(p).pipe(res)
      })
      server.middlewares.use('/dev-local/settings_cache.json', (_req, res) => {
        const p = path.join(repoRoot, 'settings_cache.json')
        if (!fs.existsSync(p)) {
          res.statusCode = 404
          res.end('{}')
          return
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        fs.createReadStream(p).pipe(res)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), devLocalFilesPlugin()],
})
