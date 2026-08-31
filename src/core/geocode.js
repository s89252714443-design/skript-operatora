// Поиск конкретного адреса — «где пациент сейчас».
//
// Метро, район и улица ищутся по локальному справочнику мгновенно (places.js).
// Дом по адресу локально не найти, поэтому здесь запрос к геокодеру Nominatim
// (OpenStreetMap): бесплатно, без ключа.
//
// ВАЖНО про «навсегда бесплатно»: это чужой публичный сервис. Его правила
// (https://operations.osmfoundation.org/policies/nominatim/) разрешают
// нечастые запросы от людей и запрещают массовые. Несколько операторов,
// вводящих адрес руками, укладываются с запасом, но гарантий сервис не даёт.
// Для полной независимости адресный индекс поднимается локально — см. README.
//
// Поэтому запросы здесь: только по явному действию оператора, не чаще одного
// в секунду, с ограничением по городу и с кэшем на время сессии.

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const MIN_INTERVAL_MS = 1100 // правила Nominatim: не чаще 1 запроса в секунду

// Рамки городов, чтобы геокодер не предлагал Тверскую улицу в другом регионе
const CITY_BOX = {
  // [минДолгота, минШирота, максДолгота, максШирота]
  msk: [36.8, 55.1, 38.2, 56.1],
  spb: [29.6, 59.6, 30.8, 60.2],
}
const CITY_NAME = { msk: 'Москва', spb: 'Санкт-Петербург' }

const cache = new Map()
let lastCallAt = 0
let queue = Promise.resolve()

function throttle() {
  queue = queue.then(async () => {
    const wait = Math.max(0, lastCallAt + MIN_INTERVAL_MS - Date.now())
    if (wait) await new Promise((r) => setTimeout(r, wait))
    lastCallAt = Date.now()
  })
  return queue
}

/**
 * Ищет адрес в пределах города. Возвращает массив мест того же вида,
 * что и локальный справочник, с kind: 'address'.
 */
export async function geocodeAddress(query, cityId, { signal } = {}) {
  const q = String(query ?? '').trim()
  if (q.length < 4) return []

  const cacheKey = `${cityId}|${q.toLowerCase()}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)

  const box = CITY_BOX[cityId]
  const params = new URLSearchParams({
    q: `${CITY_NAME[cityId] ?? ''}, ${q}`,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '5',
    'accept-language': 'ru',
  })
  if (box) {
    params.set('viewbox', box.join(','))
    params.set('bounded', '1')
  }

  await throttle()
  if (signal?.aborted) return []

  const res = await fetch(`${ENDPOINT}?${params}`, { signal })
  if (!res.ok) throw new Error(`Геокодер ответил ${res.status}`)
  const data = await res.json()

  // Nominatim часто возвращает один и тот же дом несколькими объектами
  // (здание, подъезды, входы). Оператору это выглядит как пять одинаковых
  // строк, поэтому схлопываем по названию.
  const seen = new Set()
  const places = []
  for (const r of data) {
    if (!r.lat || !r.lon) continue
    const name = shortAddress(r)
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    places.push({
      id: `addr-${r.place_id}`,
      kind: 'address',
      name,
      fullName: r.display_name,
      cityId,
      lat: Number(r.lat),
      lng: Number(r.lon),
    })
  }

  cache.set(cacheKey, places)
  return places
}

// «Россия, Москва, ЮАО, ул. Ленинская Слобода, 19» → «ул. Ленинская Слобода, 19»
function shortAddress(r) {
  const a = r.address ?? {}
  const street = a.road ?? a.pedestrian ?? a.footway ?? null
  const house = a.house_number ?? null
  if (street && house) return `${street}, ${house}`
  if (street) return street
  return String(r.display_name ?? '').split(',').slice(0, 2).join(',').trim()
}
