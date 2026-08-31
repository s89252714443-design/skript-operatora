// Граф метро и расчёт времени в пути.
// Каждая станция каждой линии — отдельный узел. Пересадка — ребро между узлами
// с одинаковым названием. Это позволяет честно считать время с пересадками.

export function buildGraph(metro) {
  const nodes = new Map() // id -> { id, name, cityId, lineId, lineName, color }
  const adj = new Map() // id -> [[toId, minutes], ...]

  const link = (a, b, minutes) => {
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a).push([b, minutes])
    adj.get(b).push([a, minutes])
  }

  for (const line of metro.lines) {
    const ids = line.stations.map(([id]) => id)
    line.stations.forEach(([id, name, lat, lng]) => {
      nodes.set(id, {
        id,
        name,
        lat: lat ?? null,
        lng: lng ?? null,
        cityId: line.cityId,
        lineId: line.id,
        lineName: line.name,
        color: line.color,
      })
      if (!adj.has(id)) adj.set(id, [])
    })
    // перегоны между соседними станциями линии
    for (let i = 0; i < ids.length - 1; i++) {
      link(ids[i], ids[i + 1], metro.segmentMinutes)
    }
    // кольцевая линия замыкается
    if (line.ring && ids.length > 2) {
      link(ids[ids.length - 1], ids[0], metro.segmentMinutes)
    }
  }

  for (const [a, b, minutes] of metro.transfers) {
    if (nodes.has(a) && nodes.has(b)) {
      link(a, b, minutes ?? metro.defaultTransferMinutes)
    }
  }

  // Станции для автокомплита: одно название = одна запись, даже если это
  // пересадочный узел из нескольких линий.
  const byKey = new Map()
  for (const node of nodes.values()) {
    const key = `${node.cityId}|${node.name}`
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        name: node.name,
        cityId: node.cityId,
        lat: node.lat,
        lng: node.lng,
        nodeIds: [],
        lines: [],
      })
    }
    const entry = byKey.get(key)
    entry.nodeIds.push(node.id)
    entry.lines.push({ id: node.lineId, name: node.lineName, color: node.color })
  }
  const stations = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))

  return { nodes, adj, stations, stationByKey: byKey }
}

// Дейкстра от набора стартовых узлов сразу (пересадочный узел = несколько стартов).
// Старт можно задать как id или как [id, начальные минуты] — второе нужно,
// когда пациент назвал не метро, а адрес или район: до станции ещё идти пешком.
// Возвращает Map: id узла -> минут в пути.
export function distancesFrom(graph, starts) {
  const dist = new Map()
  for (const s of starts) {
    const [id, from] = Array.isArray(s) ? s : [s, 0]
    if (!graph.nodes.has(id)) continue
    if (from < (dist.get(id) ?? Infinity)) dist.set(id, from)
  }

  const visited = new Set()
  while (true) {
    let current = null
    let best = Infinity
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) {
        best = d
        current = id
      }
    }
    if (current === null) break
    visited.add(current)

    for (const [to, minutes] of graph.adj.get(current) ?? []) {
      const next = best + minutes
      if (next < (dist.get(to) ?? Infinity)) dist.set(to, next)
    }
  }
  return dist
}

// Время до клиники: минимум по всем её станциям (поездка + пешком).
export function clinicTravelMinutes(dist, clinicStations) {
  let best = Infinity
  let via = null
  for (const { stationId, walkMinutes } of clinicStations) {
    const ride = dist.get(stationId)
    if (ride === undefined) continue
    const total = ride + walkMinutes
    if (total < best) {
      best = total
      via = { stationId, walkMinutes, rideMinutes: ride }
    }
  }
  return best === Infinity ? null : { minutes: Math.round(best), via }
}

// Поиск станции по вводу оператора: без учёта регистра, ё=е, по началу слова.
export function searchStations(stations, query, cityId) {
  const q = normalize(query)
  const pool = stations.filter((s) => s.cityId === cityId)
  if (!q) return pool.slice(0, 12)

  const scored = []
  for (const s of pool) {
    const name = normalize(s.name)
    if (name.startsWith(q)) scored.push([0, s])
    else if (name.split(' ').some((w) => w.startsWith(q))) scored.push([1, s])
    else if (name.includes(q)) scored.push([2, s])
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name, 'ru'))
  return scored.slice(0, 12).map(([, s]) => s)
}

// Расстояние по прямой между точками, метры.
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6_371_000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Пешком: 80 метров в минуту, с поправкой 1.3 на то, что ходят не по прямой.
export const walkMinutesFor = (meters) => Math.round((meters * 1.3) / 80)

// Ближайшие к точке станции — отсюда пациент начнёт поездку,
// если он назвал адрес или район, а не конкретное метро.
export function nearestStations(graph, lat, lng, cityId, count = 3) {
  return graph.stations
    .filter((s) => s.cityId === cityId && s.lat != null)
    .map((s) => ({ station: s, meters: haversine(lat, lng, s.lat, s.lng) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, count)
}

export function normalize(s) {
  return String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim()
}

// «рядом с метро Автозаводская».
//
// Время в пути и минуты пешком сознательно не называем: перегон у нас считается
// усреднённо, а минуты пешком до входа заводятся руками и почти всегда пустые.
// Показывать такую цифру пациенту — обещать то, что не проверено.
export function stationPhrase(travel, graph) {
  if (!travel) return ''
  const node = graph.nodes.get(travel.via.stationId)
  return `рядом с метро ${node.name}`
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}
