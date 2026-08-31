// Генератор ДЕМО-данных: создаёт data/catalog.json в виде плоских таблиц.
// Структура таблиц здесь = структура листов будущей Google-таблицы.
// Реальные данные просто заменят catalog.json, код приложения не меняется.
//
// Запуск:  npm run seed

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ── Даты ────────────────────────────────────────────────────────────────────
const TODAY = new Date()
const iso = (d) => d.toISOString().slice(0, 10)
const plusDays = (n) => {
  const d = new Date(TODAY)
  d.setDate(d.getDate() + n)
  return iso(d)
}

// ── Услуги ──────────────────────────────────────────────────────────────────
// model: doctor — продаём врача | equipment — продаём аппарат и сроки
const services = [
  { id: 'colono', name: 'Колоноскопия', short: 'Колоно', model: 'doctor', hotkey: '1', sort: 1 },
  { id: 'gastro', name: 'Гастроскопия', short: 'Гастро', model: 'doctor', hotkey: '2', sort: 2 },
  { id: 'mri', name: 'МРТ', short: 'МРТ', model: 'equipment', hotkey: '3', sort: 3 },
  { id: 'ct', name: 'КТ', short: 'КТ', model: 'equipment', hotkey: '4', sort: 4 },
  { id: 'hygiene', name: 'Профгигиена', short: 'Профгигиена', model: 'doctor', hotkey: '5', sort: 5 },
]

// [id, serviceId, название, синонимы для поиска, базовая цена, {флаги}]
const variantRows = [
  ['colono-diag', 'colono', 'Колоноскопия диагностическая', ['кишечник', 'кишка'], 6500, { popular: true }],
  ['colono-sed', 'colono', 'Колоноскопия во сне (седация)', ['наркоз', 'сон', 'седация'], 12400, { popular: true, sedation: true }],
  ['colono-biopsy', 'colono', 'Колоноскопия с биопсией', ['биопсия', 'гистология'], 9000, {}],
  ['colono-combo', 'colono', 'Колоноскопия + гастроскопия во сне', ['вместе', 'два', 'комплекс'], 19500, { sedation: true }],

  ['gastro-diag', 'gastro', 'Гастроскопия диагностическая', ['желудок', 'фгдс', 'эгдс'], 4200, { popular: true }],
  ['gastro-sed', 'gastro', 'Гастроскопия во сне (седация)', ['наркоз', 'сон', 'седация'], 9500, { popular: true, sedation: true }],
  ['gastro-nasal', 'gastro', 'Гастроскопия трансназальная', ['через нос', 'нос', 'тонкий зонд'], 6800, {}],
  ['gastro-helico', 'gastro', 'Гастроскопия с тестом на Helicobacter', ['хеликобактер', 'бактерия'], 5400, {}],

  ['mri-brain', 'mri', 'МРТ головного мозга', ['голова', 'мозг', 'башка'], 5900, { popular: true }],
  ['mri-brain-c', 'mri', 'МРТ головного мозга с контрастом', ['голова', 'мозг'], 10500, { contrast: true }],
  ['mri-pituitary', 'mri', 'МРТ гипофиза', ['гипофиз', 'пролактин'], 6400, {}],
  ['mri-cervical', 'mri', 'МРТ шейного отдела позвоночника', ['шея', 'шейный', 'позвоночник'], 5600, { popular: true }],
  ['mri-thoracic', 'mri', 'МРТ грудного отдела позвоночника', ['грудной', 'позвоночник'], 5600, {}],
  ['mri-lumbar', 'mri', 'МРТ пояснично-крестцового отдела позвоночника', ['поясница', 'поясничный', 'спина', 'крестец', 'позвоночник'], 5900, { popular: true }],
  ['mri-lumbar-c', 'mri', 'МРТ пояснично-крестцового отдела с контрастом', ['поясница', 'спина'], 10800, { contrast: true }],
  ['mri-knee', 'mri', 'МРТ коленного сустава', ['колено', 'колени', 'мениск', 'сустав'], 6200, { popular: true }],
  ['mri-shoulder', 'mri', 'МРТ плечевого сустава', ['плечо', 'сустав'], 6200, {}],
  ['mri-abdomen', 'mri', 'МРТ брюшной полости', ['живот', 'брюшная', 'печень'], 7400, {}],
  ['mri-pelvis', 'mri', 'МРТ органов малого таза', ['малый таз', 'таз', 'матка', 'простата'], 7200, {}],
  ['mri-pelvis-c', 'mri', 'МРТ органов малого таза с контрастом', ['малый таз', 'таз'], 12000, { contrast: true }],
  ['mri-angio', 'mri', 'МРТ-ангиография сосудов головного мозга', ['сосуды', 'ангиография', 'голова'], 6100, {}],

  ['ct-chest', 'ct', 'КТ органов грудной клетки', ['лёгкие', 'легкие', 'огк', 'грудная клетка'], 4900, { popular: true }],
  ['ct-brain', 'ct', 'КТ головного мозга', ['голова', 'мозг'], 4500, { popular: true }],
  ['ct-sinuses', 'ct', 'КТ придаточных пазух носа', ['пазухи', 'гайморит', 'нос'], 3800, { popular: true }],
  ['ct-spine-lumbar', 'ct', 'КТ пояснично-крестцового отдела', ['поясница', 'спина'], 4600, {}],
  ['ct-abdomen-c', 'ct', 'КТ брюшной полости с контрастом', ['живот', 'брюшная'], 9800, { contrast: true }],
  ['ct-urography', 'ct', 'КТ-урография с контрастом', ['почки', 'мочевыводящие', 'урография'], 10500, { contrast: true }],
  ['ct-coronary', 'ct', 'КТ-коронарография', ['сердце', 'коронарные', 'сосуды сердца'], 14500, { contrast: true }],

  ['hyg-complex', 'hygiene', 'Комплексная профгигиена (УЗ + Air Flow + полировка)', ['чистка', 'комплекс', 'зубы'], 7500, { popular: true }],
  ['hyg-uz', 'hygiene', 'Ультразвуковая чистка зубов', ['ультразвук', 'камень', 'чистка'], 4500, { popular: true }],
  ['hyg-airflow', 'hygiene', 'Air Flow (пескоструйная чистка)', ['эйрфлоу', 'аирфлоу', 'налёт', 'налет'], 4200, {}],
  ['hyg-fluor', 'hygiene', 'Профгигиена + фторирование', ['фтор', 'фторирование', 'чувствительность'], 8400, {}],
]

const serviceVariants = variantRows.map(([id, serviceId, name, synonyms, basePrice, f]) => ({
  id,
  serviceId,
  name,
  synonyms,
  basePrice,
  isPopular: !!f.popular,
  withContrast: !!f.contrast,
  isSedation: !!f.sedation,
}))
const basePrice = Object.fromEntries(serviceVariants.map((v) => [v.id, v.basePrice]))

// Демо-клиники привязаны к станциям по названию, а не по id: id меняются,
// когда справочник метро пересобирается из OpenStreetMap, а названия — нет.
const metroRef = JSON.parse(readFileSync(resolve(ROOT, 'data/metro.json'), 'utf8'))
const stationIdByName = new Map()
for (const line of metroRef.lines) {
  for (const [id, name] of line.stations) {
    const key = `${line.cityId}|${name.toLowerCase()}`
    if (!stationIdByName.has(key)) stationIdByName.set(key, id)
  }
}
function stationId(cityId, name) {
  const id = stationIdByName.get(`${cityId}|${name.toLowerCase()}`)
  if (!id) throw new Error(`Нет станции «${name}» (${cityId}) в data/metro.json`)
  return id
}

// ── Клиники ─────────────────────────────────────────────────────────────────
// tier: A — приоритет отдела, B — обычная, C — только если больше нечего
const clinicRows = [
  {
    id: 'cl-medplus', cityId: 'msk', name: 'Мед-Плюс на Автозаводской',
    address: 'ул. Ленинская Слобода, 19', tier: 'A', priceIndex: 1.0,
    stations: [['Автозаводская', 6]],
    phone: '+7 495 000-01-11', workHours: 'пн–сб 08:00–21:00, вс 09:00–18:00',
    note: 'Основной партнёр по эндоскопии. Хорошо берут пациентов с седацией.',
  },
  {
    id: 'cl-gastrocentr', cityId: 'msk', name: 'Гастроцентр на Кожуховской',
    address: 'ул. Трофимова, 4', tier: 'B', priceIndex: 1.18,
    stations: [['Кожуховская', 3]],
    phone: '+7 495 000-02-22', workHours: 'пн–пт 08:00–20:00, сб 09:00–16:00',
    note: 'Дороже среднего, но очень близко к метро.',
  },
  {
    id: 'cl-mrt-avtozavod', cityId: 'msk', name: 'МРТ-Центр на Автозаводской',
    address: 'Автозаводская ул., 23к2', tier: 'A', priceIndex: 1.0,
    stations: [['Автозаводская', 6], ['Кожуховская', 14]],
    phone: '+7 495 000-03-33', workHours: 'круглосуточно',
    note: 'Приоритетный партнёр по МРТ. Ночные слоты дешевле.',
    equipment: { model: 'Siemens Magnetom Essenza', tesla: 1.5, mriType: 'closed', maxWeightKg: 130, reportHours: 1 },
  },
  {
    id: 'cl-diagnostika', cityId: 'msk', name: 'Диагностика+ на Дубровке',
    address: 'ул. Шарикоподшипниковская, 13', tier: 'B', priceIndex: 0.88,
    stations: [['Дубровка', 8], ['Волгоградский проспект', 15]],
    phone: '+7 495 000-04-44', workHours: 'пн–вс 08:00–22:00',
    note: 'Открытый томограф — сюда отправляем клаустрофобию и вес до 150 кг.',
    equipment: { model: 'Hitachi Aperto Lucent', tesla: 0.4, mriType: 'open', maxWeightKg: 150, reportHours: 24 },
  },
  {
    id: 'cl-endo-tulskaya', cityId: 'msk', name: 'Эндо-Клиника на Тульской',
    address: 'ул. Большая Тульская, 11', tier: 'A', priceIndex: 1.08,
    stations: [['Тульская', 5]],
    phone: '+7 495 000-05-55', workHours: 'пн–сб 09:00–20:00',
    note: 'Сильнейшие эндоскописты. Держим как флагман для сложных случаев.',
  },
  {
    id: 'cl-nauka', cityId: 'msk', name: 'Клиника Наука на Академической',
    address: 'ул. Профсоюзная, 15', tier: 'B', priceIndex: 1.05,
    stations: [['Академическая', 7]],
    phone: '+7 495 000-06-66', workHours: 'пн–пт 08:00–20:00, сб 10:00–17:00',
    note: 'Универсальная: и эндоскопия, и томография.',
    equipment: { model: 'GE Signa Explorer', tesla: 1.5, mriType: 'closed', maxWeightKg: 120, reportHours: 2 },
  },
  {
    id: 'cl-stoma-tag', cityId: 'msk', name: 'Дентал Про на Таганской',
    address: 'ул. Марксистская, 9', tier: 'A', priceIndex: 1.0,
    stations: [['Таганская', 4], ['Таганская', 4]],
    phone: '+7 495 000-07-77', workHours: 'пн–вс 09:00–21:00',
    note: 'Приоритет по гигиене. Берут в день обращения.',
  },
  {
    id: 'cl-stoma-park', cityId: 'msk', name: 'Улыбка на Парке культуры',
    address: 'Комсомольский пр-т, 7', tier: 'B', priceIndex: 1.22,
    stations: [['Парк культуры', 5], ['Парк культуры', 5]],
    phone: '+7 495 000-08-88', workHours: 'пн–сб 10:00–20:00',
    note: 'Премиальный сегмент, дорого. Для тех, кому важен центр.',
  },
  {
    id: 'cl-medcenter-kursk', cityId: 'msk', name: 'Медцентр на Курской',
    address: 'ул. Земляной Вал, 27', tier: 'C', priceIndex: 0.82,
    stations: [['Курская', 9], ['Чкаловская', 11]],
    phone: '+7 495 000-09-99', workHours: 'пн–пт 09:00–19:00',
    note: 'Дёшево, но врачи слабее. Предлагаем только если больше нечего.',
    equipment: { model: 'Toshiba Vantage Elan', tesla: 1.5, mriType: 'closed', maxWeightKg: 120, reportHours: 24 },
  },
  {
    id: 'cl-tomograd', cityId: 'msk', name: 'Томоград на Университете',
    address: 'Ломоносовский пр-т, 25', tier: 'B', priceIndex: 1.35,
    stations: [['Университет', 4]],
    phone: '+7 495 000-10-10', workHours: 'пн–вс 07:00–23:00',
    note: '3 Тесла — единственный такой аппарат у партнёров. Для сложной неврологии.',
    equipment: { model: 'Philips Ingenia 3.0T', tesla: 3.0, mriType: 'closed', maxWeightKg: 140, reportHours: 1 },
  },
  {
    id: 'cl-alfa-mira', cityId: 'msk', name: 'Альфа-Клиника на Проспекте Мира',
    address: 'Проспект Мира, 51', tier: 'A', priceIndex: 1.12,
    stations: [['Проспект Мира', 5], ['Проспект Мира', 5]],
    phone: '+7 495 000-11-11', workHours: 'пн–вс 08:00–21:00',
    note: 'Делают всё. Удобно, когда пациенту нужно несколько исследований сразу.',
    equipment: { model: 'Siemens Magnetom Sola', tesla: 1.5, mriType: 'closed', maxWeightKg: 140, reportHours: 2 },
  },
  {
    id: 'cl-gastro-kuzminki', cityId: 'msk', name: 'ГастроЛайн в Кузьминках',
    address: 'Волгоградский пр-т, 105', tier: 'B', priceIndex: 0.92,
    stations: [['Кузьминки', 7]],
    phone: '+7 495 000-12-12', workHours: 'пн–сб 08:00–20:00',
    note: 'Рабочая лошадка для юго-востока.',
  },
  {
    id: 'cl-mrt-tekstil', cityId: 'msk', name: 'МРТ24 на Текстильщиках',
    address: 'ул. Люблинская, 12', tier: 'C', priceIndex: 0.75,
    stations: [['Текстильщики', 10]],
    phone: '+7 495 000-13-13', workHours: 'круглосуточно',
    note: 'Самые низкие цены. Аппарат слабый, заключение долго. Только по цене.',
    equipment: { model: 'Siemens Magnetom C!', tesla: 0.35, mriType: 'open', maxWeightKg: 150, reportHours: 48 },
  },
  {
    id: 'cl-stoma-novokuz', cityId: 'msk', name: 'СтомаПрайм на Новокузнецкой',
    address: 'ул. Пятницкая, 25', tier: 'A', priceIndex: 0.95,
    stations: [['Новокузнецкая', 4], ['Третьяковская', 6]],
    phone: '+7 495 000-14-14', workHours: 'пн–вс 09:00–21:00',
    note: 'Приоритет по гигиене в центре.',
  },
  {
    id: 'cl-medika-shabol', cityId: 'msk', name: 'Медика на Шаболовской',
    address: 'ул. Шаболовка, 34', tier: 'A', priceIndex: 0.98,
    stations: [['Шаболовская', 6]],
    phone: '+7 495 000-15-15', workHours: 'пн–пт 09:00–20:00',
    note: 'Обычно приоритетная, но сейчас на паузе.',
    pausedReason: 'Томограф на плановом обслуживании',
    pausedUntil: plusDays(9),
    equipment: { model: 'GE Optima MR360', tesla: 1.5, mriType: 'closed', maxWeightKg: 120, reportHours: 2 },
  },
  {
    id: 'cl-spb-nevsky', cityId: 'spb', name: 'Нева-Мед на Невском проспекте',
    address: 'Невский пр-т, 88', tier: 'A', priceIndex: 0.95,
    stations: [['Невский проспект', 5], ['Гостиный двор', 7]],
    phone: '+7 812 000-01-01', workHours: 'пн–вс 08:00–21:00',
    note: 'Основной партнёр в Петербурге.',
    equipment: { model: 'Siemens Magnetom Aera', tesla: 1.5, mriType: 'closed', maxWeightKg: 140, reportHours: 2 },
  },
  {
    id: 'cl-spb-moskovskaya', cityId: 'spb', name: 'Диагностик СПб на Московской',
    address: 'Московский пр-т, 208', tier: 'B', priceIndex: 0.86,
    stations: [['Московская', 4]],
    phone: '+7 812 000-02-02', workHours: 'круглосуточно',
    note: 'Дешевле центра, круглосуточно.',
    equipment: { model: 'Toshiba Vantage Titan', tesla: 1.5, mriType: 'closed', maxWeightKg: 130, reportHours: 4 },
  },
  {
    id: 'cl-spb-vosstaniya', cityId: 'spb', name: 'ГастроЦентр на площади Восстания',
    address: 'ул. Восстания, 3', tier: 'B', priceIndex: 1.0,
    stations: [['Площадь Восстания', 4], ['Маяковская', 6]],
    phone: '+7 812 000-03-03', workHours: 'пн–сб 09:00–20:00',
    note: 'Эндоскопия в центре Петербурга.',
  },
  {
    id: 'cl-spb-sportivnaya', cityId: 'spb', name: 'Дента Нева на Спортивной',
    address: 'Большой пр-т П.С., 42', tier: 'A', priceIndex: 0.9,
    stations: [['Спортивная', 5]],
    phone: '+7 812 000-04-04', workHours: 'пн–вс 10:00–21:00',
    note: 'Приоритет по гигиене в СПб.',
  },
]

// Какие услуги где делаются: clinicId → [variantId, ...]
const ENDO_FULL = ['colono-diag', 'colono-sed', 'colono-biopsy', 'colono-combo', 'gastro-diag', 'gastro-sed', 'gastro-nasal', 'gastro-helico']
const ENDO_BASIC = ['colono-diag', 'colono-sed', 'gastro-diag', 'gastro-sed']
const MRI_FULL = ['mri-brain', 'mri-brain-c', 'mri-pituitary', 'mri-cervical', 'mri-thoracic', 'mri-lumbar', 'mri-lumbar-c', 'mri-knee', 'mri-shoulder', 'mri-abdomen', 'mri-pelvis', 'mri-pelvis-c', 'mri-angio']
const MRI_BASIC = ['mri-brain', 'mri-cervical', 'mri-thoracic', 'mri-lumbar', 'mri-knee', 'mri-shoulder']
const CT_FULL = ['ct-chest', 'ct-brain', 'ct-sinuses', 'ct-spine-lumbar', 'ct-abdomen-c', 'ct-urography', 'ct-coronary']
const CT_BASIC = ['ct-chest', 'ct-brain', 'ct-sinuses', 'ct-spine-lumbar']
const HYG_FULL = ['hyg-complex', 'hyg-uz', 'hyg-airflow', 'hyg-fluor']

const offers = {
  'cl-medplus': { variants: [...ENDO_FULL, ...HYG_FULL], sedation: true, anesth: true, slotIn: 3 },
  'cl-gastrocentr': { variants: ENDO_FULL, sedation: true, anesth: true, slotIn: 4 },
  'cl-mrt-avtozavod': { variants: [...MRI_FULL, ...CT_FULL], slotIn: 1 },
  'cl-diagnostika': { variants: [...MRI_BASIC, ...CT_BASIC], slotIn: 2 },
  'cl-endo-tulskaya': { variants: ENDO_FULL, sedation: true, anesth: true, slotIn: 6 },
  'cl-nauka': { variants: [...ENDO_BASIC, ...MRI_BASIC, ...CT_BASIC], sedation: true, anesth: true, slotIn: 5 },
  'cl-stoma-tag': { variants: HYG_FULL, slotIn: 0 },
  'cl-stoma-park': { variants: HYG_FULL, slotIn: 2 },
  'cl-medcenter-kursk': { variants: [...ENDO_BASIC, ...MRI_BASIC, ...CT_BASIC], sedation: false, anesth: false, slotIn: 1 },
  'cl-tomograd': { variants: MRI_FULL, slotIn: 4 },
  'cl-alfa-mira': { variants: [...ENDO_FULL, ...MRI_FULL, ...CT_FULL, ...HYG_FULL], sedation: true, anesth: true, slotIn: 2 },
  'cl-gastro-kuzminki': { variants: ENDO_BASIC, sedation: true, anesth: true, slotIn: 3 },
  'cl-mrt-tekstil': { variants: MRI_BASIC, slotIn: 1 },
  'cl-stoma-novokuz': { variants: HYG_FULL, slotIn: 1 },
  'cl-medika-shabol': { variants: [...MRI_BASIC, ...CT_BASIC], slotIn: 14 },
  'cl-spb-nevsky': { variants: [...ENDO_FULL, ...MRI_BASIC, ...CT_BASIC], sedation: true, anesth: true, slotIn: 2 },
  'cl-spb-moskovskaya': { variants: [...MRI_FULL, ...CT_FULL], slotIn: 1 },
  'cl-spb-vosstaniya': { variants: ENDO_BASIC, sedation: true, anesth: true, slotIn: 4 },
  'cl-spb-sportivnaya': { variants: HYG_FULL, slotIn: 1 },
}

const round50 = (n) => Math.round(n / 50) * 50

// Координаты клиник: в демо ставим их на нужном удалении от опорной станции
// (пешком примерно 80 м в минуту). В боевой версии — из геокодера или от клиники.
const metro = JSON.parse(readFileSync(resolve(ROOT, 'data/metro.json'), 'utf8'))
const stationCoords = new Map()
for (const line of metro.lines) {
  for (const [id, , lat, lng] of line.stations) {
    if (lat != null) stationCoords.set(id, [lat, lng])
  }
}

function clinicPoint(c, index) {
  const [name, walkMinutes] = c.stations[0]
  const base = stationCoords.get(stationId(c.cityId, name))
  if (!base) return [null, null]
  const meters = walkMinutes * 80
  // угол выбираем детерминированно по индексу, чтобы точки не легли в линию
  const angle = ((index * 137.5) % 360) * (Math.PI / 180)
  const dLat = (meters * Math.cos(angle)) / 111_320
  const dLng = (meters * Math.sin(angle)) / (111_320 * Math.cos((base[0] * Math.PI) / 180))
  return [Number((base[0] + dLat).toFixed(6)), Number((base[1] + dLng).toFixed(6))]
}

const clinics = clinicRows.map((c, i) => {
  const [lat, lng] = clinicPoint(c, i)
  return {
    id: c.id,
    cityId: c.cityId,
    name: c.name,
    address: c.address,
    lat,
    lng,
    phone: c.phone,
    workHours: c.workHours,
    priorityTier: c.tier,
    isActive: true,
    pausedReason: c.pausedReason ?? null,
    pausedUntil: c.pausedUntil ?? null,
    notesInternal: c.note,
    updatedAt: iso(TODAY),
  }
})

const clinicMetro = []
for (const c of clinicRows) {
  for (const [name, walkMinutes] of c.stations) {
    clinicMetro.push({ clinicId: c.id, stationId: stationId(c.cityId, name), walkMinutes })
  }
}

const clinicServices = []
for (const c of clinicRows) {
  const o = offers[c.id]
  if (!o) continue
  let i = 0
  for (const variantId of o.variants) {
    const v = serviceVariants.find((x) => x.id === variantId)
    const eq = c.equipment ?? {}
    const isImaging = v.serviceId === 'mri' || v.serviceId === 'ct'

    // Клиника без штатного анестезиолога не может делать процедуры во сне.
    // Без этой проверки в выдачу попадала «колоноскопия во сне» там, где седации нет.
    if (v.isSedation && !(o.sedation && o.anesth)) continue
    // разброс слотов внутри клиники, чтобы данные выглядели живыми
    const slotDays = o.slotIn + (i % 3)
    clinicServices.push({
      id: `${c.id}__${variantId}`,
      clinicId: c.id,
      serviceVariantId: variantId,
      price: round50(v.basePrice * c.priceIndex),
      // Средняя стоимость медицинского кейса — то, что видит оператор
      // в карточке и что участвует в скоринге. В демо считаем от цены
      // услуги: настоящее значение приезжает из анкеты клиники.
      avgCaseCost: round50(v.basePrice * c.priceIndex * 1.35),
      priceSedation: v.isSedation ? null : (o.sedation && v.serviceId !== 'hygiene' && !isImaging ? round50(v.basePrice * c.priceIndex + 5200) : null),
      durationMin: isImaging ? (v.withContrast ? 45 : 25) : v.serviceId === 'hygiene' ? 60 : 30,
      hasSedation: isImaging ? false : !!o.sedation,
      hasAnesthesiologist: isImaging ? false : !!o.anesth,
      equipmentModel: isImaging ? eq.model ?? null : null,
      tesla: v.serviceId === 'mri' ? eq.tesla ?? null : null,
      mriType: v.serviceId === 'mri' ? eq.mriType ?? null : null,
      maxWeightKg: isImaging ? eq.maxWeightKg ?? null : null,
      minAge: v.serviceId === 'hygiene' ? 3 : 18,
      reportHours: isImaging ? eq.reportHours ?? null : null,
      nearestSlotDate: plusDays(slotDays),
      slotUpdatedAt: plusDays(-(i % 4)),
      priceUpdatedAt: plusDays(-(5 + (i % 20))),
      isActive: true,
    })
    i++
  }
}

// ── Врачи ───────────────────────────────────────────────────────────────────
// confidence: confirmed — подтверждено клиникой, можно называть пациенту
//             unverified — только для глаз оператора
const doctorRows = [
  ['dr-ivanov', 'cl-medplus', 'Иванов Иван Иванович', 'Врач-эндоскопист', 20, 'высшая', 'к.м.н.', 8200, ['colono', 'gastro'],
    'РНИМУ им. Пирогова, ординатура по эндоскопии в НМИЦ хирургии им. Вишневского', 4.9, 312, 'confirmed'],
  ['dr-sokolova', 'cl-medplus', 'Соколова Анна Петровна', 'Врач-эндоскопист', 12, 'первая', null, 4100, ['colono', 'gastro'],
    'Первый МГМУ им. Сеченова', 4.8, 156, 'confirmed'],
  ['dr-petrov', 'cl-gastrocentr', 'Петров Пётр Сергеевич', 'Врач-эндоскопист', 15, 'высшая', null, 6500, ['colono', 'gastro'],
    'РНИМУ им. Пирогова', 4.7, 204, 'confirmed'],
  ['dr-gavrilova', 'cl-gastrocentr', 'Гаврилова Мария Львовна', 'Врач-эндоскопист', 9, 'первая', null, 2800, ['gastro'],
    'МГМСУ им. Евдокимова', 4.6, 88, 'unverified'],
  ['dr-kim', 'cl-endo-tulskaya', 'Ким Андрей Валерьевич', 'Врач-эндоскопист', 24, 'высшая', 'д.м.н.', 14000, ['colono', 'gastro'],
    'Первый МГМУ им. Сеченова, стажировка в Showa University (Япония)', 4.9, 487, 'confirmed'],
  ['dr-novikova', 'cl-endo-tulskaya', 'Новикова Елена Дмитриевна', 'Врач-эндоскопист', 7, 'вторая', null, 1900, ['gastro'],
    'МГМСУ им. Евдокимова', 4.5, 41, 'unverified'],
  ['dr-egorova', 'cl-nauka', 'Егорова Наталья Юрьевна', 'Врач-эндоскопист', 16, 'высшая', 'к.м.н.', 6900, ['colono', 'gastro'],
    'РНИМУ им. Пирогова', 4.8, 173, 'confirmed'],
  ['dr-romanov', 'cl-alfa-mira', 'Романов Сергей Игоревич', 'Врач-эндоскопист', 18, 'высшая', null, 7300, ['colono', 'gastro'],
    'Первый МГМУ им. Сеченова', 4.8, 261, 'confirmed'],
  ['dr-tihonov', 'cl-medcenter-kursk', 'Тихонов Артём Олегович', 'Врач-эндоскопист', 5, null, null, 900, ['colono', 'gastro'],
    'МГМСУ им. Евдокимова', 4.2, 27, 'unverified'],
  ['dr-morozova', 'cl-gastro-kuzminki', 'Морозова Ольга Викторовна', 'Врач-эндоскопист', 11, 'первая', null, 3600, ['colono', 'gastro'],
    'РНИМУ им. Пирогова', 4.7, 119, 'confirmed'],
  ['dr-belova', 'cl-stoma-tag', 'Белова Ирина Сергеевна', 'Стоматолог-гигиенист', 8, 'первая', null, 5400, ['hygiene'],
    'МГМСУ им. Евдокимова', 4.9, 226, 'confirmed'],
  ['dr-zaharov', 'cl-stoma-tag', 'Захаров Дмитрий Андреевич', 'Стоматолог-терапевт', 14, 'высшая', null, 3100, ['hygiene'],
    'МГМСУ им. Евдокимова', 4.8, 147, 'confirmed'],
  ['dr-litvinova', 'cl-stoma-park', 'Литвинова Ксения Павловна', 'Стоматолог-гигиенист', 6, 'вторая', null, 2400, ['hygiene'],
    'Первый МГМУ им. Сеченова', 4.7, 93, 'unverified'],
  ['dr-safin', 'cl-stoma-novokuz', 'Сафин Рустам Маратович', 'Стоматолог-гигиенист', 10, 'первая', null, 7100, ['hygiene'],
    'Казанский ГМУ', 4.9, 198, 'confirmed'],
  ['dr-volkov', 'cl-spb-nevsky', 'Волков Максим Андреевич', 'Врач-эндоскопист', 17, 'высшая', 'к.м.н.', 7600, ['colono', 'gastro'],
    'ПСПбГМУ им. Павлова', 4.8, 214, 'confirmed'],
  ['dr-shevchenko', 'cl-spb-vosstaniya', 'Шевченко Алина Игоревна', 'Врач-эндоскопист', 10, 'первая', null, 3300, ['colono', 'gastro'],
    'СЗГМУ им. Мечникова', 4.6, 102, 'confirmed'],
  ['dr-panova', 'cl-spb-sportivnaya', 'Панова Вера Михайловна', 'Стоматолог-гигиенист', 9, 'первая', null, 6200, ['hygiene'],
    'ПСПбГМУ им. Павлова', 4.8, 165, 'confirmed'],
  ['dr-alfa-hyg', 'cl-alfa-mira', 'Дроздова Юлия Олеговна', 'Стоматолог-гигиенист', 7, 'вторая', null, 3900, ['hygiene'],
    'МГМСУ им. Евдокимова', 4.7, 76, 'unverified'],
]

const doctors = doctorRows.map(([id, clinicId, fullName, specialty, exp, category, degree, procedures, , education, ratingValue, ratingCount, confidence]) => ({
  id,
  clinicId,
  fullName,
  specialty,
  photoUrl: null,
  experienceYears: exp,
  category,
  degree,
  proceduresCount: procedures,
  education,
  ratingValue,
  ratingCount,
  ratingSource: 'агрегатор',
  ratingCheckedAt: plusDays(-12),
  confidence,
  isActive: true,
}))

const doctorServices = []
for (const row of doctorRows) {
  const [id, , , , , , , , serviceIds] = row
  for (const sid of serviceIds) {
    for (const v of serviceVariants.filter((x) => x.serviceId === sid)) {
      doctorServices.push({ doctorId: id, serviceVariantId: v.id })
    }
  }
}

// Тезисы: type = опыт | квалификация | подход | особое
// confidence = confirmed → попадает в сообщение пациенту
const spRows = [
  ['dr-ivanov', 'опыт', 'выполнил более 8 000 колоноскопий', 'confirmed'],
  ['dr-ivanov', 'квалификация', 'врач высшей категории, кандидат медицинских наук', 'confirmed'],
  ['dr-ivanov', 'подход', 'работает в медикаментозном сне под контролем анестезиолога', 'confirmed'],
  ['dr-ivanov', 'подход', 'подробно проговаривает каждый шаг до начала процедуры', 'confirmed'],
  ['dr-sokolova', 'опыт', 'более 4 000 выполненных исследований', 'confirmed'],
  ['dr-sokolova', 'подход', 'специализируется на тревожных пациентах и первом опыте', 'confirmed'],
  ['dr-petrov', 'опыт', 'более 6 500 исследований за 15 лет практики', 'confirmed'],
  ['dr-petrov', 'квалификация', 'врач высшей категории', 'confirmed'],
  ['dr-gavrilova', 'подход', 'выполняет трансназальную гастроскопию — через нос, без рвотного рефлекса', 'confirmed'],
  ['dr-kim', 'опыт', 'более 14 000 исследований, 24 года практики', 'confirmed'],
  ['dr-kim', 'квалификация', 'доктор медицинских наук, врач высшей категории', 'confirmed'],
  ['dr-kim', 'квалификация', 'стажировался по эндоскопии в Университете Showa, Япония', 'confirmed'],
  ['dr-kim', 'особое', 'берёт сложные случаи и повторные исследования после неудачного опыта', 'confirmed'],
  ['dr-novikova', 'подход', 'мягкая методика, много времени уделяет подготовке пациента', 'unverified'],
  ['dr-egorova', 'опыт', 'около 7 000 исследований', 'confirmed'],
  ['dr-egorova', 'квалификация', 'кандидат медицинских наук, высшая категория', 'confirmed'],
  ['dr-romanov', 'опыт', 'более 7 000 процедур, 18 лет практики', 'confirmed'],
  ['dr-romanov', 'подход', 'выполняет колоноскопию и гастроскопию за один сон', 'confirmed'],
  ['dr-tihonov', 'опыт', '5 лет практики', 'unverified'],
  ['dr-morozova', 'опыт', 'более 3 500 исследований', 'confirmed'],
  ['dr-morozova', 'подход', 'работает с седацией, много пациентов старшего возраста', 'confirmed'],
  ['dr-belova', 'опыт', 'более 5 400 процедур профгигиены', 'confirmed'],
  ['dr-belova', 'подход', 'работает с повышенной чувствительностью зубов и дёсен', 'confirmed'],
  ['dr-belova', 'особое', 'принимает детей с 6 лет', 'confirmed'],
  ['dr-zaharov', 'квалификация', 'врач высшей категории, 14 лет практики', 'confirmed'],
  ['dr-litvinova', 'подход', 'аккуратная работа с брекет-системами и винирами', 'unverified'],
  ['dr-safin', 'опыт', 'более 7 100 процедур профгигиены', 'confirmed'],
  ['dr-safin', 'подход', 'использует Air Flow и ультразвук в одном приёме', 'confirmed'],
  ['dr-volkov', 'опыт', 'более 7 600 исследований', 'confirmed'],
  ['dr-volkov', 'квалификация', 'кандидат медицинских наук, высшая категория', 'confirmed'],
  ['dr-shevchenko', 'опыт', 'более 3 300 исследований', 'confirmed'],
  ['dr-panova', 'опыт', 'более 6 200 процедур профгигиены', 'confirmed'],
  ['dr-alfa-hyg', 'подход', 'бережная чистка при чувствительной эмали', 'unverified'],
]

const doctorSellingPoints = spRows.map(([doctorId, type, text, confidence], i) => ({
  id: `sp-${i + 1}`,
  doctorId,
  type,
  text,
  confidence,
  sort: i,
}))

// ── Запись файла ────────────────────────────────────────────────────────────
const catalog = {
  _comment: 'ДЕМО-ДАННЫЕ, сгенерированы scripts/seed.js. Реальные данные заменят этот файл целиком.',
  version: new Date().toISOString(),
  services,
  serviceVariants,
  clinics,
  clinicMetro,
  clinicServices,
  doctors,
  doctorServices,
  doctorSellingPoints,
}

mkdirSync(resolve(ROOT, 'data'), { recursive: true })

// Демо не должно молча затирать импортированные анкеты. Такое уже случалось:
// один запуск seed — и семь настоящих клиник заменились выдуманными.
// Восстановить можно из data/imported.json, но лучше не доводить.
const CATALOG_PATH = resolve(ROOT, 'data/catalog.json')
const force = process.argv.includes('--force')
let realCatalog = null
if (!force && existsSync(CATALOG_PATH)) {
  try {
    const current = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'))
    if (!/^ДЕМО-ДАННЫЕ/.test(current._comment ?? '')) realCatalog = current
  } catch {
    // нечитаемый файл перезаписать не жалко
  }
}

if (realCatalog) {
  console.log('data/catalog.json содержит импортированные данные:')
  console.log(`  клиник: ${realCatalog.clinics?.length ?? 0}, врачей: ${realCatalog.doctors?.length ?? 0}`)
  console.log('Демо-данные их затрут. Если это правда нужно — npm run seed -- --force')
  console.log('Обновляю только data/catalog.demo.json (набор для тестов).')
} else {
  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8')
}

// Отдельная копия для тестов: catalog.json перезаписывается импортом реальных
// данных, а тестам нужен стабильный набор, который не зависит от того,
// что сейчас лежит в рабочем каталоге.
writeFileSync(resolve(ROOT, 'data/catalog.demo.json'), JSON.stringify(catalog, null, 2), 'utf8')

console.log('')
console.log(realCatalog ? 'data/catalog.demo.json обновлён:' : 'data/catalog.json создан:')
console.log(`  клиник:            ${clinics.length}`)
console.log(`  привязок к метро:  ${clinicMetro.length}`)
console.log(`  услуг в клиниках:  ${clinicServices.length}`)
console.log(`  подвидов услуг:    ${serviceVariants.length}`)
console.log(`  врачей:            ${doctors.length}`)
console.log(`  тезисов:           ${doctorSellingPoints.length}`)
