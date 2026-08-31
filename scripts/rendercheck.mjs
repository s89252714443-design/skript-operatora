import { createServer } from 'vite'
import { renderToString } from 'react-dom/server'
import React from 'react'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const mod = await vite.ssrLoadModule('/src/App.jsx')
  const html = renderToString(React.createElement(mod.default))
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  console.log('РЕНДЕР OK, длина HTML:', html.length)
  console.log('---')
  console.log(text.slice(0, 1400))
} catch (e) {
  console.error('ОШИБКА РЕНДЕРА:', e.message)
  console.error(e.stack?.split('\n').slice(0, 6).join('\n'))
  process.exitCode = 1
} finally {
  await vite.close()
}
