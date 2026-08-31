import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildGraph, distancesFrom, searchStations, nearestStations } from './metro.js'
import { findOptions, deriveLabels, searchVariants, daysBetween, formatDistance } from './ranking.js'
import { formatSlot, formatMoney, buildMessage } from './message.js'
import { lintText } from './lint.js'
import { buildPlaces, searchPlaces, resolveOrigin, originSummary, knowsPatientLocation } from './places.js'
import { deriveTags } from './tags.js'
import { splitEducation } from './education.js'
import { filterQaForService, groupQa } from './qa.js'
import { isAboutOtherProcedure } from './service.js'
import { parseRating } from '../../scripts/ratings.js'
import { applyOverrides, applyContentOverrides, findGaps } from './overrides.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'))

const metro = read('data/metro.json')
// демо-набор, а не рабочий каталог: он перезаписывается импортом
const catalog = read('data/catalog.demo.json')
const content = read('data/content.json')
const graph = buildGraph(metro)
const placesData = read('data/places.json')
const places = buildPlaces(graph, placesData, catalog)

const today = new Date().toISOString().slice(0, 10)
const nodesOf = (city, name) => graph.stationByKey.get(`${city}|${name}`).nodeIds
// id станций зависят от того, как собран справочник метро, поэтому в тестах
// всегда обращаемся по названию
// Подбор считает расстояние по прямой, поэтому точке нужны координаты
const originAt = (city, name) => {
  const st = graph.stationByKey.get(`${city}|${name}`)
  return { lat: st.lat, lng: st.lng, place: { kind: 'metro', name, cityId: city } }
}
const idOf = (city, name, lineHint) => {
  const ids = nodesOf(city, name)
  if (!lineHint) return ids[0]
  return ids.find((id) => graph.nodes.get(id).lineName.includes(lineHint)) ?? ids[0]
}

test('граф: пересадочный узел объединяет станции разных линий', () => {
  const belorusskaya = graph.stationByKey.get('msk|Белорусская')
  assert.equal(belorusskaya.nodeIds.length, 2)
  assert.equal(belorusskaya.lines.length, 2)
})

test('граф: соседние станции одной линии — один перегон', () => {
  const dist = distancesFrom(graph, [idOf('msk', 'Автозаводская')])
  assert.equal(dist.get(idOf('msk', 'Технопарк')), 2.5)
  assert.equal(dist.get(idOf('msk', 'Павелецкая', 'Замоскворецкая')), 2.5)
})

test('граф: кольцевая линия замкнута', () => {
  const dist = distancesFrom(graph, [idOf('msk', 'Белорусская', 'Кольцевая')])
  // Краснопресненская — соседняя с Белорусской через замыкание кольца
  assert.equal(dist.get(idOf('msk', 'Краснопресненская')), 2.5)
})

test('граф: поездка с пересадкой дороже прямой', () => {
  const dist = distancesFrom(graph, nodesOf('msk', 'Автозаводская'))
  const direct = dist.get(idOf('msk', 'Павелецкая', 'Замоскворецкая')) // прямо по зелёной
  const withTransfer = dist.get(idOf('msk', 'Шаболовская')) // нужна пересадка
  assert.ok(withTransfer > direct)
})

test('граф: города не связаны между собой', () => {
  const dist = distancesFrom(graph, nodesOf('msk', 'Автозаводская'))
  assert.equal(dist.get(idOf('spb', 'Невский проспект')), undefined)
})

test('поиск станций: по началу названия и без учёта регистра', () => {
  const found = searchStations(graph.stations, 'автозав', 'msk')
  assert.equal(found[0].name, 'Автозаводская')
})

test('поиск станций: не смешивает города', () => {
  const found = searchStations(graph.stations, 'спортивная', 'msk')
  assert.ok(found.every((s) => s.cityId === 'msk'))
})

test('поиск подвидов: находит по синониму', () => {
  const found = searchVariants(catalog, 'mri', 'поясница')
  assert.ok(found.some((v) => v.id === 'mri-lumbar'))
})

test('поиск подвидов: ё и е взаимозаменяемы', () => {
  const found = searchVariants(catalog, 'ct', 'легкие')
  assert.ok(found.some((v) => v.id === 'ct-chest'))
})

test('подбор: клиника из списка «уводим» не показывается', () => {
  const origin = originAt('msk', 'Автозаводская')
  const spoiled = {
    ...catalog,
    clinics: catalog.clinics.map((c) =>
      c.id === 'cl-medplus' ? { ...c, isAvoided: true } : c
    ),
  }
  const { rows, rejected } = findOptions({
    catalog: spoiled, origin, graph, cityId: 'msk', variantId: 'colono-sed', todayIso: today,
  })
  assert.ok(!rows.some((r) => r.clinic.id === 'cl-medplus'))
  assert.ok(rejected.some((r) => r.clinic.id === 'cl-medplus' && /уводим/.test(r.reason)))
})

test('подбор: клиника на паузе исключается', () => {
  const origin = originAt('msk', 'Шаболовская')
  const { rows, rejected } = findOptions({
    catalog, origin, graph, cityId: 'msk', variantId: 'mri-lumbar', todayIso: today,
  })
  assert.ok(!rows.some((r) => r.clinic.id === 'cl-medika-shabol'))
  assert.ok(rejected.some((r) => r.clinic.id === 'cl-medika-shabol'))
})

test('подбор: клаустрофобия оставляет только открытые томографы', () => {
  const origin = originAt('msk', 'Автозаводская')
  const { rows } = findOptions({
    catalog, origin, graph, cityId: 'msk', variantId: 'mri-lumbar',
    filters: { claustrophobia: true }, todayIso: today,
  })
  assert.ok(rows.length > 0)
  assert.ok(rows.every((r) => r.clinicService.mriType === 'open'))
})

test('подбор: вес пациента отсекает аппараты с меньшим пределом', () => {
  const origin = originAt('msk', 'Автозаводская')
  const { rows } = findOptions({
    catalog, origin, graph, cityId: 'msk', variantId: 'mri-lumbar',
    filters: { patientWeight: 145 }, todayIso: today,
  })
  assert.ok(rows.every((r) => r.clinicService.maxWeightKg >= 145))
})

test('подбор: седация требует анестезиолога', () => {
  const origin = originAt('msk', 'Автозаводская')
  const { rows } = findOptions({
    catalog, origin, graph, cityId: 'msk', variantId: 'colono-sed',
    filters: { needSedation: true }, todayIso: today,
  })
  assert.ok(rows.length > 0)
  assert.ok(rows.every((r) => r.clinicService.hasSedation && r.clinicService.hasAnesthesiologist))
})

// Ярлык «Ближе всего» обязан стоять именно на ближайшей клинике.
test('ярлыки: «Ближе всего» стоит на самой близкой клинике', () => {
  for (const station of ['Автозаводская', 'Проспект Мира', 'Университет']) {
    const origin = originAt('msk', station)
    const { rows } = findOptions({
      catalog, origin, graph, cityId: 'msk', variantId: 'colono-sed', todayIso: today,
    })
    const labels = deriveLabels(rows)
    const withDistance = rows.filter((r) => r.distanceMeters != null)
    if (withDistance.length < 2) continue

    const nearest = withDistance.reduce((a, b) => (b.distanceMeters < a.distanceMeters ? b : a))
    const marked = rows.filter((r) => labels[r.key]?.includes('Ближе всего'))
    assert.equal(marked.length, 1, `от ${station}: ярлык должен быть ровно один`)
    assert.equal(marked[0].key, nearest.key, `от ${station}: ярлык не на ближайшей`)
  }
})

// «Рекомендуем» убран намеренно: он отмечал лучший суммарный скор, а туда
// вылезала клиника с незаполненной стоимостью — неизвестное оценивалось
// нейтрально и обходило известную, но высокую цену.
test('ярлыки: «Рекомендуем» больше не выдаётся', () => {
  const rows = [
    { key: 'a', distanceMeters: 1000, costKnown: true, clinicService: { avgCaseCost: 9000 } },
    { key: 'b', distanceMeters: 5000, costKnown: true, clinicService: { avgCaseCost: 5000 } },
  ]
  const all = Object.values(deriveLabels(rows)).flat()
  assert.ok(!all.includes('Рекомендуем'))
})

// Ярлык «Дешевле» убран вместе с ценами: их больше не видно нигде,
// а отмечать «дешевле» без числа — обещание без основания.
test('ярлыки: «Дешевле» больше не выдаётся', () => {
  const rows = [
    { key: 'a', distanceMeters: 1000, clinicService: { avgCaseCost: 5000 } },
    { key: 'b', distanceMeters: 5000, clinicService: { avgCaseCost: 9000 } },
  ]
  const labels = deriveLabels(rows)
  assert.deepEqual(labels.a, ['Ближе всего'])
  assert.ok(!Object.values(labels).flat().includes('Дешевле'))
})

test('подбор: приоритет A выигрывает при прочих равных', () => {
  const origin = originAt('msk', 'Автозаводская')
  const { rows } = findOptions({
    catalog, origin, graph, cityId: 'msk', variantId: 'mri-lumbar', todayIso: today,
  })
  assert.equal(rows[0].clinic.priorityTier, 'A')
})

test('подбор: радиус отсекает всё, что дальше', () => {
  const origin = originAt('msk', 'Автозаводская')
  const all = findOptions({
    catalog, origin, graph, cityId: 'msk', variantId: 'colono-sed', todayIso: today,
  })
  const near = findOptions({
    catalog, origin, graph, cityId: 'msk', variantId: 'colono-sed',
    filters: { radiusKm: 3 }, todayIso: today,
  })
  assert.ok(near.rows.length < all.rows.length, 'радиус должен что-то отсечь')
  assert.ok(near.rows.every((r) => r.distanceMeters <= 3000))
  assert.ok(near.rejected.some((r) => /дальше 3 км/.test(r.reason)))
})

test('расстояние: считается от выбранной точки, а не от клиники', () => {
  const a = findOptions({
    catalog, origin: originAt('msk', 'Автозаводская'), graph,
    cityId: 'msk', variantId: 'colono-sed', todayIso: today,
  })
  const b = findOptions({
    catalog, origin: originAt('msk', 'Университет'), graph,
    cityId: 'msk', variantId: 'colono-sed', todayIso: today,
  })
  const medplusA = a.rows.find((r) => r.clinic.id === 'cl-medplus')
  const medplusB = b.rows.find((r) => r.clinic.id === 'cl-medplus')
  assert.ok(medplusA.distanceMeters < medplusB.distanceMeters)
})

test('формат: метры до километра, дальше — километры', () => {
  assert.equal(formatDistance(450), '450 м')
  assert.equal(formatDistance(1240), '1,2 км')
  assert.equal(formatDistance(null), null)
})

test('врачи: у карточки эндоскопии есть врач, у МРТ — нет', () => {
  const origin = originAt('msk', 'Автозаводская')
  const endo = findOptions({ catalog, origin, graph, cityId: 'msk', variantId: 'colono-sed', todayIso: today })
  const mri = findOptions({ catalog, origin, graph, cityId: 'msk', variantId: 'mri-lumbar', todayIso: today })
  assert.ok(endo.rows[0].doctors.length > 0)
  assert.equal(mri.rows[0].doctors.length, 0)
})

test('данные: процедуры во сне есть только там, где есть анестезиолог', () => {
  const sedationVariants = new Set(
    catalog.serviceVariants.filter((v) => v.isSedation).map((v) => v.id)
  )
  for (const cs of catalog.clinicServices) {
    if (!sedationVariants.has(cs.serviceVariantId)) continue
    assert.ok(
      cs.hasSedation && cs.hasAnesthesiologist,
      `${cs.clinicId} предлагает ${cs.serviceVariantId} без анестезиолога`
    )
  }
})

test('сообщение: у врача без подтверждённых данных не остаётся висячего двоеточия', () => {
  const origin = originAt('msk', 'Курская')
  const { rows } = findOptions({
    catalog, origin, graph, cityId: 'msk', variantId: 'colono-diag', todayIso: today,
  })
  const row = rows.find((r) => r.doctors.some((d) => d.confidence !== 'confirmed'))
  if (!row) return
  const doctor = row.doctors.find((d) => d.confidence !== 'confirmed')
  const tpl = content.messageTemplates.find((t) => t.model === 'doctor' && t.tone === 'calm')
  const { text } = buildMessage({ option: row, template: tpl, graph, todayIso: today, doctor })
  assert.ok(!/:\s*\./.test(text), `висячее двоеточие в тексте:\n${text}`)
  assert.ok(!/,\s*\./.test(text), `висячая запятая в тексте:\n${text}`)
  assert.ok(text.includes(doctor.fullName))
})

// ── Поиск по метро / району / улице ──────────────────────────────────────────

test('места: справочник собирает метро, районы и улицы', () => {
  const kinds = new Set(places.map((p) => p.kind))
  assert.ok(kinds.has('metro') && kinds.has('district') && kinds.has('street'))
})

test('места: поиск находит станцию, район и улицу по одному полю', () => {
  assert.equal(searchPlaces(places, 'автозав', 'msk')[0].kind, 'metro')
  assert.ok(searchPlaces(places, 'академическ', 'msk').some((p) => p.kind === 'district'))
  assert.ok(searchPlaces(places, 'профсоюзн', 'msk').some((p) => p.kind === 'street'))
})

test('места: улица из адреса клиники попадает в поиск', () => {
  const found = searchPlaces(places, 'ленинская слобода', 'msk')
  assert.ok(found.some((p) => p.kind === 'street'))
})

test('места: поиск не смешивает города', () => {
  assert.ok(searchPlaces(places, 'невск', 'msk').every((p) => p.cityId === 'msk'))
})

test('гео: от станции метро дорога начинается с нуля', () => {
  const metroPlace = places.find((p) => p.kind === 'metro' && p.name === 'Автозаводская')
  const origin = resolveOrigin(metroPlace, graph)
  assert.ok(origin.starts.every(([, from]) => from === 0))
  assert.equal(origin.entry, null)
})

test('гео: от района дорога начинается пешком до ближайших станций', () => {
  const district = places.find((p) => p.kind === 'district' && p.name === 'Академический')
  const origin = resolveOrigin(district, graph)
  assert.ok(origin.starts.length > 0)
  assert.ok(origin.starts.every(([, from]) => from > 0), 'пешая часть должна быть больше нуля')
  assert.ok(origin.entry.name.length > 0)
})

test('гео: подбор по району даёт осмысленную дистанцию для сортировки', () => {
  const district = places.find((p) => p.kind === 'district' && p.name === 'Даниловский')
  const origin = resolveOrigin(district, graph)
  const { rows } = findOptions({
    catalog, origin, graph, cityId: 'msk', variantId: 'colono-sed', todayIso: today,
  })
  assert.ok(rows.length > 0)
  assert.ok(rows.every((r) => r.distanceMeters != null && r.distanceMeters > 0))
})

test('гео: ближайшая станция к точке действительно ближайшая', () => {
  const near = nearestStations(graph, 55.7069, 37.657, 'msk', 1)
  assert.equal(near[0].station.name, 'Автозаводская')
})

test('гео: у всех клиник есть координаты', () => {
  for (const c of catalog.clinics) {
    assert.ok(typeof c.lat === 'number' && typeof c.lng === 'number', `нет координат: ${c.name}`)
  }
})

test('гео: координаты клиник попадают в разумные границы города', () => {
  const BOX = { msk: [55.5, 56.0, 37.3, 37.9], spb: [59.8, 60.1, 30.1, 30.6] }
  for (const c of catalog.clinics) {
    const [latMin, latMax, lngMin, lngMax] = BOX[c.cityId]
    assert.ok(c.lat > latMin && c.lat < latMax, `${c.name}: широта ${c.lat}`)
    assert.ok(c.lng > lngMin && c.lng < lngMax, `${c.name}: долгота ${c.lng}`)
  }
})

// ── Честность формулировок про местоположение пациента ──────────────────────

test('местоположение: метро не считается известным адресом пациента', () => {
  const metro = places.find((p) => p.kind === 'metro' && p.name === 'Автозаводская')
  const origin = resolveOrigin(metro, graph)
  assert.equal(knowsPatientLocation(origin), false)
  assert.equal(originSummary(origin), 'метро Автозаводская')
})

test('местоположение: район и улица тоже не адрес пациента', () => {
  for (const kind of ['district', 'street']) {
    const place = places.find((p) => p.kind === kind && p.cityId === 'msk')
    assert.equal(knowsPatientLocation(resolveOrigin(place, graph)), false, kind)
  }
})

test('местоположение: конкретный адрес считается известным', () => {
  const address = {
    id: 'addr-test', kind: 'address', name: 'ул. Ленинская Слобода, 19',
    cityId: 'msk', lat: 55.7112, lng: 37.657,
  }
  const origin = resolveOrigin(address, graph)
  assert.equal(knowsPatientLocation(origin), true)
  assert.match(originSummary(origin), /адреса пациента/)
  assert.ok(origin.starts.length > 0)
  assert.ok(origin.entry)
})

// Время в пути мы считаем усреднённо, а минуты пешком до входа почти всегда
// не заведены. Поэтому цифр времени в тексте пациенту быть не должно —
// только станция метро.
test('сообщение: никакого времени в пути пациенту не обещаем', () => {
  const metro = places.find((p) => p.kind === 'metro' && p.name === 'Университет')
  const origin = resolveOrigin(metro, graph)
  const { rows } = findOptions({
    catalog, origin, graph, cityId: 'msk', variantId: 'mri-brain', todayIso: today,
  })
  const far = rows.find((r) => r.distanceMeters > 3000)
  assert.ok(far, 'нужен вариант дальше 3 км')

  const { rows: endo } = findOptions({
    catalog, origin, graph, cityId: 'msk', variantId: 'colono-sed', todayIso: today,
  })
  for (const tpl of content.messageTemplates) {
    const row = tpl.model === 'doctor' ? endo.find((r) => r.doctors.length) : far
    if (!row) continue
    const { text } = buildMessage({ option: row, template: tpl, graph, todayIso: today })
    assert.ok(
      !/минут|мин\.|в пути|добираться|дорога от вас|пешком/i.test(text),
      `в тексте осталось время в пути (${tpl.id}):\n${text}`
    )
  }
})

test('сообщение: станция метро называется', () => {
  const metro = places.find((p) => p.kind === 'metro' && p.name === 'Автозаводская')
  const origin = resolveOrigin(metro, graph)
  const { rows } = findOptions({
    catalog, origin, graph, cityId: 'msk', variantId: 'colono-sed', todayIso: today,
  })
  const tpl = content.messageTemplates.find((t) => t.model === 'doctor' && t.tone === 'calm')
  const { text } = buildMessage({ option: rows[0], template: tpl, graph, todayIso: today })
  assert.match(text, /рядом с метро /)
})

// ── Теги ─────────────────────────────────────────────────────────────────────

test('теги: у клиники со стажным врачом появляется «Стаж специалистов 20+»', () => {
  const origin = originAt('msk', 'Автозаводская')
  const { rows } = findOptions({
    catalog, origin, graph, cityId: 'msk', variantId: 'colono-sed', todayIso: today,
  })
  const medplus = rows.find((r) => r.clinic.id === 'cl-medplus')
  const tags = deriveTags(medplus, today).map((t) => t.text)
  assert.ok(tags.some((t) => t.includes('Стаж специалистов 20+')))
  // количество врачей в тегах не показываем — оно видно в карточке клиники
  assert.ok(!tags.some((t) => /^\d+ врач/.test(t)))
})

test('теги: у открытого томографа появляется свой тег', () => {
  const origin = originAt('msk', 'Дубровка')
  const { rows } = findOptions({
    catalog, origin, graph, cityId: 'msk', variantId: 'mri-lumbar', todayIso: today,
  })
  const open = rows.find((r) => r.clinicService.mriType === 'open')
  const tags = deriveTags(open, today).map((t) => t.text)
  assert.ok(tags.includes('Открытый томограф'))
})

test('даты: разница в днях считается верно', () => {
  assert.equal(daysBetween('2026-08-24', '2026-08-27'), 3)
  assert.equal(daysBetween('2026-08-27', '2026-08-24'), -3)
})

test('формат: сегодня/завтра/послезавтра', () => {
  assert.equal(formatSlot('2026-08-24', '2026-08-24'), 'сегодня')
  assert.equal(formatSlot('2026-08-25', '2026-08-24'), 'завтра')
  assert.ok(formatSlot('2026-09-10', '2026-08-24').includes('сентября'))
})

test('формат: цена с разделителями', () => {
  assert.equal(formatMoney(12400).replace(/ /g, ' '), '12 400 ₽')
})

test('линтер: ловит запрещённые формулировки', () => {
  const found = lintText('Мы гарантируем результат, это лучший врач', content.forbiddenPhrases)
  assert.ok(found.some((f) => f.phrase === 'гарантируем'))
  assert.ok(found.some((f) => f.phrase === 'лучший врач'))
})

test('линтер: чистый текст проходит', () => {
  assert.equal(lintText('Врач высшей категории, 20 лет практики.', content.forbiddenPhrases).length, 0)
})

test('данные: все ссылки в clinicServices ведут на существующие сущности', () => {
  const clinicIds = new Set(catalog.clinics.map((c) => c.id))
  const variantIds = new Set(catalog.serviceVariants.map((v) => v.id))
  for (const cs of catalog.clinicServices) {
    assert.ok(clinicIds.has(cs.clinicId), `нет клиники ${cs.clinicId}`)
    assert.ok(variantIds.has(cs.serviceVariantId), `нет подвида ${cs.serviceVariantId}`)
  }
})

test('данные: все станции клиник существуют в графе метро', () => {
  for (const row of catalog.clinicMetro) {
    assert.ok(graph.nodes.has(row.stationId), `нет станции ${row.stationId}`)
  }
})

test('данные: город клиники совпадает с городом её станций', () => {
  const clinicById = new Map(catalog.clinics.map((c) => [c.id, c]))
  for (const row of catalog.clinicMetro) {
    const clinic = clinicById.get(row.clinicId)
    assert.equal(graph.nodes.get(row.stationId).cityId, clinic.cityId, `${clinic.name}`)
  }
})

// ── Слой ручных правок ───────────────────────────────────────────────────────
// Данные приезжают из анкет, а сотрудники дописывают недостающее руками.
// Эти два слоя обязаны жить раздельно, иначе повторный импорт затрёт работу.

test('правки: поля клиники перекрываются, остальные остаются', () => {
  const clinic = catalog.clinics[0]
  const merged = applyOverrides(catalog, {
    clinics: { [clinic.id]: { phone: '+7 000', workHours: 'круглосуточно' } },
  })
  const after = merged.clinics.find((c) => c.id === clinic.id)
  assert.equal(after.phone, '+7 000')
  assert.equal(after.workHours, 'круглосуточно')
  assert.equal(after.name, clinic.name, 'непоправленные поля не должны меняться')
  assert.equal(after.address, clinic.address)
})

test('правки: исходный каталог не изменяется', () => {
  const clinic = catalog.clinics[0]
  const before = clinic.phone
  applyOverrides(catalog, { clinics: { [clinic.id]: { phone: 'другое' } } })
  assert.equal(catalog.clinics[0].phone, before)
})

test('правки: минуты пешком задаются по паре клиника-станция', () => {
  const row = catalog.clinicMetro[0]
  const key = `${row.clinicId}|${row.stationId}`
  const merged = applyOverrides(catalog, { clinicMetro: { [key]: { walkMinutes: 6 } } })
  assert.equal(merged.clinicMetro[0].walkMinutes, 6)
  assert.equal(merged.clinicMetro[1]?.walkMinutes, catalog.clinicMetro[1]?.walkMinutes)
})

test('правки: тезисы врача заменяются целиком', () => {
  const doctorId = catalog.doctors[0].id
  const merged = applyOverrides(catalog, {
    sellingPoints: { [doctorId]: [{ text: 'единственный тезис', confidence: 'confirmed' }] },
  })
  const mine = merged.doctorSellingPoints.filter((p) => p.doctorId === doctorId)
  assert.equal(mine.length, 1)
  assert.equal(mine[0].text, 'единственный тезис')
  // у других врачей тезисы на месте
  const other = catalog.doctors.find((d) => d.id !== doctorId)
  if (other) {
    assert.equal(
      merged.doctorSellingPoints.filter((p) => p.doctorId === other.id).length,
      catalog.doctorSellingPoints.filter((p) => p.doctorId === other.id).length
    )
  }
})

test('правки: тексты для пациента тоже правятся', () => {
  const tpl = content.messageTemplates[0]
  const merged = applyContentOverrides(content, {
    content: { messageTemplates: { [tpl.id]: { body: 'новый текст' } } },
  })
  assert.equal(merged.messageTemplates[0].body, 'новый текст')
  assert.equal(merged.messageTemplates[1].body, content.messageTemplates[1].body)
})

test('правки: пустой набор ничего не меняет', () => {
  const merged = applyOverrides(catalog, {})
  assert.equal(merged.clinics.length, catalog.clinics.length)
  assert.deepEqual(merged.clinics[0], catalog.clinics[0])
})

test('пробелы: заполненное поле уходит из списка задач', () => {
  const withGaps = findGaps(catalog)
  const phoneGap = withGaps.find((g) => g.field === 'phone')
  if (!phoneGap) return
  const merged = applyOverrides(catalog, { clinics: { [phoneGap.id]: { phone: '+7 000' } } })
  const after = findGaps(merged)
  assert.ok(!after.some((g) => g.field === 'phone' && g.id === phoneGap.id))
  assert.ok(after.length < withGaps.length)
})

test('правки: ответы клиники на анкету проходят слой правок без изменений', () => {
  const qa = [{ clinicId: catalog.clinics[0].id, category: 'Седация и наркоз', question: 'Седация доступна', answer: 'да', sort: 0 }]
  const merged = applyOverrides({ ...catalog, clinicQa: qa }, {})
  assert.deepEqual(merged.clinicQa, qa)
})

test('правки: каталог без ответов на анкету не ломает наложение', () => {
  const merged = applyOverrides(catalog, {})
  assert.equal(merged.clinicQa, undefined)
})

test('данные: ответы на анкету привязаны к существующим клиникам', () => {
  const real = read('data/catalog.json')
  // после `npm run seed` в каталоге лежат демо-данные, анкет там нет
  if (!real.clinicQa) return
  const ids = new Set(real.clinics.map((c) => c.id))
  for (const row of real.clinicQa) {
    assert.ok(ids.has(row.clinicId), `ответ на «${row.question}» ссылается на неизвестную клинику ${row.clinicId}`)
    assert.ok(row.question, 'у ответа нет вопроса')
    assert.ok(row.category, `у вопроса «${row.question}» нет раздела`)
  }
  // анкета приходит на клинику целиком: если ответы есть, они есть у всех
  const withQa = new Set(real.clinicQa.map((r) => r.clinicId))
  assert.equal(withQa.size, real.clinics.length)
})

test('правки: фотографии клиники приходят из overrides, а не из анкеты', () => {
  const id = catalog.clinics[0].id
  const merged = applyOverrides(catalog, {
    clinicPhotos: { [id]: [{ url: '/clinics/x/1.webp', caption: 'Вход' }] },
  })
  assert.deepEqual(merged.clinicPhotos, [
    { clinicId: id, sort: 0, url: '/clinics/x/1.webp', caption: 'Вход' },
  ])
})

test('правки: без фотографий список пустой, а не undefined', () => {
  assert.deepEqual(applyOverrides(catalog, {}).clinicPhotos, [])
})

test('данные: в поле фото врача не лежит ссылка на страницу', () => {
  const real = read('data/catalog.json')
  for (const d of real.doctors) {
    if (!d.photoUrl) continue
    assert.match(
      d.photoUrl,
      /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i,
      `у врача ${d.fullName} в поле фото не картинка: ${d.photoUrl}`
    )
  }
})

test('образование: сплошная строка режется по годам', () => {
  const raw =
    '1999 г. "Лечебное дело" Московский институт 2001 г. "Эндоскопия" Учебный центр'
  assert.deepEqual(splitEducation(raw), [
    { year: '1999', text: '"Лечебное дело" Московский институт' },
    { year: '2001', text: '"Эндоскопия" Учебный центр' },
  ])
})

test('образование: тире и двоеточие после года не попадают в текст', () => {
  assert.deepEqual(splitEducation('2010 г. - закончил вуз. 2011 г. — интернатура'), [
    { year: '2010', text: 'закончил вуз.' },
    { year: '2011', text: 'интернатура' },
  ])
})

test('образование: текст без года не теряется', () => {
  const out = splitEducation('Аккредитация от 25.02.2025 по специальности "Эндоскопия"')
  assert.equal(out.length, 1)
  assert.equal(out[0].year, null)
  assert.match(out[0].text, /Аккредитация/)
})

test('образование: пустое поле не ломает разбор', () => {
  assert.deepEqual(splitEducation(null), [])
  assert.deepEqual(splitEducation('   '), [])
})

test('образование: у всех врачей строка разбирается хотя бы на одну запись', () => {
  const real = read('data/catalog.json')
  for (const d of real.doctors) {
    if (!d.education) continue
    const entries = splitEducation(d.education)
    assert.ok(entries.length > 0, `не разобралось образование у ${d.fullName}`)
    // ничего не выбрасываем: суммарная длина не должна просесть
    const kept = entries.reduce((n, e) => n + e.text.length, 0)
    assert.ok(kept > d.education.length * 0.8, `потеряли текст у ${d.fullName}`)
  }
})

test('анкета: при колоноскопии раздел «только ЭГДС» не показывается', () => {
  const real = read('data/catalog.json')
  if (!real.clinicQa) return
  const one = real.clinicQa.filter((q) => q.clinicId === real.clinics[0].id)
  const visible = filterQaForService(one, 'colono')
  assert.ok(visible.length > 0)
  assert.ok(!visible.some((q) => /эгдс|гастроскоп/i.test(q.category)))
  assert.ok(visible.some((q) => /колоноскоп/i.test(q.category)))
})

test('анкета: при гастроскопии наоборот — колоноскопии не видно', () => {
  const real = read('data/catalog.json')
  if (!real.clinicQa) return
  const one = real.clinicQa.filter((q) => q.clinicId === real.clinics[0].id)
  const visible = filterQaForService(one, 'gastro')
  assert.ok(!visible.some((q) => /колоноскоп/i.test(q.category)))
  assert.ok(visible.some((q) => /эгдс/i.test(q.category)))
})

test('анкета: общие разделы остаются в обеих услугах', () => {
  const real = read('data/catalog.json')
  if (!real.clinicQa) return
  const one = real.clinicQa.filter((q) => q.clinicId === real.clinics[0].id)
  for (const serviceId of ['colono', 'gastro']) {
    const cats = new Set(filterQaForService(one, serviceId).map((q) => q.category))
    for (const common of ['Седация и наркоз', 'Гистология', 'Оборудование', 'Ограничения']) {
      assert.ok(cats.has(common), `${common} пропал при услуге ${serviceId}`)
    }
  }
})

test('анкета: для услуги без своего раздела ничего не отсекается', () => {
  const items = [{ category: 'Оборудование', question: 'а', answer: 'б' }]
  assert.deepEqual(filterQaForService(items, 'mri'), items)
})

test('анкета: группировка сохраняет порядок разделов из анкеты', () => {
  const items = [
    { category: 'Седация и наркоз', question: '1' },
    { category: 'Гистология', question: '2' },
    { category: 'Седация и наркоз', question: '3' },
  ]
  const groups = groupQa(items)
  assert.deepEqual(groups.map((g) => g.category), ['Седация и наркоз', 'Гистология'])
  assert.equal(groups[0].rows.length, 2)
})

test('рейтинг: разбирается из og:description страницы Яндекс.Карт', () => {
  const html =
    '<meta property="og:description" content="⭐️ Рейтинг 4,9. 1564 отзыва, 109 фото. Посмотреть номер телефона">'
  assert.deepEqual(parseRating(html), { rating: 4.9, reviews: 1564, award: null })
})

test('рейтинг: берётся из данных страницы, если og:description нет', () => {
  const html = '{"ratingValue":4.900000095367432,"reviewCount":"1564"}'
  assert.deepEqual(parseRating(html), { rating: 4.9, reviews: 1564, award: null })
})

test('рейтинг: невозможное значение не принимается за рейтинг', () => {
  assert.equal(parseRating('{"ratingValue":49}'), null)
  assert.equal(parseRating('{"ratingValue":0}'), null)
})

test('рейтинг: страница без рейтинга даёт null, а не выдуманное число', () => {
  assert.equal(parseRating('<html><body>ничего похожего</body></html>'), null)
  assert.equal(parseRating(''), null)
})

test('рейтинг: отзывы могут отсутствовать, рейтинг всё равно берём', () => {
  const out = parseRating('<meta property="og:description" content="⭐️ Рейтинг 4,7. Фото">')
  assert.equal(out.rating, 4.7)
  assert.equal(out.reviews, null)
})

test('данные: ссылки на Яндекс.Карты ведут на карты и на известные клиники', () => {
  const links = read('data/overrides.json').clinicYandex ?? {}
  const ids = new Set(read('data/catalog.json').clinics.map((c) => c.id))
  for (const [clinicId, url] of Object.entries(links)) {
    assert.ok(ids.has(clinicId), `ссылка привязана к неизвестной клинике ${clinicId}`)
    assert.match(url, /^https:\/\/yandex\.(ru|com)\/maps\//, `не похоже на ссылку Яндекс.Карт: ${url}`)
  }
})

test('сообщение: рейтинг с Яндекс.Карт попадает в текст отдельной строкой', () => {
  const origin = originAt('msk', 'Автозаводская')
  const { rows } = findOptions({ catalog, origin, graph, cityId: 'msk', variantId: 'colono-diag', filters: {}, todayIso: today })
  const tpl = content.messageTemplates.find((t) => t.id === 'tpl-doctor-calm')
  const rating = { rating: 4.9, reviews: 1564, checkedAt: today }
  const { text } = buildMessage({ option: rows[0], template: tpl, graph, todayIso: today, rating })
  assert.match(text, /★ 4,9 на Яндекс\.Картах — 1564 отзыва/)
})

test('сообщение: без рейтинга лишней пустой строки не остаётся', () => {
  const origin = originAt('msk', 'Автозаводская')
  const { rows } = findOptions({ catalog, origin, graph, cityId: 'msk', variantId: 'colono-diag', filters: {}, todayIso: today })
  const tpl = content.messageTemplates.find((t) => t.id === 'tpl-doctor-calm')
  const { text } = buildMessage({ option: rows[0], template: tpl, graph, todayIso: today })
  assert.ok(!text.includes('★'))
  assert.ok(!/\n\s*\n\s*\n/.test(text), 'в тексте появились двойные пустые строки')
})

test('сообщение: протухший рейтинг пациенту не называем, оператору объясняем', () => {
  const origin = originAt('msk', 'Автозаводская')
  const { rows } = findOptions({ catalog, origin, graph, cityId: 'msk', variantId: 'colono-diag', filters: {}, todayIso: today })
  const tpl = content.messageTemplates.find((t) => t.id === 'tpl-doctor-calm')
  const old = new Date(Date.parse(today) - 60 * 86400000).toISOString().slice(0, 10)
  const { text, notes } = buildMessage({
    option: rows[0], template: tpl, graph, todayIso: today,
    rating: { rating: 4.9, reviews: 1564, checkedAt: old },
  })
  assert.ok(!text.includes('★'))
  assert.equal(notes.length, 1)
  assert.match(notes[0], /не вставлен в текст/)
})

test('сообщение: рейтинг без числа отзывов не выдумывает их', () => {
  const origin = originAt('msk', 'Автозаводская')
  const { rows } = findOptions({ catalog, origin, graph, cityId: 'msk', variantId: 'colono-diag', filters: {}, todayIso: today })
  const tpl = content.messageTemplates.find((t) => t.id === 'tpl-doctor-calm')
  const { text } = buildMessage({
    option: rows[0], template: tpl, graph, todayIso: today,
    rating: { rating: 4.7, reviews: null, checkedAt: today },
  })
  assert.match(text, /★ 4,7 на Яндекс\.Картах\n/)
  assert.ok(!text.includes('отзыв'))
})

test('данные: строка рейтинга есть во всех шаблонах сообщений', () => {
  for (const t of content.messageTemplates) {
    assert.ok(t.body.includes('{{ratingClause}}'), `в шаблоне ${t.id} нет рейтинга`)
  }
})

test('подбор: фильтр «ВИП-пациент» оставляет только отмеченные клиники', () => {
  const origin = originAt('msk', 'Автозаводская')
  const args = { catalog, origin, graph, cityId: 'msk', variantId: 'colono-diag', todayIso: today }

  const all = findOptions({ ...args, filters: {} }).rows
  assert.ok(all.length > 0, 'без фильтра должны быть клиники')

  // ни одна не отмечена — выдача пуста, и это видно в причинах отказа
  const none = findOptions({ ...args, filters: { vipOnly: true } })
  assert.equal(none.rows.length, 0)
  assert.ok(none.rejected.some((r) => /ВИП/.test(r.reason)))

  // отмечаем одну — остаётся ровно она
  const vipId = all[0].clinic.id
  const marked = applyOverrides(catalog, { clinics: { [vipId]: { isVip: true } } })
  const some = findOptions({ ...args, catalog: marked, filters: { vipOnly: true } }).rows
  assert.equal(some.length, 1)
  assert.equal(some[0].clinic.id, vipId)
})

test('подбор: без фильтра отметка ВИП ничего не меняет', () => {
  const origin = originAt('msk', 'Автозаводская')
  const args = { catalog, origin, graph, cityId: 'msk', variantId: 'colono-diag', todayIso: today }
  const before = findOptions({ ...args, filters: {} }).rows.length
  const marked = applyOverrides(catalog, {
    clinics: { [findOptions({ ...args, filters: {} }).rows[0].clinic.id]: { isVip: true } },
  })
  assert.equal(findOptions({ ...args, catalog: marked, filters: {} }).rows.length, before)
})

test('сообщение: цены пациенту не называем ни в одной тональности', () => {
  const origin = originAt('msk', 'Автозаводская')
  for (const variantId of ['colono-diag', 'colono-sed']) {
    const { rows } = findOptions({ catalog, origin, graph, cityId: 'msk', variantId, filters: {}, todayIso: today })
    if (!rows.length) continue
    for (const tpl of content.messageTemplates.filter((t) => t.model === 'doctor')) {
      const { text } = buildMessage({ option: rows[0], template: tpl, graph, todayIso: today })
      assert.ok(!text.includes('₽'), `сумма попала в текст (${tpl.id}): ${text}`)
      assert.ok(!/УТОЧНИТЬ\]/.test(text.replace('[ОКНО УТОЧНИТЬ]', '')), `остался плейсхолдер цены (${tpl.id})`)
      assert.ok(!/\bцен[аыу]\s*[:—-]/i.test(text), `в тексте осталась строка с ценой (${tpl.id})`)
    }
  }
})

test('данные: в шаблонах сообщений нет подстановки цены', () => {
  for (const t of content.messageTemplates) {
    assert.ok(!t.body.includes('{{price}}'), `в шаблоне ${t.id} осталась цена`)
  }
})

test('сообщение: при колоноскопии не хвалим врача гастроскопиями', () => {
  const origin = originAt('msk', 'Автозаводская')
  const { rows } = findOptions({ catalog, origin, graph, cityId: 'msk', variantId: 'colono-diag', filters: {}, todayIso: today })
  const tpl = content.messageTemplates.find((t) => t.id === 'tpl-doctor-calm')
  for (const row of rows) {
    const { text } = buildMessage({ option: row, template: tpl, graph, todayIso: today })
    assert.ok(!/гастроскоп|ЭГДС/i.test(text), `в тексте про колоноскопию упомянута гастроскопия: ${text}`)
  }
})

test('сообщение: при гастроскопии не хвалим врача колоноскопиями', () => {
  const origin = originAt('msk', 'Автозаводская')
  const { rows } = findOptions({ catalog, origin, graph, cityId: 'msk', variantId: 'gastro-diag', filters: {}, todayIso: today })
  const tpl = content.messageTemplates.find((t) => t.id === 'tpl-doctor-calm')
  for (const row of rows) {
    const { text } = buildMessage({ option: row, template: tpl, graph, todayIso: today })
    // «Гастроскопия» в названии услуги — это не тезис врача, её проверяем отдельно
    const body = text.replace(/Гастроскопия[^\n]*/g, '')
    assert.ok(!/колоноскоп/i.test(body), `в тексте про гастроскопию упомянута колоноскопия: ${text}`)
  }
})

test('сообщение: нейтральные тезисы врача остаются в обеих услугах', () => {
  const origin = originAt('msk', 'Автозаводская')
  const tpl = content.messageTemplates.find((t) => t.id === 'tpl-doctor-calm')
  for (const variantId of ['colono-diag', 'gastro-diag']) {
    const { rows } = findOptions({ catalog, origin, graph, cityId: 'msk', variantId, filters: {}, todayIso: today })
    const { usedPoints } = buildMessage({ option: rows[0], template: tpl, graph, todayIso: today })
    assert.ok(usedPoints.length > 0, `для ${variantId} не осталось ни одного тезиса`)
  }
})

test('услуги: чужой процедурой считается только другая процедура', () => {
  assert.ok(isAboutOtherProcedure('выполняет более 2000 гастроскопий в год', 'colono'))
  assert.ok(isAboutOtherProcedure('выполняет более 500 колоноскопий в год', 'gastro'))
  assert.ok(!isAboutOtherProcedure('выполняет более 500 колоноскопий в год', 'colono'))
  assert.ok(!isAboutOtherProcedure('37 лет практики', 'colono'))
  assert.ok(!isAboutOtherProcedure('более 200 полипэктомий в год', 'gastro'))
  // у МРТ своей «чужой процедуры» нет — ничего не отсекаем
  assert.ok(!isAboutOtherProcedure('выполняет более 2000 гастроскопий в год', 'mri'))
})

test('правки: в overrides.json только известные разделы', () => {
  // Кнопка «Сохранить» в админке пишет этот файл через дев-сервер. Обработчик
  // отказывается писать неизвестные разделы — тест ловит случай, когда файл
  // испортили в обход него.
  const allowed = new Set([
    '_comment', 'clinics', 'clinicServices', 'clinicMetro', 'clinicPhotos',
    'clinicYandex', 'doctors', 'sellingPoints', 'content',
  ])
  const file = read('data/overrides.json')
  for (const key of Object.keys(file)) {
    assert.ok(allowed.has(key), `неизвестный раздел правок: ${key}`)
  }
  for (const [key, value] of Object.entries(file)) {
    if (key === '_comment') continue
    assert.equal(typeof value, 'object', `раздел ${key} должен быть объектом`)
    assert.ok(!Array.isArray(value), `раздел ${key} не должен быть массивом`)
  }
})

test('подбор: стоимость на порядок выдачи не влияет', () => {
  // Цену мы нигде не показываем, поэтому и сортировать по ней нельзя:
  // порядок, объяснимый только невидимым числом, оператору не объяснить.
  const origin = originAt('msk', 'Автозаводская')
  const base = findOptions({
    catalog, origin, graph, cityId: 'msk', variantId: 'colono-diag', filters: {}, todayIso: today,
  }).rows[0]

  // два одинаковых двойника, отличаются только стоимостью кейса
  const twin = {
    ...catalog,
    clinics: [
      ...catalog.clinics,
      { ...base.clinic, id: 'cl-дорогая', name: 'Дорогая' },
      { ...base.clinic, id: 'cl-дешёвая', name: 'Дешёвая' },
    ],
    clinicServices: [
      ...catalog.clinicServices,
      { ...base.clinicService, id: 'cs-дорогая', clinicId: 'cl-дорогая', avgCaseCost: 90000 },
      { ...base.clinicService, id: 'cs-дешёвая', clinicId: 'cl-дешёвая', avgCaseCost: 900 },
    ],
  }

  const rows = findOptions({
    catalog: twin, origin, graph, cityId: 'msk', variantId: 'colono-diag', filters: {}, todayIso: today,
  }).rows
  const dear = rows.find((r) => r.key === 'cs-дорогая')
  const cheap = rows.find((r) => r.key === 'cs-дешёвая')

  assert.ok(dear && cheap, 'клиники-двойники не попали в выдачу')
  assert.equal(dear.score, cheap.score, 'стоимость не должна менять баллы')
  assert.ok(!('fCost' in dear.breakdown), 'в разбор баллов вернулась стоимость')
})

test('подбор: при прочих равных выше та, что ближе', () => {
  const origin = originAt('msk', 'Автозаводская')
  const base = findOptions({
    catalog, origin, graph, cityId: 'msk', variantId: 'colono-diag', filters: {}, todayIso: today,
  }).rows[0]

  // тот же приоритет, та же цена, то же окно — отличается только расстояние
  const far = { ...base.clinic, id: 'cl-далеко', name: 'Та же, но дальше', lat: base.clinic.lat + 0.09 }
  const twin = {
    ...catalog,
    clinics: [...catalog.clinics, far],
    clinicServices: [
      ...catalog.clinicServices,
      { ...base.clinicService, id: 'cs-далеко', clinicId: 'cl-далеко' },
    ],
  }
  const rows = findOptions({
    catalog: twin, origin, graph, cityId: 'msk', variantId: 'colono-diag', filters: {}, todayIso: today,
  }).rows
  const near = rows.find((r) => r.key === base.key)
  const away = rows.find((r) => r.key === 'cs-далеко')
  assert.ok(away.distanceMeters > near.distanceMeters)
  assert.ok(near.score > away.score, 'ближняя клиника должна стоять выше')
})

test('рейтинг: награда «Хорошее место» разбирается вместе с годом', () => {
  const html =
    '<meta property="og:description" content="🏆 Обладатель награды «Хорошее место — 2026». ⭐️ Рейтинг 4,6. 534 отзыва, 103 фото.">'
  const out = parseRating(html)
  assert.equal(out.rating, 4.6)
  assert.equal(out.reviews, 534)
  assert.deepEqual(out.award, { name: 'Хорошее место', year: 2026 })
})

test('рейтинг: без награды поле остаётся пустым, а не выдумывается', () => {
  const html =
    '<meta property="og:description" content="⭐️ Рейтинг 4,9. 1564 отзыва, 109 фото.">'
  assert.equal(parseRating(html).award, null)
})

test('рейтинг: награда без года не превращается в награду с годом', () => {
  const html = '<meta property="og:description" content="Хорошее место. ⭐️ Рейтинг 4,2. 10 отзывов">'
  assert.deepEqual(parseRating(html).award, { name: 'Хорошее место', year: null })
})

test('данные: собранные рейтинги ссылаются на существующие клиники', () => {
  const ratings = read('public/ratings.json')
  const ids = new Set(read('data/catalog.json').clinics.map((c) => c.id))
  for (const [clinicId, item] of Object.entries(ratings.items)) {
    assert.ok(ids.has(clinicId), `рейтинг привязан к неизвестной клинике ${clinicId}`)
    assert.ok(item.rating > 0 && item.rating <= 5, `неправдоподобный рейтинг у ${clinicId}`)
    assert.match(item.checkedAt, /^\d{4}-\d{2}-\d{2}$/)
    if (item.award) {
      assert.equal(typeof item.award.name, 'string')
      assert.ok(item.award.year === null || item.award.year >= 2020)
    }
  }
})

test('данные: цену нигде не показываем — ни в списке, ни на карте, ни в карточке', () => {
  const surfaces = [
    'src/components/ClinicList.jsx',
    'src/components/ClinicDetail.jsx',
    'src/components/markerPill.js',
    'src/components/MapView.jsx',
  ]
  for (const file of surfaces) {
    const code = readFileSync(resolve(ROOT, file), 'utf8')
    assert.ok(!/avgCaseCost/.test(code), `в ${file} вернулась стоимость`)
    assert.ok(!/formatMoney/.test(code), `в ${file} вернулся вывод суммы`)
  }
})

test('рейтинг: показываем с одним знаком, как пишет Яндекс', () => {
  // Яндекс пишет «Рейтинг 5,0» — если показать «5», оператор и пациент
  // увидят разные числа
  assert.equal(parseRating('<meta property="og:description" content="⭐️ Рейтинг 5,0. 1822 отзыва">').rating, 5)
  const real = read('public/ratings.json')
  for (const item of Object.values(real.items)) {
    assert.match(item.rating.toFixed(1), /^\d\.\d$/)
  }
})

test('данные: ссылка на карточку ведёт на организацию, а не на город', () => {
  const real = read('public/ratings.json')
  for (const [clinicId, item] of Object.entries(real.items)) {
    const link = item.resolvedUrl ?? item.url
    const ok = /\/maps\/org\//.test(link) || /\/maps\/-\//.test(link)
    assert.ok(ok, `у ${clinicId} ссылка ведёт не на карточку: ${link}`)
  }
})
