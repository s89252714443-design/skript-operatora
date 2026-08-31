import { useEffect, useRef, useState } from 'react'
import { pillHtml, escapeHtml, boundsOf } from './markerPill.js'
import { formatDistance } from '../core/ranking.js'
import { buildStyle, usePmtiles, PMTILES_URL } from '../core/basemap.js'

// Карта на MapLibre GL. Подложка выбирается в core/basemap.js:
// свой файл .pmtiles либо тайлы OpenStreetMap. Ключи не нужны ни там, ни там.
//
// ВАЖНО: MapLibre принимает координаты в порядке [долгота, широта] — наоборот
// относительно наших данных, где везде [широта, долгота]. Конвертация сделана
// явно в каждом месте; при правках это легко забыть.
//
// Клики по меткам ловим делегированием на контейнере по атрибуту data-clinic:
// так обработчик не зависит от событийной модели конкретной карты, и подложку
// можно менять, не трогая логику выбора клиники.

// Паузы перед повторной подгонкой, пока контейнер не разложится гридом
const RETRY_DELAYS = [50, 120, 250, 500, 1000, 2000]

const CITY_CENTER = {
  msk: [37.6156, 55.7522], // [долгота, широта]
  spb: [30.3351, 59.9343],
}

export default function MapView({ rows, origin, cityId, selectedKey, onSelect, onOpen }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const glRef = useRef(null)
  const markersRef = useRef([]) // [{ key, marker, el }]
  const pointsRef = useRef([])
  const retryRef = useRef(null)
  const handlersRef = useRef({ onSelect, onOpen })
  handlersRef.current = { onSelect, onOpen }

  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)

  // Подогнать карту под точки.
  //
  // Контейнер может быть ещё не разложен гридом в момент создания карты —
  // тогда карта считает свой размер крошечным и уезжает на весь регион.
  // ResizeObserver и requestAnimationFrame тут не всегда спасают (во встроенных
  // панелях, которые не рисуют кадры, они просто не вызываются), поэтому
  // повторяем попытку по таймеру, пока контейнер не получит нормальный размер.
  const refit = (attempt = 0) => {
    const map = mapRef.current
    const box = boxRef.current
    const points = pointsRef.current
    if (!map || !box || !points.length) return

    const tooSmall = box.clientWidth < 120 || box.clientHeight < 120
    if (tooSmall && attempt < RETRY_DELAYS.length) {
      clearTimeout(retryRef.current)
      retryRef.current = setTimeout(() => refitRef.current(attempt + 1), RETRY_DELAYS[attempt])
      return
    }

    map.resize()

    if (points.length === 1) {
      map.jumpTo({ center: [points[0][1], points[0][0]], zoom: 14 })
      return
    }
    const b = boundsOf(points)
    map.fitBounds(
      [
        [b.minLng, b.minLat],
        [b.maxLng, b.maxLat],
      ],
      { padding: 48, animate: false }
    )
  }
  const refitRef = useRef(refit)
  refitRef.current = refit

  // ── создание карты ───────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    let observer = null
    let onWindowResize = null
    let onContainerClick = null

    Promise.all([
      import('maplibre-gl'),
      usePmtiles ? import('pmtiles') : null,
      // MapLibre собирает адрес своего воркера сам, из import.meta.url. В деве
      // это работает, а в сборке файла по такому адресу нет: Vite не видит
      // ссылку и не кладёт воркер в dist — карта молча не запускается.
      // Импортируем воркер явно, тогда Vite его собирает, а адрес мы задаём
      // руками через setWorkerUrl.
      import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
    ])
      // у maplibre-gl нет default-экспорта, берём весь модуль
      .then(async ([maplibregl, pmtilesMod, worker]) => {
        if (cancelled || !boxRef.current || mapRef.current) return

        maplibregl.setWorkerUrl(worker.default)

        // протокол pmtiles:// нужен, чтобы MapLibre читал наш статичный файл
        if (pmtilesMod) {
          const protocol = new pmtilesMod.Protocol()
          maplibregl.addProtocol('pmtiles', protocol.tile)
        }

        const map = new maplibregl.Map({
          container: boxRef.current,
          style: buildStyle(),
          center: CITY_CENTER[cityId] ?? CITY_CENTER.msk,
          zoom: 10,
          attributionControl: { compact: true },
        })
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
        map.on('error', (e) => {
          const msg = e?.error?.message ?? ''
          if (msg) setError(msg)
        })

        glRef.current = maplibregl
        mapRef.current = map

        onContainerClick = (e) => {
          const pill = e.target.closest?.('[data-clinic]')
          if (!pill) return
          const key = pill.getAttribute('data-clinic')
          if (e.detail >= 2) handlersRef.current.onOpen(key)
          else handlersRef.current.onSelect(key)
        }
        boxRef.current.addEventListener('click', onContainerClick)

        observer = new ResizeObserver(() => refitRef.current())
        observer.observe(boxRef.current)
        onWindowResize = () => refitRef.current()
        window.addEventListener('resize', onWindowResize)

        setReady(true)
        refitRef.current()
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? String(e))
      })

    return () => {
      cancelled = true
      observer?.disconnect()
      if (onWindowResize) window.removeEventListener('resize', onWindowResize)
      if (onContainerClick) boxRef.current?.removeEventListener('click', onContainerClick)
      clearTimeout(retryRef.current)
      try {
        mapRef.current?.remove()
      } catch {
        // карта могла не успеть создаться — это нормально
      }
      mapRef.current = null
      markersRef.current = []
      setReady(false)
    }
  }, [cityId])

  // ── точки ────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Точки считаем всегда, даже до появления карты: подгонка может
    // сработать раньше, чем отрисуются метки, и должна уже знать границы.
    pointsRef.current = [
      ...(origin?.lat != null ? [[origin.lat, origin.lng]] : []),
      ...rows.filter((r) => r.clinic.lat != null).map((r) => [r.clinic.lat, r.clinic.lng]),
    ]

    const maplibregl = glRef.current
    const map = mapRef.current
    if (!maplibregl || !map) return

    for (const { marker } of markersRef.current) marker.remove()
    markersRef.current = []

    if (origin?.lat != null) {
      const el = document.createElement('div')
      el.innerHTML = `<div title="Пациенту удобно здесь: ${escapeHtml(origin.place.name)}" style="
          width:20px; height:20px; border-radius:50%;
          background:rgba(59,130,246,.35); border:3px solid #2563eb;"></div>`
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([origin.lng, origin.lat])
        .addTo(map)
      markersRef.current.push({ key: '__origin', marker, el })
    }

    rows.forEach((r, i) => {
      const { clinic } = r
      if (clinic.lat == null) return
      const el = document.createElement('div')
      el.innerHTML = pillHtml(r, i, r.key === selectedKey)
      const d = formatDistance(r.distanceMeters)
      const cost = r.clinicService.avgCaseCost
      el.title =
        `${clinic.name}\n${clinic.address}` +
        (d ? `\n${d} по прямой` : '') +
        (cost != null ? `\nСредняя стоимость кейса: ${cost.toLocaleString('ru-RU')} ₽` : '')
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([clinic.lng, clinic.lat])
        .addTo(map)
      markersRef.current.push({ key: r.key, marker, el })
    })

    refit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, origin, ready])

  // ── подсветка выбранной точки без пересчёта границ ────────────────────────
  useEffect(() => {
    markersRef.current.forEach(({ key, el }) => {
      if (key === '__origin') return
      const i = rows.findIndex((r) => r.key === key)
      if (i === -1) return
      el.innerHTML = pillHtml(rows[i], i, key === selectedKey)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, ready])

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-slate-200 ring-1 ring-slate-200">
      <div ref={boxRef} className="h-full w-full" />

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/95 p-6">
          <div className="max-w-md">
            <p className="text-sm font-semibold text-slate-900">Подложка карты не загрузилась</p>
            <p className="mt-1 text-sm text-slate-600">{error}</p>
            <ul className="mt-3 space-y-1 text-xs text-slate-500">
              {usePmtiles ? (
                <>
                  <li>· проверьте, что файл доступен: {PMTILES_URL}</li>
                  <li>· сервер должен отдавать его с поддержкой Range-запросов</li>
                </>
              ) : (
                <>
                  <li>· нет интернета или блокировщик режет tile.openstreetmap.org</li>
                  <li>· для работы без интернета переключитесь на свой файл .pmtiles</li>
                </>
              )}
            </ul>
            <p className="mt-3 text-xs text-slate-400">
              Подбор клиник и сообщения работают и без карты — список справа.
            </p>
          </div>
        </div>
      )}

      {!error && !ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70">
          <p className="text-sm text-slate-500">Загружаем карту…</p>
        </div>
      )}

      {ready && rows.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/70">
          <p className="rounded-lg bg-white px-4 py-2 text-sm text-slate-500 shadow">
            Под эти условия клиник нет
          </p>
        </div>
      )}
    </div>
  )
}
