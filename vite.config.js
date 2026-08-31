import { writeFileSync, readFileSync, copyFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Кнопка «Сохранить» в админке пишет правки прямо в data/overrides.json.
//
// Иначе сотруднику пришлось бы скачивать файл и класть его в папку руками —
// а он не программист. Обработчик живёт только в дев-сервере: на собранной
// статике писать некуда, там админка предложит скачать файл.
//
// Пишем только этот один файл и только объект с известными разделами:
// эндпоинт открыт всем, кто дотянулся до дев-сервера, и превращать его
// в «запиши что угодно куда угодно» нельзя.
const OVERRIDES_PATH = 'data/overrides.json'
const ALLOWED_KEYS = new Set([
  '_comment',
  'clinics',
  'clinicServices',
  'clinicMetro',
  'clinicPhotos',
  'clinicYandex',
  'doctors',
  'sellingPoints',
  'content',
])
const MAX_BODY_BYTES = 2 * 1024 * 1024

// MapLibre вычисляет адрес своего воркера сам: new URL('./maplibre-gl-worker.mjs',
// import.meta.url) рядом со своим чанком. Vite такую ссылку не видит и файл
// в сборку не кладёт — карта в собранной версии просто не запускается,
// а в консоли только «text/html вместо скрипта». Задать адрес через
// setWorkerUrl мало: maplibre всё равно обращается к своему имени.
// Поэтому кладём файл ровно туда и ровно под тем именем, которое он ищет.
function maplibreWorker() {
  return {
    name: 'skript-maplibre-worker',
    apply: 'build',
    closeBundle() {
      // воркер тянет за собой общий модуль — без него он падает уже в браузере
      for (const name of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
        copyFileSync(
          resolve(process.cwd(), 'node_modules/maplibre-gl/dist', name),
          resolve(process.cwd(), 'dist/assets', name)
        )
      }
    },
  }
}

function overridesApi() {
  return {
    name: 'skript-overrides-api',
    configureServer(server) {
      server.middlewares.use('/api/overrides', (req, res, next) => {
        if (req.method !== 'POST') return next()

        let body = ''
        let tooBig = false
        req.on('data', (chunk) => {
          body += chunk
          if (body.length > MAX_BODY_BYTES) {
            tooBig = true
            req.destroy()
          }
        })

        req.on('end', () => {
          const fail = (code, error) => {
            res.statusCode = code
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: false, error }))
          }

          if (tooBig) return fail(413, 'Слишком большой файл правок')

          let data
          try {
            data = JSON.parse(body)
          } catch {
            return fail(400, 'Тело запроса — не JSON')
          }
          if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return fail(400, 'Ожидался объект с правками')
          }
          const unknown = Object.keys(data).filter((k) => !ALLOWED_KEYS.has(k))
          if (unknown.length) {
            return fail(400, `Неизвестные разделы: ${unknown.join(', ')}`)
          }

          const path = resolve(server.config.root, OVERRIDES_PATH)
          try {
            // комментарий из файла не теряем: он объясняет, что это за файл
            const previous = JSON.parse(readFileSync(path, 'utf8'))
            const out = { _comment: previous._comment, ...data }
            writeFileSync(path, JSON.stringify(out, null, 2), 'utf8')
          } catch (e) {
            return fail(500, `Не удалось записать ${OVERRIDES_PATH}: ${e.message}`)
          }

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: true, path: OVERRIDES_PATH }))
        })
      })
    },
  }
}

// На GitHub Pages сайт живёт в подпапке с именем репозитория, локально —
// в корне. Поэтому base задаём только для сборки: иначе дев-сервер тоже
// уехал бы на /skript-operatora/ и привычный localhost:5173 перестал бы
// открываться.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/skript-operatora/' : '/',
  plugins: [react(), tailwindcss(), overridesApi(), maplibreWorker()],
  // host: true — сервер слушает все интерфейсы, а не только этот компьютер:
  // коллеги в той же сети открывают прототип по адресу вида
  // http://192.168.0.161:5173. Раньше стояло 127.0.0.1, потому что «localhost»
  // на этой машине резолвится в ::1, а IPv6-loopback не отвечает — при host: true
  // это уже не мешает, страница открывается и локально.
  server: { host: true, port: 5173, strictPort: true },
}))
