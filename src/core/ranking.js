// Подбор клиник: жёсткие фильтры → скоринг → три карточки.

import { haversine } from './metro.js'

// Стоимости в весах нет намеренно. Цену мы нигде не показываем — ни в списке,
// ни на карте, ни в карточке, ни в сообщении. Сортировать по числу, которого
// оператор не видит, значит делать порядок выдачи необъяснимым: две клиники
// рядом, одна выше, и почему — понять неоткуда. Освободившийся вес отдан
// расстоянию, единственному, что видно на экране прямо.
export const WEIGHTS = {
  tier: 0.35, // приоритет отдела (A/B/C)
  geo: 0.45, // расстояние от выбранной точки
  slot: 0.2, // как скоро свободное окно
}

// За этим расстоянием близость перестаёт что-либо решать
const GEO_HORIZON_METERS = 10000

// «450 м» / «1,2 км» — расстояние по прямой от выбранной точки.
// Это не длина маршрута: пешком и на метро выйдет больше.
export function formatDistance(meters) {
  if (meters == null) return null
  if (meters < 1000) return `${Math.round(meters / 10) * 10} м`
  return `${(meters / 1000).toFixed(1).replace('.', ',')} км`
}

const TIER_VALUE = { A: 1.0, B: 0.6, C: 0.3 }
const STALE_DAYS = 7 // после скольких дней данные о слоте считаем протухшими
const STALE_PENALTY = 8

const clamp01 = (n) => Math.max(0, Math.min(1, n))

// Пока данные заводятся, часть полей приходит пустыми. Сервис не должен
// от этого падать или показывать NaN — он должен честно сказать оператору,
// чего не хватает, и не давать отправить такое пациенту.

export function daysBetween(fromIso, toIso) {
  const a = new Date(fromIso + 'T00:00:00')
  const b = new Date(toIso + 'T00:00:00')
  return Math.round((b - a) / 86400000)
}

export function isPaused(clinic, todayIso) {
  if (!clinic.pausedReason) return false
  if (!clinic.pausedUntil) return true
  return daysBetween(todayIso, clinic.pausedUntil) >= 0
}

/**
 * @param {object} p
 * @param {object} p.catalog        плоские таблицы каталога
 * @param {object} p.origin         откуда считаем: { lat, lng } или null
 * @param {string} p.cityId
 * @param {string} p.variantId      выбранный подвид услуги
 * @param {object} p.filters        { needSedation, claustrophobia, patientWeight, radiusKm }
 * @param {string} p.todayIso
 */
export function findOptions({ catalog, origin, graph, cityId, variantId, filters = {}, todayIso }) {
  const variant = catalog.serviceVariants.find((v) => v.id === variantId)
  if (!variant) return { rows: [], rejected: [] }
  const service = catalog.services.find((s) => s.id === variant.serviceId)

  const clinicById = new Map(catalog.clinics.map((c) => [c.id, c]))
  const stationsByClinic = new Map()
  for (const row of catalog.clinicMetro) {
    if (!stationsByClinic.has(row.clinicId)) stationsByClinic.set(row.clinicId, [])
    stationsByClinic.get(row.clinicId).push(row)
  }

  const rows = []
  const rejected = []

  for (const cs of catalog.clinicServices) {
    if (cs.serviceVariantId !== variantId || !cs.isActive) continue
    const clinic = clinicById.get(cs.clinicId)
    if (!clinic || clinic.cityId !== cityId || !clinic.isActive) continue

    // ─── жёсткие фильтры ───
    // Список «уводим»: клиники, от которых отдел уводит пациентов.
    // Это не приоритет, а запрет — такие не показываем никогда.
    if (clinic.isAvoided) {
      rejected.push({ clinic, reason: 'в списке «уводим»' })
      continue
    }
    if (isPaused(clinic, todayIso)) {
      rejected.push({ clinic, reason: `на паузе: ${clinic.pausedReason}` })
      continue
    }
    // ВИП-пациент. Что клинику можно предложить ВИПу — решает отдел, а не
    // данные: это про сервис, палаты и отношение, а не про цифру в анкете.
    // Поэтому флаг ставится руками в админке, сами мы его не выводим.
    if (filters.vipOnly && !clinic.isVip) {
      rejected.push({ clinic, reason: 'не отмечена как подходящая ВИП-пациенту' })
      continue
    }
    if (filters.needSedation && !(cs.hasSedation && cs.hasAnesthesiologist)) {
      rejected.push({ clinic, reason: 'нет седации или анестезиолога' })
      continue
    }
    if (filters.claustrophobia && service.id === 'mri' && cs.mriType !== 'open') {
      rejected.push({ clinic, reason: 'томограф закрытого типа' })
      continue
    }
    if (filters.patientWeight && cs.maxWeightKg && filters.patientWeight > cs.maxWeightKg) {
      rejected.push({ clinic, reason: `предел аппарата ${cs.maxWeightKg} кг` })
      continue
    }

    const slotKnown = Boolean(cs.nearestSlotDate)
    const slotDays = slotKnown ? daysBetween(todayIso, cs.nearestSlotDate) : null

    // ─── расстояние по прямой от выбранной точки ───
    const stations = stationsByClinic.get(clinic.id) ?? []
    const distanceMeters =
      origin?.lat != null && clinic.lat != null
        ? Math.round(haversine(origin.lat, origin.lng, clinic.lat, clinic.lng))
        : null

    if (filters.radiusKm && distanceMeters != null && distanceMeters > filters.radiusKm * 1000) {
      rejected.push({ clinic, reason: `дальше ${filters.radiusKm} км` })
      continue
    }

    const ownStation = pickOwnStation(clinic, stations, graph)

    rows.push({
      key: cs.id,
      clinic,
      clinicService: cs,
      variant,
      service,
      distanceMeters,
      ownStation,
      slotDays,
      slotKnown,
      stationApproximate: stations.some((s) => s.approximate),
      stations,
      doctors: service.model === 'doctor' ? pickDoctors(catalog, clinic.id, variantId) : [],
      isStale: Boolean(cs.slotUpdatedAt) && daysBetween(cs.slotUpdatedAt, todayIso) > STALE_DAYS,
    })
  }

  scoreRows(rows)
  rows.sort((a, b) => b.score - a.score)
  return { rows, rejected }
}

// Какую станцию показывать у клиники: ту, что к ней ближе физически.
// Раньше выбиралась станция, удобная конкретному пациенту, но это путало —
// у клиники своя ближайшая станция, и она не меняется от запроса к запросу.
function pickOwnStation(clinic, stations, graph) {
  if (!stations.length) return null
  if (!graph || clinic.lat == null) return graph?.nodes.get(stations[0].stationId) ?? null

  let best = null
  let bestMeters = Infinity
  for (const { stationId } of stations) {
    const node = graph.nodes.get(stationId)
    if (!node || node.lat == null) continue
    const meters = haversine(clinic.lat, clinic.lng, node.lat, node.lng)
    if (meters < bestMeters) {
      bestMeters = meters
      best = node
    }
  }
  return best ?? graph.nodes.get(stations[0].stationId) ?? null
}

function scoreRows(rows) {
  if (!rows.length) return

  for (const r of rows) {
    const fTier = TIER_VALUE[r.clinic.priorityTier] ?? 0.3
    const fGeo =
      r.distanceMeters == null ? 0.5 : clamp01(1 - r.distanceMeters / GEO_HORIZON_METERS)
    // Незаполненное поле считаем худшим значением, а не серединой: пустое
    // поле — это не «средне», это «нам нечего сказать пациенту», и такая
    // клиника не должна выигрывать у той, про которую всё известно.
    const fSlot = r.slotKnown ? clamp01(1 - r.slotDays / 14) : 0

    const raw = WEIGHTS.tier * fTier + WEIGHTS.geo * fGeo + WEIGHTS.slot * fSlot

    r.breakdown = { fTier, fGeo, fSlot }
    r.score = Math.max(0, Math.round(raw * 100) - (r.isStale ? STALE_PENALTY : 0))
  }
}

function pickDoctors(catalog, clinicId, variantId) {
  const allowed = new Set(
    catalog.doctorServices.filter((d) => d.serviceVariantId === variantId).map((d) => d.doctorId)
  )
  return catalog.doctors
    .filter((d) => d.clinicId === clinicId && d.isActive && allowed.has(d.id))
    .map((d) => ({
      ...d,
      sellingPoints: catalog.doctorSellingPoints.filter((p) => p.doctorId === d.id),
    }))
    .sort((a, b) => {
      const conf = (b.confidence === 'confirmed') - (a.confidence === 'confirmed')
      if (conf) return conf
      if (b.ratingValue !== a.ratingValue) return b.ratingValue - a.ratingValue
      return b.experienceYears - a.experienceYears
    })
}

/**
 * Ярлыки для карточек: сейчас только «Ближе всего».
 *
 * Ярлыка «Рекомендуем» намеренно нет. Он вешался на первую строку выдачи,
 * то есть на лучший суммарный скор, и это вводило в заблуждение: клиника
 * без заведённой стоимости получала нейтральную оценку и обходила клинику
 * с реальной, но высокой ценой. Разница выходила в один балл, а выглядело
 * как обоснованная рекомендация.
 *
 * Ярлыки отмечают только проверяемые факты. Одна клиника может нести оба.
 *
 * @returns {Object<string, string[]>} ключ строки → список ярлыков
 */
export function deriveLabels(rows) {
  const labels = {}
  if (!rows.length) return labels

  const add = (key, label) => {
    if (!key) return
    labels[key] = labels[key] ?? []
    if (!labels[key].includes(label)) labels[key].push(label)
  }

  const withDistance = rows.filter((r) => r.distanceMeters != null)
  if (withDistance.length > 1) {
    const nearest = withDistance.reduce((a, b) => (b.distanceMeters < a.distanceMeters ? b : a))
    add(nearest.key, 'Ближе всего')
  }


  return labels
}

// Поиск подвида услуги: по названию и синонимам, с учётом опечаток в ё/е.
export function searchVariants(catalog, serviceId, query) {
  const pool = catalog.serviceVariants.filter((v) => v.serviceId === serviceId)
  const q = norm(query)
  if (!q) return pool.filter((v) => v.isPopular).concat(pool.filter((v) => !v.isPopular))

  const scored = []
  for (const v of pool) {
    const name = norm(v.name)
    const syn = v.synonyms.map(norm)
    let rank = null
    if (name.startsWith(q)) rank = 0
    else if (syn.some((s) => s.startsWith(q))) rank = 1
    else if (name.split(' ').some((w) => w.startsWith(q))) rank = 2
    else if (name.includes(q) || syn.some((s) => s.includes(q))) rank = 3
    if (rank !== null) scored.push([rank, v])
  }
  scored.sort((a, b) => a[0] - b[0] || Number(b[1].isPopular) - Number(a[1].isPopular))
  return scored.map(([, v]) => v)
}

function norm(s) {
  return String(s ?? '').toLowerCase().replace(/ё/g, 'е').trim()
}
