// Единое поле «где пациенту удобно»: метро ИЛИ район ИЛИ улица.
// Оператор не выбирает тип — просто печатает, что назвал пациент.

import { normalize, nearestStations, walkMinutesFor } from './metro.js'

const KIND_ORDER = { address: 0, metro: 1, district: 2, street: 3 }

/**
 * Собирает единый справочник мест из метро, районов и улиц.
 * Адреса клиник тоже попадают сюда: если пациент назвал улицу,
 * на которой стоит наша клиника, поиск её найдёт.
 */
export function buildPlaces(graph, placesData, catalog) {
  const out = []

  for (const s of graph.stations) {
    if (s.lat == null) continue
    out.push({
      id: `m-${s.key}`,
      kind: 'metro',
      name: s.name,
      cityId: s.cityId,
      lat: s.lat,
      lng: s.lng,
      nodeIds: s.nodeIds,
      lines: s.lines,
    })
  }

  for (const d of placesData.districts) {
    out.push({ id: d.id, kind: 'district', name: d.name, cityId: d.cityId, lat: d.lat, lng: d.lng })
  }

  const seenStreets = new Set()
  for (const st of placesData.streets) {
    seenStreets.add(normalize(st.name))
    out.push({ id: st.id, kind: 'street', name: st.name, cityId: st.cityId, lat: st.lat, lng: st.lng })
  }

  // улицы из адресов клиник — их пациент называет чаще всего
  for (const c of catalog.clinics) {
    if (c.lat == null) continue
    const street = streetOf(c.address)
    if (!street || seenStreets.has(normalize(street))) continue
    seenStreets.add(normalize(street))
    out.push({
      id: `st-cl-${c.id}`,
      kind: 'street',
      name: street,
      cityId: c.cityId,
      lat: c.lat,
      lng: c.lng,
    })
  }

  return out
}

// «ул. Ленинская Слобода, 19» → «ул. Ленинская Слобода»
function streetOf(address) {
  return String(address ?? '').split(',')[0].trim() || null
}

export function searchPlaces(places, query, cityId, limit = 10) {
  const pool = places.filter((p) => p.cityId === cityId)
  const q = normalize(query)
  if (!q) {
    return pool.filter((p) => p.kind === 'metro').slice(0, limit)
  }

  const scored = []
  for (const p of pool) {
    const name = normalize(p.name)
    let rank = null
    if (name === q) rank = 0
    else if (name.startsWith(q)) rank = 1
    else if (name.split(' ').some((w) => w.startsWith(q))) rank = 2
    else if (name.includes(q)) rank = 3
    if (rank !== null) scored.push([rank, KIND_ORDER[p.kind], p])
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].name.localeCompare(b[2].name, 'ru'))
  return scored.slice(0, limit).map(([, , p]) => p)
}

/**
 * Откуда считать дорогу. Для метро — сама станция. Для района или улицы —
 * несколько ближайших станций, каждая со своим временем пешком до неё.
 * Так «Профсоюзная улица» и «Академический район» дают честное время в пути,
 * а не только расстояние по прямой.
 */
export function resolveOrigin(place, graph) {
  if (!place) return null

  // Адрес, район и улица — это точка на карте, до метро от неё ещё идти.
  // Только для метро дорога начинается с нуля.
  if (place.kind === 'metro') {
    return {
      place,
      lat: place.lat,
      lng: place.lng,
      starts: place.nodeIds.map((id) => [id, 0]),
      entry: null,
    }
  }

  const near = nearestStations(graph, place.lat, place.lng, place.cityId, 3)
  const starts = []
  for (const { station, meters } of near) {
    const walk = walkMinutesFor(meters)
    for (const id of station.nodeIds) starts.push([id, walk])
  }

  return {
    place,
    lat: place.lat,
    lng: place.lng,
    starts,
    entry: near[0]
      ? { name: near[0].station.name, walkMinutes: walkMinutesFor(near[0].meters) }
      : null,
  }
}

export const KIND_LABEL = {
  metro: 'метро',
  district: 'район',
  street: 'улица',
  address: 'адрес',
}

/**
 * От чего именно мы считаем дорогу — показывается оператору явно.
 *
 * Это важно: если пациент назвал удобную станцию метро, мы НЕ знаем,
 * где он находится, и не имеем права писать «столько-то от пациента».
 * Знаем мы это только когда введён конкретный адрес.
 */
export function originSummary(origin) {
  if (!origin?.place) return null
  const { kind, name } = origin.place
  if (kind === 'address') return `адреса пациента — ${name}`
  return `${KIND_LABEL[kind] ?? ''} ${name}`.trim()
}

// Знаем ли мы, где пациент физически находится
export const knowsPatientLocation = (origin) => origin?.place?.kind === 'address'
