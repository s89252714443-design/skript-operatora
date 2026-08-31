// Слой ручных правок поверх импортированных данных.
//
// Зачем он нужен. Данные приезжают двумя путями: анкеты клиник из Excel
// и то, что сотрудники дописывают руками (минуты пешком, телефон, часы,
// исправленный адрес, тезисы о враче). Если держать всё в одном файле,
// следующий импорт затрёт ручную работу.
//
// Поэтому catalog.json — то, что приехало, overrides.json — то, что вписали
// люди. Приложение показывает их сумму, а импорт overrides не трогает вовсе.
//
// Формат overrides.json:
//   {
//     clinics:        { "<clinicId>":  { phone: "...", workHours: "..." } },
//     clinicServices: { "<serviceId>": { avgCaseCost: 8000 } },
//     clinicMetro:    { "<clinicId>|<stationId>": { walkMinutes: 6 } },
//     doctors:        { "<doctorId>":  { experienceYears: 20 } },
//     sellingPoints:  { "<doctorId>":  [ { text, type, confidence } ] },
//     clinicPhotos:   { "<clinicId>":  [ { url, caption } ] },
//     content:        { messageTemplates: {...}, objections: {...}, ... }
//   }
//
// Правка = только изменённые поля. Пустой объект означает «ничего не меняли».

export const EMPTY_OVERRIDES = {
  clinics: {},
  clinicServices: {},
  clinicMetro: {},
  doctors: {},
  sellingPoints: {},
  clinicPhotos: {},
  content: {},
}

const metroKey = (row) => `${row.clinicId}|${row.stationId}`

/**
 * Накладывает ручные правки на импортированный каталог.
 * Исходные объекты не меняются — возвращается новый каталог.
 */
export function applyOverrides(catalog, overrides) {
  const o = { ...EMPTY_OVERRIDES, ...(overrides ?? {}) }

  const clinics = catalog.clinics.map((c) => ({ ...c, ...(o.clinics[c.id] ?? {}) }))

  const clinicServices = catalog.clinicServices.map((s) => ({
    ...s,
    ...(o.clinicServices[s.id] ?? {}),
  }))

  const clinicMetro = catalog.clinicMetro.map((m) => ({
    ...m,
    ...(o.clinicMetro[metroKey(m)] ?? {}),
  }))

  const doctors = catalog.doctors.map((d) => ({ ...d, ...(o.doctors[d.id] ?? {}) }))

  // Тезисы заменяются целиком: правка одного из них — это правка всего набора,
  // иначе пришлось бы придумывать идентификаторы для строк, которых нет в анкете.
  let doctorSellingPoints = catalog.doctorSellingPoints
  const edited = Object.keys(o.sellingPoints)
  if (edited.length) {
    doctorSellingPoints = catalog.doctorSellingPoints.filter(
      (p) => !o.sellingPoints[p.doctorId]
    )
    for (const doctorId of edited) {
      o.sellingPoints[doctorId].forEach((p, i) => {
        doctorSellingPoints.push({
          id: `sp-manual-${doctorId}-${i}`,
          doctorId,
          type: p.type ?? 'подход',
          text: p.text,
          confidence: p.confidence ?? 'confirmed',
          sort: i,
        })
      })
    }
  }

  // Фотографии в анкетах не приезжают — их собирают сотрудники, поэтому
  // живут только здесь. Порядок в файле = порядок показа.
  const clinicPhotos = catalog.clinics.flatMap((c) =>
    (o.clinicPhotos[c.id] ?? []).map((p, i) => ({ clinicId: c.id, sort: i, ...p }))
  )

  return {
    ...catalog,
    clinics,
    clinicServices,
    clinicMetro,
    doctors,
    doctorSellingPoints,
    clinicPhotos,
  }
}

/** Тексты для пациента правятся так же: правка поверх файла content.json. */
export function applyContentOverrides(content, overrides) {
  const patch = overrides?.content ?? {}
  const out = { ...content }
  for (const [collection, byId] of Object.entries(patch)) {
    if (!Array.isArray(out[collection])) continue
    out[collection] = out[collection].map((item) => ({ ...item, ...(byId[item.id] ?? {}) }))
  }
  return out
}

/**
 * Чего не хватает для работы оператора. Отсюда строится список задач
 * для сотрудников: что именно и у какой клиники нужно дозаполнить.
 */
export function findGaps(catalog) {
  const gaps = []
  const clinicById = new Map(catalog.clinics.map((c) => [c.id, c]))

  for (const c of catalog.clinics) {
    if (!c.phone) gaps.push({ kind: 'clinic', id: c.id, name: c.name, field: 'phone', label: 'телефон' })
    if (!c.workHours)
      gaps.push({ kind: 'clinic', id: c.id, name: c.name, field: 'workHours', label: 'часы работы' })
    if (c.lat == null)
      gaps.push({ kind: 'clinic', id: c.id, name: c.name, field: 'lat', label: 'координаты' })
  }

  for (const m of catalog.clinicMetro) {
    if (m.walkMinutes == null) {
      const c = clinicById.get(m.clinicId)
      gaps.push({
        kind: 'metro',
        id: metroKey(m),
        name: c?.name ?? m.clinicId,
        field: 'walkMinutes',
        label: 'минуты пешком от метро',
      })
    }
  }

  for (const s of catalog.clinicServices) {
    if (s.avgCaseCost == null) {
      const c = clinicById.get(s.clinicId)
      gaps.push({
        kind: 'service',
        id: s.id,
        name: `${c?.name ?? s.clinicId} · ${s.serviceVariantId}`,
        field: 'avgCaseCost',
        label: 'средняя стоимость кейса',
      })
    }
  }

  for (const d of catalog.doctors) {
    if (!d.experienceYears) {
      gaps.push({ kind: 'doctor', id: d.id, name: d.fullName, field: 'experienceYears', label: 'стаж' })
    }
    if (!catalog.doctorSellingPoints.some((p) => p.doctorId === d.id && p.confidence === 'confirmed')) {
      gaps.push({
        kind: 'doctor',
        id: d.id,
        name: d.fullName,
        field: 'sellingPoints',
        label: 'подтверждённые тезисы для сообщения',
      })
    }
  }

  return gaps
}
