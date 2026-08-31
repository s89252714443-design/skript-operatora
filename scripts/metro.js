// Сборка справочника метро Москвы и Петербурга из OpenStreetMap.
//
// Почему OSM: данные актуальные и открытые, доступ бесплатный и без ключа —
// то же основание, что у карты и геокодера. Скрипт запускается вручную,
// результат кладётся в data/metro.json и дальше живёт в репозитории.
//
// Запуск:  npm run metro
//          npm run metro -- --city spb        (только один город)

import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'data/metro.json')
const RAW = resolve(ROOT, 'data/metro-osm-raw.json')

// Зеркала Overpass: основной сервер часто отвечает 504 под нагрузкой
const ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
]

const CITIES = [
  {
    id: 'msk',
    name: 'Москва',
    // сеть метро + МЦК: оператору его называют так же, как метро
    networks: ['Московский метрополитен', 'Московское центральное кольцо'],
    routeTypes: ['subway', 'light_rail'],
  },
  {
    id: 'spb',
    name: 'Санкт-Петербург',
    networks: ['Петербургский метрополитен'],
    routeTypes: ['subway'],
  },
]

const SEGMENT_MINUTES = 2.5
const DEFAULT_TRANSFER_MINUTES = 4
const TRANSFER_MAX_METERS = 400 // дальше это уже не пересадка, а прогулка

const argv = process.argv.slice(2)
const onlyCity = argv.includes('--city') ? argv[argv.indexOf('--city') + 1] : null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function overpass(query, label) {
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'skript-metro-import/0.1 (internal clinic routing tool)',
          },
        })
        if (!res.ok) {
          lastError = `${url.split('/')[2]} → HTTP ${res.status}`
          // 429 и 504 — сервер просит подождать, а не сломался запрос
          const patient = res.status === 429 || res.status === 504 || res.status >= 500
          console.log(`  ${label}: ${lastError}, ${patient ? 'жду и пробую снова' : 'следующее зеркало'}`)
          await sleep(patient ? 20000 : 5000)
          continue
        }
        return await res.json()
      } catch (e) {
        lastError = `${url.split('/')[2]} → ${String(e).slice(0, 80)}`
        console.log(`  ${label}: ${lastError}`)
      }
    }
    await sleep(15000 * (attempt + 1))
  }
  throw new Error(`Overpass не ответил: ${lastError}`)
}

function buildQuery(city) {
  // без кавычек внутри: они бы оборвали строку регулярки и запрос стал бы битым
  const nets = city.networks.join('|')
  const types = city.routeTypes.join('|')
  return `[out:json][timeout:600];
rel["type"="route"]["route"~"^(${types})$"]["network"~"^(${nets})$"];
out body;
node(r)["public_transport"="stop_position"];
out body;`
}

const haversine = (aLat, aLng, bLat, bLng) => {
  const R = 6371000
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLng = rad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, '-')
    .replace(/^-|-$/g, '')

// Названия в OSM бывают с уточнениями: «Арбатская (Арбатско-Покровская линия)»
const cleanName = (s) =>
  String(s ?? '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

async function collectCity(city) {
  console.log(`\n${city.name}:`)
  const data = await overpass(buildQuery(city), city.name)

  const relations = data.elements.filter((e) => e.type === 'relation')
  const nodes = new Map(data.elements.filter((e) => e.type === 'node').map((n) => [n.id, n]))
  console.log(`  маршрутов: ${relations.length}, остановочных узлов: ${nodes.size}`)

  // У линии обычно два маршрута — по одному на направление. Берём тот,
  // где станций больше: он описывает линию целиком.
  const byLine = new Map()
  for (const rel of relations) {
    const t = rel.tags ?? {}
    const stations = []
    const seen = new Set()
    for (const m of rel.members) {
      if (m.type !== 'node') continue
      const n = nodes.get(m.ref)
      const name = cleanName(n?.tags?.name)
      if (!name || seen.has(name)) continue
      seen.add(name)
      stations.push({ name, lat: n.lat, lng: n.lon })
    }
    if (stations.length < 2) continue

    const key = `${t.ref ?? t.name ?? rel.id}`
    const prev = byLine.get(key)
    if (!prev || stations.length > prev.stations.length) {
      byLine.set(key, {
        ref: t.ref ?? null,
        name: cleanName(t.name).replace(/\s*(внутреннее|внешнее) кольцо\s*/i, '').trim(),
        colour: t.colour ?? '#888888',
        stations,
      })
    }
  }

  const lines = []
  for (const [key, l] of byLine) {
    const lineId = `${city.id}-${slug(l.ref ?? key)}`
    const ring = /кольц/i.test(l.name)
    lines.push({
      id: lineId,
      cityId: city.id,
      name: l.name,
      color: l.colour,
      ...(ring ? { ring: true } : {}),
      stations: l.stations.map((s) => [
        `${lineId}-${slug(s.name)}`,
        s.name,
        Number(s.lat.toFixed(6)),
        Number(s.lng.toFixed(6)),
      ]),
    })
  }
  lines.sort((a, b) => a.name.localeCompare(b.name, 'ru'))

  const total = lines.reduce((n, l) => n + l.stations.length, 0)
  console.log(`  линий: ${lines.length}, станций: ${total}`)
  for (const l of lines) console.log(`    ${String(l.stations.length).padStart(3)} · ${l.name}`)

  return lines
}

// Пересадка — станции разных линий с одинаковым названием либо стоящие рядом.
function buildTransfers(lines) {
  const all = []
  for (const line of lines) {
    for (const [id, name, lat, lng] of line.stations) {
      all.push({ id, name, lat, lng, lineId: line.id, cityId: line.cityId })
    }
  }

  const transfers = []
  const made = new Set()
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]
      const b = all[j]
      if (a.cityId !== b.cityId || a.lineId === b.lineId) continue

      const sameName = a.name.toLowerCase() === b.name.toLowerCase()
      const meters = haversine(a.lat, a.lng, b.lat, b.lng)
      if (!sameName && meters > TRANSFER_MAX_METERS) continue
      // разные станции с одним названием в разных концах города — не пересадка
      if (sameName && meters > 1200) continue

      const key = [a.id, b.id].sort().join('|')
      if (made.has(key)) continue
      made.add(key)
      transfers.push([a.id, b.id, DEFAULT_TRANSFER_MINUTES])
    }
  }
  return transfers
}

// ── запуск ──────────────────────────────────────────────────────────────────
const wanted = CITIES.filter((c) => !onlyCity || c.id === onlyCity)
if (!wanted.length) {
  console.error(`Неизвестный город: ${onlyCity}. Доступны: ${CITIES.map((c) => c.id).join(', ')}`)
  process.exit(1)
}

console.log('Собираю справочник метро из OpenStreetMap…')

let lines = []
// если обновляем один город, второй берём из уже собранного файла
if (onlyCity && existsSync(OUT)) {
  const prev = JSON.parse(readFileSync(OUT, 'utf8'))
  lines = prev.lines.filter((l) => l.cityId !== onlyCity)
}

for (const [i, city] of wanted.entries()) {
  if (i > 0) await sleep(10000) // не долбим публичный сервер подряд
  lines = lines.concat(await collectCity(city))
}

const transfers = buildTransfers(lines)
const stationCount = lines.reduce((n, l) => n + l.stations.length, 0)

const out = {
  _comment: `Собрано из OpenStreetMap ${new Date().toISOString().slice(0, 10)} скриптом scripts/metro.js. Обновить: npm run metro`,
  segmentMinutes: SEGMENT_MINUTES,
  defaultTransferMinutes: DEFAULT_TRANSFER_MINUTES,
  cities: CITIES.map((c) => ({ id: c.id, name: c.name })),
  lines,
  transfers,
}
writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8')
writeFileSync(RAW, JSON.stringify({ generatedAt: new Date().toISOString() }, null, 2), 'utf8')

console.log(`\nГОТОВО`)
console.log(`  линий:      ${lines.length}`)
console.log(`  станций:    ${stationCount}`)
console.log(`  пересадок:  ${transfers.length}`)
console.log(`\nЗаписано в data/metro.json`)
