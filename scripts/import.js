// Импорт реальных данных из рабочего Excel-файла в каталог сервиса.
//
// Файл устроен так:
//   · листы «Скрипт_<услуга>_<город>» — списки МАРШРУТИЗИРУЕМ / УВОДИМ
//     по юрлицам, со средней стоимостью кейса;
//   · по одному листу на клинику — анкета филиала, вопросы-ответы
//     и таблица врачей.
//
// Скрипт ничего не выдумывает: чего в файле нет (цены по услугам,
// свободные окна), то помечается как отсутствующее и попадает в отчёт.
//
// Запуск:  npm run import -- "путь/к/файлу.xlsx"

import XLSX from 'xlsx'
import { plural } from '../src/core/metro.js'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GEO_CACHE_PATH = resolve(ROOT, 'data/geocode-cache.json')

const SERVICE_BY_SHEET = { ГАСТРО: 'gastro', КОЛОНО: 'colono' }
const CITY_BY_SHEET = { МСК: 'msk', СПБ: 'spb' }

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()
const isYes = (v) => /^(да|есть|выполняется)/i.test(norm(v))
const slug = (s) =>
  norm(s).toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 48)

// ── чтение книг ─────────────────────────────────────────────────────────────
// Можно передать несколько файлов сразу: общий файл со списками маршрутизации
// и отдельные анкеты клиник. Анкеты бывают двух видов — всё на одном листе
// или разложенное по листам «Филиалы / Общие вопросы / Врачи».
//
// Во втором случае названия клиники в файле нет, его нужно передать явно:
//   npm run import -- "анкета.xlsx" --name "ООО «КЛИНИКА БУДЬ ЗДОРОВ»"
const argv = process.argv.slice(2)
const files = []
const explicitNames = []
let forcedCity = null
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--name') { explicitNames.push(argv[++i] ?? ''); continue }
  if (argv[i] === '--city') { forcedCity = argv[++i] ?? null; continue }
  files.push(argv[i])
}
if (!files.length || files.some((f) => !existsSync(f))) {
  console.error('Укажите путь к файлу: npm run import -- "C:/.../файл.xlsx" [--name "ООО «...»"]')
  console.error('Файлов можно передать несколько.')
  process.exit(1)
}

const books = files.map((f) => ({ file: f, wb: XLSX.readFile(f) }))
const gridOf = (wb, name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' })

const warnings = []
const warn = (m) => warnings.push(m)

function* allSheets() {
  for (const { wb, file } of books) {
    for (const sheetName of wb.SheetNames) yield { wb, file, sheetName }
  }
}

// ── 1. Списки маршрутизации ────────────────────────────────────────────────
// Возвращает Map: юрлицо → { route: Set(cityId|serviceId), avoid: Set(...), cost: {} }
function readRouting() {
  const byLegal = new Map()

  for (const { wb, sheetName } of allSheets()) {
    // \w в JS не покрывает кириллицу, поэтому просто режем по подчёркиваниям
    const parts = sheetName.split('_')
    if (parts.length !== 3 || !/^скрипт$/i.test(parts[0])) continue
    const serviceId = SERVICE_BY_SHEET[parts[1].toUpperCase()]
    const cityId = CITY_BY_SHEET[parts[2].toUpperCase()]
    if (!serviceId || !cityId) {
      warn(`Лист «${sheetName}»: не понял услугу или город, пропущен`)
      continue
    }

    let mode = null
    for (const row of gridOf(wb, sheetName)) {
      const first = norm(row[0])
      if (/^МАРШРУТИЗИРУЕМ/i.test(first)) { mode = 'route'; continue }
      if (/^УВОДИМ/i.test(first)) { mode = 'avoid'; continue }
      if (!mode || !first || /^Клиника/i.test(first)) continue

      const key = legalKey(first)
      if (!byLegal.has(key)) {
        byLegal.set(key, { legalName: first, route: new Set(), avoid: new Set(), cost: {} })
      }
      const entry = byLegal.get(key)
      entry[mode].add(`${cityId}|${serviceId}`)

      const cost = Number(String(row[1]).replace(',', '.'))
      if (mode === 'route' && Number.isFinite(cost) && cost > 0) {
        entry.cost[`${cityId}|${serviceId}`] = Math.round(cost)
      }
    }
  }
  return byLegal
}

// Пациенту юрлицо называть незачем: «ООО «Скандинавский центр здоровья»»
// в сообщении читается как выписка из реестра. Оставляем только название.
function publicNameOf(legalName) {
  const name = norm(legalName)
    .replace(/^(ООО|ОАО|ЗАО|АО|ПАО|Общество с ограниченной ответственностью)\s+/i, '')
    // кавычки убираем везде: в реестре они встречаются и в середине —
    // «ООО «Клиника Будь здоров» (г. Санкт-Петербург)»
    .replace(/[«»"']/g, '')
    // город в скобках пациенту не нужен, он и так знает, где находится
    .replace(/\s*\((?:г\.?\s*)?[^)]*\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  // в реестрах пишут капсом — пациенту это читается как крик
  const letters = name.replace(/[^А-Яа-яЁёA-Za-z]/g, '')
  const allCaps = letters.length > 2 && letters === letters.toUpperCase()
  if (!allCaps) return name

  return name
    .toLowerCase()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

// «ООО «Скандинавский центр здоровья»» и «ООО "Скандинавский центр здоровья"»
// должны считаться одним юрлицом
function legalKey(name) {
  return norm(name)
    .toLowerCase()
    .replace(/[«»"'']/g, '')
    .replace(/^(ооо|оао|зао|ао|общество с ограниченной ответственностью)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── 2. Анкеты клиник ───────────────────────────────────────────────────────
// Раскладка A: всё на одном листе (шапка, вопросы, врачи подряд).
// Раскладка B: три листа — «Филиалы», «Общие вопросы», «Врачи».
function findQuestionnaires() {
  const found = []

  for (const { wb, file } of books) {
    const sheets = wb.SheetNames
    const hasSplit =
      sheets.some((n) => /^филиал/i.test(n)) &&
      sheets.some((n) => /общие вопрос/i.test(n)) &&
      sheets.some((n) => /^врач/i.test(n))

    if (hasSplit) {
      found.push({
        layout: 'split',
        wb,
        file,
        name: null, // в файле названия нет, придёт из --name
        branchSheet: sheets.find((n) => /^филиал/i.test(n)),
        qaSheet: sheets.find((n) => /общие вопрос/i.test(n)),
        doctorsSheet: sheets.find((n) => /^врач/i.test(n)),
      })
      continue
    }

    for (const sheetName of sheets) {
      const g = gridOf(wb, sheetName)
      if (/адрес филиала/i.test(norm(g[0]?.[0]))) {
        found.push({ layout: 'single', wb, file, name: sheetName, sheetName })
      }
    }
  }
  return found
}

function readQuestionnaire(src) {
  return src.layout === 'split' ? readSplit(src) : readSingle(src)
}

// В одном файле может быть сеть: несколько филиалов, у каждого свой адрес,
// метро и — иногда — своё юрлицо прямо в строке адреса.
// «ООО "Первая семейная клиника на Коломяжском" пр.Коломяжский д.36»
function splitNameAndAddress(cell) {
  const raw = norm(cell)
  const m = raw.match(/^\s*(?:ООО|ОАО|ЗАО|АО|ПАО)?\s*[«"']([^«»"']+)[»"']\s*,?\s*(.*)$/i)
  if (m && m[1]) return { name: m[1].trim(), address: m[2].trim() || raw }
  return { name: null, address: raw }
}

// Раскладка B: данные разложены по трём листам
function readSplit(src) {
  const branchRows = gridOf(src.wb, src.branchSheet)
  const branches = []
  for (const row of branchRows.slice(1)) {
    const first = norm(row[0])
    if (!first) continue
    const { name, address } = splitNameAndAddress(first)
    branches.push({
      name,
      address,
      metroRaw: norm(row[1]),
      doesGastro: /выполняется|да/i.test(norm(row[2])),
      doesColono: /выполняется|да/i.test(norm(row[3])),
      hasSedation: isYes(row[4]),
    })
  }

  const qa = []
  let category = ''
  for (const row of gridOf(src.wb, src.qaSheet).slice(1)) {
    const a = norm(row[0])
    const b = norm(row[1])
    if (a) category = a
    if (b) qa.push({ category, question: b, answer: norm(row[2]) })
  }

  const dg = gridOf(src.wb, src.doctorsSheet)
  const headerRow = dg.findIndex((r) => /^ФИО врача/i.test(norm(r[0])))
  const doctors = headerRow >= 0 ? readDoctors(dg, headerRow) : []

  return { name: src.name, branches, qa, doctors }
}

// Раскладка A: всё на одном листе
function readSingle(src) {
  const g = gridOf(src.wb, src.sheetName)

  // шапка филиала
  const head = g[1] ?? []
  const branch = {
    address: norm(head[0]),
    metroRaw: norm(head[1]),
    doesGastro: isYes(head[2]),
    doesColono: isYes(head[3]),
    hasSedation: isYes(head[4]),
  }

  // блок вопрос-ответ: колонки «Категория | Вопрос | Ответ»
  const qa = []
  let category = ''
  let inQa = false
  let doctorsHeaderRow = -1

  for (let i = 0; i < g.length; i++) {
    const row = g[i]
    const a = norm(row[0])
    const b = norm(row[1])
    const c = norm(row[2])

    if (/^категория вопроса/i.test(a)) { inQa = true; continue }
    if (/^ФИО врача/i.test(a)) { doctorsHeaderRow = i; inQa = false; break }
    if (!inQa) continue

    if (a) category = a
    if (b) qa.push({ category, question: b, answer: c })
  }

  const doctors = doctorsHeaderRow >= 0 ? readDoctors(g, doctorsHeaderRow) : []
  return { name: src.name, branches: [branch], qa, doctors }
}

// Таблица врачей одинаковая в обеих раскладках
function readDoctors(g, doctorsHeaderRow) {
  const doctors = []
  {
    const head = g[doctorsHeaderRow].map(norm)
    const col = (needle) => head.findIndex((h) => h.toLowerCase().includes(needle))
    const idx = {
      fio: 0,
      branches: col('филиал'),
      does: col('что выполняет'),
      years: col('стаж'),
      category: col('категория'),
      education: col('образование'),
      goodAt: col('особенно хорошо'),
      gastroPerYear: col('эгдс в год'),
      colonoPerYear: col('колоноскопий в год'),
      polypsPerYear: col('полипэктомий в год'),
      societies: col('общества'),
      languages: col('языки'),
      patientText: col('текст о враче'),
      photo: col('ссылка на фото'),
      forAnxious: col('тревожному'),
    }

    for (let i = doctorsHeaderRow + 1; i < g.length; i++) {
      const row = g[i]
      const fio = norm(row[idx.fio])
      if (!fio) continue
      const get = (k) => (idx[k] >= 0 ? norm(row[idx[k]]) : '')
      doctors.push({
        fullName: fio,
        // в каких филиалах принимает — нужно, чтобы не размножить врача по сети
        branches: get('branches'),
        does: get('does'),
        experienceYears: parseYears(get('years')),
        category: parseCategory(get('category')),
        degree: parseDegree(get('category')),
        // в этой колонке иногда оказывается ссылка на страницу врача —
      // как образование её показывать нельзя
      education: /^https?:\/\//i.test(get('education')) ? '' : get('education'),
      educationUrl: /^https?:\/\//i.test(get('education')) ? get('education') : null,
        goodAt: get('goodAt'),
        gastroPerYear: get('gastroPerYear'),
        colonoPerYear: get('colonoPerYear'),
        polypsPerYear: get('polypsPerYear'),
        societies: get('societies'),
        languages: get('languages'),
        patientText: get('patientText'),
        photoUrl: imageUrl(get('photo')) ?? imageUrl(get('education')),
        forAnxious: isYes(get('forAnxious')),
      })
    }
  }
  return doctors
}

function parseYears(v) {
  const m = norm(v).match(/(\d+)/)
  return m ? Number(m[1]) : null
}
// «высшая» → «высшей категории»: в тексте нужен родительный падеж
const CATEGORY_GENITIVE = { высшая: 'высшей', первая: 'первой', вторая: 'второй' }

function parseCategory(v) {
  const s = norm(v).toLowerCase()
  if (s.includes('высш')) return 'высшая'
  if (s.includes('перв')) return 'первая'
  if (s.includes('втор')) return 'вторая'
  return null
}
function parseDegree(v) {
  const s = norm(v).toLowerCase()
  if (s.includes('д.м.н') || s.includes('доктор мед')) return 'д.м.н.'
  if (s.includes('к.м.н') || s.includes('кандидат мед')) return 'к.м.н.'
  return null
}

// ── 3. Геокодирование адресов ──────────────────────────────────────────────
const geoCache = existsSync(GEO_CACHE_PATH)
  ? JSON.parse(readFileSync(GEO_CACHE_PATH, 'utf8'))
  : {}

// Адреса в файле написаны по-разному: «ул. 2 ая Кабельная дом 2 , строение 37».
// Геокодер такое не понимает. Готовим несколько вариантов запроса и пробуем
// по очереди — от самого точного к самому общему.
//
// Тонкость:  и \w в JS не работают с кириллицей, поэтому границы слов
// задаём явно через пробелы и запятые.
// Сокращения типов улиц раскрываем в полные слова: геокодер понимает
// «Лиговский проспект», но спотыкается на «Лиговский пр. д. 274».
const STREET_ABBR = [
  // \b в JS не работает перед кириллицей, поэтому границы задаём явно.
  // Точка может стоять как с пробелом, так и без: «пр. Ленинский», «пр.Ленинский».
  [/(^|[\s,])ул\.\s*/gi, '$1улица '],
  [/(^|[\s,])пр-т\.?\s*/gi, '$1проспект '],
  [/(^|[\s,])пр\.\s*/gi, '$1проспект '],
  [/(^|[\s,])пер\.\s*/gi, '$1переулок '],
  [/(^|[\s,])наб\.\s*/gi, '$1набережная '],
  [/(^|[\s,])б-р\.?\s*/gi, '$1бульвар '],
  [/(^|[\s,])ш\.\s*/gi, '$1шоссе '],
  [/(^|[\s,])пл\.\s*/gi, '$1площадь '],
  // тип может стоять и после названия: «Лиговский пр.»
  [/\s+пр\.?(?=\s|,|$)/gi, ' проспект'],
  [/\s+ул\.?(?=\s|,|$)/gi, ' улица'],
]

function addressCandidates(raw) {
  let s = norm(raw)
    // «строение 37», «корпус 2» геокодер всё равно не найдёт
    .replace(/,?\s*(строение|стр\.?|корпус|корп\.?|литера|лит\.?|к)\.?\s*\d+[а-я]?/gi, '')
    // маркеры «г.» и «д.» только мешают
    .replace(/(^|[\s,])г\.\s*/gi, '$1')
    .replace(/(^|[\s,])(дом|д)\.?\s*(?=\d)/gi, '$1')
    // «2 ая Кабельная» → «2-я Кабельная»
    .replace(/(\d+)\s*-?\s*(ая|ья|ой|ый|ий|ое|я|й)(?=[\s,]|$)/gi, '$1-я')

  for (const [re, full] of STREET_ABBR) s = s.replace(re, full)

  s = s.replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').replace(/,\s*$/, '').trim()

  const out = [s]

  // «Москва, улица 2-я Кабельная 2» → «Москва, 2-я Кабельная улица, 2»:
  // геокодер увереннее находит, когда тип улицы стоит после названия
  const m = s.match(/^(.*?),\s*улица\s+(.+?)(?:,?\s+(\d+[а-я]?))?$/i)
  if (m) {
    const [, city, street, house] = m
    if (house) out.push(`${city}, ${street} улица, ${house}`)
    out.push(`${city}, ${street} улица`)
  }

  // дом отдельной запятой — так тоже понимает лучше
  const comma = s.replace(/\s+(\d+[а-я]?)$/i, ', $1')
  if (comma !== s) out.push(comma)

  // без номера дома — хотя бы улица
  const noHouse = s.replace(/,?\s*\d+[а-я]?$/i, '')
  if (noHouse !== s) out.push(noHouse)

  return [...new Set(out.filter(Boolean))]
}

async function askNominatim(q) {
  const params = new URLSearchParams({
    q, format: 'jsonv2', limit: '1', 'accept-language': 'ru',
  })
  await new Promise((r) => setTimeout(r, 1200)) // правила Nominatim: 1 запрос в секунду
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': 'skript-operator-import/0.1 (internal tool)' },
  })
  if (!res.ok) {
    warn(`Геокодер ответил ${res.status} на «${q}»`)
    return null
  }
  const data = await res.json()
  return data[0] ? { lat: Number(data[0].lat), lng: Number(data[0].lon) } : null
}

async function geocode(address) {
  if (address in geoCache) return geoCache[address]

  const candidates = addressCandidates(address)
  let hit = null
  for (let i = 0; i < candidates.length && !hit; i++) {
    hit = await askNominatim(candidates[i])
    if (hit && i > 0) {
      warn(`«${address}»: нашёлся только по варианту «${candidates[i]}» — проверьте точку на карте`)
    }
  }
  if (!hit) warn(`Не удалось геокодировать адрес: «${address}»`)

  geoCache[address] = hit
  return hit
}

// ── 4. Сборка каталога ─────────────────────────────────────────────────────
const routing = readRouting()
const sources = findQuestionnaires()

// имена из --name раздаём анкетам, у которых своего названия нет
// имя может лежать в строках филиалов — тогда --name не нужен
for (const src of sources) {
  if (src.name) continue
  const peek = src.layout === 'split' ? readSplit(src) : null
  if (peek?.branches?.some((b) => b.name)) src.name = 'из строк филиалов'
}
const nameless = sources.filter((s) => !s.name || s.name === 'из строк филиалов' ? !s.name : false)
if (nameless.length && explicitNames.length !== nameless.length) {
  console.error(
    `Анкет без названия клиники: ${nameless.length}, а --name передано ${explicitNames.length}.`
  )
  console.error('Добавьте столько же --name "ООО «...»", сколько таких анкет.')
  process.exit(1)
}
nameless.forEach((s, i) => { s.name = explicitNames[i] })

const questionnaires = sources.map(readQuestionnaire)

const metro = JSON.parse(readFileSync(resolve(ROOT, 'data/metro.json'), 'utf8'))
const stations = []
for (const line of metro.lines) {
  for (const [id, name, lat, lng] of line.stations) {
    if (lat != null) stations.push({ id, name, cityId: line.cityId, lat, lng })
  }
}

const clinics = []
const clinicMetro = []
const clinicServices = []
const doctors = []
const doctorServices = []
const doctorSellingPoints = []
const clinicDetails = []
const clinicQa = [] // ответы клиники на лист «Общие вопросы» — показываем оператору


let spCounter = 0

// Город определяем по тексту анкеты: в адресах и названиях филиалов
// почти всегда есть «Петербург» или «Москва». Если не нашлось — считаем
// голоса по станциям метро, а если и так неясно, помогает флаг --city.
function detectCity(q) {
  if (forcedCity) return forcedCity
  const text = [q.name, ...q.branches.map((b) => `${b.name ?? ''} ${b.address} ${b.metroRaw}`)]
    .join(' ')
    .toLowerCase()
  if (/петербург|спб|санкт/.test(text)) return 'spb'
  if (/москва|мск/.test(text)) return 'msk'

  const votes = { msk: 0, spb: 0 }
  for (const b of q.branches) {
    for (const name of metroNamesOf(b.metroRaw)) {
      for (const st of stations) {
        if (st.name.toLowerCase() === name.toLowerCase()) votes[st.cityId]++
      }
    }
  }
  if (votes.spb !== votes.msk) return votes.spb > votes.msk ? 'spb' : 'msk'
  warn(`Анкета «${q.name}»: город определить не удалось, взял Москву. Задайте --city`)
  return 'msk'
}

// «м.Юго-Западная, м.Ленинский проспект, Красносельский район» → две станции
function metroNamesOf(raw) {
  const out = []
  // «м» только отдельным словом, иначе «Приморский район» даёт станцию «орский»
  // «метро» может быть без точки, а одиночная «м» — только с точкой,
  // иначе «Приморский район» превращается в станцию «орский»
  const re = /(?:^|[\s,;(])(?:ст\.?\s*)?(?:метро\.?|м\.)\s*[«"']?\s*([^«»"'\/,;]+)/gi
  let m
  while ((m = re.exec(norm(raw)))) {
    const name = m[1].replace(/[«»"']/g, '').replace(/\s+район$/i, '').trim()
    if (name && !/район|округ/i.test(name)) out.push(name)
  }
  return [...new Set(out)]
}

// Врач относится к филиалу, если в его строке упомянуто название филиала.
// Когда филиал в анкете один или колонка пустая — врач принимает везде.
function doctorWorksAt(doctor, branch, q) {
  if (q.branches.length === 1) return true
  const where = norm(doctor.branches ?? '').toLowerCase()
  const bname = norm(branch.name ?? '').toLowerCase()
  if (!where || !bname) return true
  if (where.includes(bname) || bname.includes(where)) return true
  // сверяем по отличающей части названия: «на Коломяжском», «Петербурга»
  const tail = bname.split(/\s+/).slice(-2).join(' ')
  return tail.length > 3 && where.includes(tail)
}

for (const q of questionnaires) {
  const cityId = detectCity(q)

  for (const branch of q.branches) {
    // название филиала бывает своё («на Коломяжском»), бывает общее для анкеты
    const branchLegal = branch.name ?? norm(q.name)
    const key = legalKey(branchLegal)

    // Сопоставляем филиал с юрлицом из списков маршрутизации.
    //
    // Тонкость: у сети бывают ОДНОИМЁННЫЕ юрлица в разных городах —
    // «ООО «КЛИНИКА БУДЬ ЗДОРОВ»» в Москве и «ООО «Клиника Будь здоров»
    // (г. Санкт-Петербург)». Точное совпадение по имени цепляло московское,
    // и питерский филиал оставался без цен. Поэтому среди подходящих
    // кандидатов выбираем того, у кого есть данные по нужному городу.
    const candidates = []
    const exact = routing.get(key)
    if (exact) candidates.push(exact)
    for (const [k, v] of routing) {
      // Excel обрезает имя листа до 31 символа — отсюда сравнение по префиксу
      if (v !== exact && (k.startsWith(key) || key.startsWith(k))) candidates.push(v)
    }

    const hasCityData = (v) =>
      [...v.route, ...v.avoid].some((entry) => entry.startsWith(`${cityId}|`))
    const route = candidates.find(hasCityData) ?? candidates[0] ?? null

    if (!route) warn(`«${branchLegal}»: юрлица нет в листах маршрутизации`)
    else if (!hasCityData(route)) {
      warn(`«${branchLegal}»: юрлицо есть в списках, но не по городу ${cityId} — цен не будет`)
    }

    const fullLegalName = route?.legalName ?? branchLegal
    const clinicId = `cl-${slug(fullLegalName)}`

    const cityPrefix = cityId === 'spb' ? 'Санкт-Петербург' : 'Москва'
    const point = await geocode(`${cityPrefix}, ${branch.address}`)

    // «уводим» — если юрлицо есть в списках увода и ни разу в маршрутизации
    const avoided = route ? route.avoid.size > 0 && route.route.size === 0 : false

    clinics.push({
      id: clinicId,
      cityId,
      name: publicNameOf(fullLegalName),
      legalName: fullLegalName,
      address: branch.address,
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      phone: null,
      workHours: null,
      priorityTier: 'A',
      isAvoided: avoided,
      isActive: true,
      pausedReason: null,
      pausedUntil: null,
      notesInternal: answerOf(q, 'важно знать координатору'),
      updatedAt: new Date().toISOString().slice(0, 10),
    })

    // у филиала рядом может быть несколько станций
    const matched = []
    for (const name of metroNamesOf(branch.metroRaw)) {
      const st = stations.find(
        (s) => s.cityId === cityId && s.name.toLowerCase() === name.toLowerCase()
      )
      if (st) matched.push(st)
      else warn(`Станции «${name}» нет в data/metro.json (там демо-подмножество)`)
    }
    let stationApproximate = false
    if (!matched.length && point) {
      const st = nearestStation(point, cityId)
      if (st) {
        matched.push(st)
        stationApproximate = true
        warn(`«${branchLegal}»: привязал к ближайшей известной станции «${st.name}»`)
      }
    }
    if (!matched.length) {
      warn(`«${branchLegal}»: нет ни координат, ни станции — на карте не появится`)
    }
    for (const st of matched) {
      // approximate — станции из анкеты нет в справочнике, взяли ближайшую;
      // время в пути по такой привязке верить нельзя
      clinicMetro.push({ clinicId, stationId: st.id, walkMinutes: null, approximate: stationApproximate })
    }
    if (matched.length) warn('минуты пешком от метро не заданы — поставьте вручную')

    // ── услуги филиала ──
    const maxWeight = parseYears(answerOf(q, 'ограничение по весу'))
    const sedation = isYes(answerOf(q, 'седация доступна')) || branch.hasSedation
    const anesth = /анестезиолог/i.test(answerOf(q, 'осмотр анестезиолога')) || sedation

    const offered = []
    if (branch.doesGastro) offered.push(['gastro', 'gastro-diag', 'gastro-sed'])
    if (branch.doesColono) offered.push(['colono', 'colono-diag', 'colono-sed'])

    for (const [serviceId, plainId, sedId] of offered) {
      const avgCost = route?.cost[`${cityId}|${serviceId}`] ?? null

      // Филиал делает услугу, но отдел не внёс его в список «маршрутизируем»
      // по этой услуге — значит либо забыли, либо туда не направляем.
      if (route && !route.route.has(`${cityId}|${serviceId}`)) {
        warn(`«${branchLegal}»: делает ${serviceId}, но в списке МАРШРУТИЗИРУЕМ по этой услуге его нет`)
      } else if (avgCost == null) {
        warn(`«${branchLegal}»: в списке МАРШРУТИЗИРУЕМ по ${serviceId} нет средней стоимости кейса`)
      }
      const durationRaw = answerOf(
        q,
        serviceId === 'gastro' ? 'длительность эгдс' : 'длительность колоноскопии'
      )
      for (const variantId of [plainId, sedId]) {
        if (variantId === sedId && !(sedation && anesth)) continue
        clinicServices.push({
          id: `${clinicId}__${variantId}`,
          clinicId,
          serviceVariantId: variantId,
          price: null,
          avgCaseCost: avgCost,
          priceSedation: null,
          durationMin: parseYears(durationRaw),
          hasSedation: sedation,
          hasAnesthesiologist: anesth,
          equipmentModel: answerOf(q, 'производитель и класс эндоскопов') || null,
          tesla: null,
          mriType: null,
          maxWeightKg: maxWeight,
          minAge: null,
          reportHours: null,
          nearestSlotDate: null,
          slotUpdatedAt: null,
          priceUpdatedAt: null,
          isActive: true,
        })
      }
    }

    // ── врачи этого филиала ──
    const mine = q.doctors.filter((d) => doctorWorksAt(d, branch, q))
    if (!mine.length) warn(`«${branchLegal}»: ни один врач не привязан к филиалу`)

    for (const d of mine) {
      const doctorId = `dr-${slug(clinicId + '-' + d.fullName)}`
      doctors.push({
        id: doctorId,
        clinicId,
        fullName: d.fullName,
        specialty: 'Врач-эндоскопист',
        photoUrl: d.photoUrl,
        experienceYears: d.experienceYears,
        category: d.category,
        degree: d.degree,
        proceduresCount: null,
        education: d.education || null,
        patientText: d.patientText || null,
        forAnxious: d.forAnxious,
        ratingValue: null,
        ratingCount: null,
        ratingSource: null,
        ratingCheckedAt: null,
        confidence: 'confirmed',
        isActive: true,
      })

      const doesGastro = /гастроскоп|эгдс|фгдс/i.test(d.does)
      const doesColono = /колоноскоп|фкс/i.test(d.does)
      for (const cs of clinicServices.filter((c) => c.clinicId === clinicId)) {
        const forGastro = cs.serviceVariantId.startsWith('gastro')
        if ((forGastro && doesGastro) || (!forGastro && doesColono)) {
          doctorServices.push({ doctorId, serviceVariantId: cs.serviceVariantId })
        }
      }

      const add = (type, text) => {
        if (!norm(text)) return
        doctorSellingPoints.push({
          id: `sp-${++spCounter}`,
          doctorId,
          type,
          text: norm(text),
          confidence: 'confirmed',
          sort: spCounter,
        })
      }
      if (d.experienceYears) {
        add('опыт', `${d.experienceYears} ${plural(d.experienceYears, 'год', 'года', 'лет')} практики`)
      }
      if (d.category) {
        add('квалификация', `врач ${CATEGORY_GENITIVE[d.category] ?? d.category} категории`)
      }
      if (d.degree) add('квалификация', d.degree)
      // ноль и «нет» — не достижение, в тезисы такое не пускаем
      const count = (v) => /\d/.test(v) && !/^0+$/.test(norm(v)) && !/^нет$/i.test(norm(v))
      if (count(d.gastroPerYear)) add('опыт', `выполняет ${d.gastroPerYear.toLowerCase()} гастроскопий в год`)
      if (count(d.colonoPerYear)) add('опыт', `выполняет ${d.colonoPerYear.toLowerCase()} колоноскопий в год`)
      if (count(d.polypsPerYear)) add('опыт', `${d.polypsPerYear.toLowerCase()} полипэктомий в год`)
      if (d.goodAt && !/^нет$/i.test(d.goodAt) && !/^https?:/i.test(d.goodAt)) add('подход', d.goodAt)
      if (d.forAnxious) add('подход', 'рекомендован тревожным пациентам')
    }

    clinicDetails.push({ clinicId, legalName: fullLegalName, branch, qa: q.qa })

    // Тот же лист, но в плоском виде и с привязкой к клинике: приложение
    // читает каталог, а не отчёт импорта.
    q.qa.forEach((x, i) => {
      clinicQa.push({
        clinicId,
        category: x.category || 'Прочее',
        question: x.question,
        answer: x.answer || null,
        sort: i,
      })
    })
  }
}


// Клиники часто вписывают в столбец «фото» ссылку на страницу врача, а не на
// картинку. Такой адрес нельзя ставить в <img>: получится битая иконка вместо
// аккуратных инициалов. Берём только то, что действительно похоже на файл.
function imageUrl(value) {
  const v = norm(value)
  if (!/^https?:\/\//i.test(v)) return null
  if (!/\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(v)) {
    warnings.push(`в поле «фото» стоит ссылка на страницу, а не на картинку: ${v}`)
    return null
  }
  return v
}

function nearestStation(point, cityId) {
  let best = null
  let bestD = Infinity
  for (const s of stations) {
    if (s.cityId !== cityId) continue
    const d = (s.lat - point.lat) ** 2 + (s.lng - point.lng) ** 2
    if (d < bestD) { bestD = d; best = s }
  }
  return best
}

function answerOf(q, needle) {
  const hit = q.qa.find((x) => x.question.toLowerCase().includes(needle.toLowerCase()))
  return hit ? hit.answer : ''
}

// ── 5. Клиники из списков, по которым анкет ещё нет ────────────────────────
const known = new Set(clinics.map((c) => legalKey(c.legalName)))
const pending = []
for (const [key, entry] of routing) {
  if (known.has(key)) continue
  pending.push({
    legalName: entry.legalName,
    route: [...entry.route],
    avoid: [...entry.avoid],
    cost: entry.cost,
  })
}

// ── 6. Запись ──────────────────────────────────────────────────────────────
writeFileSync(GEO_CACHE_PATH, JSON.stringify(geoCache, null, 2), 'utf8')

const out = {
  _comment: `Импортировано из ${files.map((f) => f.split(/[\\/]/).pop()).join(' + ')} — ${new Date().toISOString()}`,
  clinics,
  clinicMetro,
  clinicServices,
  doctors,
  doctorServices,
  doctorSellingPoints,
  clinicQa,
}
writeFileSync(resolve(ROOT, 'data/imported.json'), JSON.stringify(out, null, 2), 'utf8')

// Собираем рабочий каталог приложения: справочник услуг остаётся наш
// (это наша таксономия, а не данные клиник), всё остальное — из Excel.
// Демо-данные вернуть можно командой npm run seed.
const base = JSON.parse(readFileSync(resolve(ROOT, 'data/catalog.json'), 'utf8'))
writeFileSync(
  resolve(ROOT, 'data/catalog.json'),
  JSON.stringify(
    {
      _comment: out._comment,
      version: new Date().toISOString(),
      services: base.services,
      serviceVariants: base.serviceVariants,
      clinics,
      clinicMetro,
      clinicServices,
      doctors,
      doctorServices,
      doctorSellingPoints,
      clinicQa,
    },
    null,
    2
  ),
  'utf8'
)

writeFileSync(
  resolve(ROOT, 'data/imported-details.json'),
  JSON.stringify({ clinicDetails, pendingClinics: pending }, null, 2),
  'utf8'
)

// ── 7. Отчёт ───────────────────────────────────────────────────────────────
console.log('ИМПОРТ ЗАВЕРШЁН\n')
console.log(`  клиник с анкетой:      ${clinics.length}`)
console.log(`  врачей:                ${doctors.length}`)
console.log(`  тезисов о врачах:      ${doctorSellingPoints.length}`)
console.log(`  услуг в клиниках:      ${clinicServices.length}`)
console.log(`  юрлиц в списках:       ${routing.size}`)
console.log(`  из них без анкеты:     ${pending.length}`)

const missing = {
  'цена по услуге': clinicServices.filter((c) => c.price == null).length,
  'ближайшее свободное окно': clinicServices.filter((c) => !c.nearestSlotDate).length,
  'минуты пешком от метро': clinicMetro.filter((c) => c.walkMinutes == null).length,
  'телефон и часы работы': clinics.filter((c) => !c.phone).length,
  'ответов на общие вопросы': clinicQa.filter((q) => !q.answer).length,
}
console.log('\nЧЕГО НЕ ХВАТАЕТ ДЛЯ РАБОТЫ (в файле этих данных нет):')
for (const [what, count] of Object.entries(missing)) {
  if (count) console.log(`  · ${what}: ${count}`)
}

if (warnings.length) {
  console.log('\nПРЕДУПРЕЖДЕНИЯ:')
  for (const w of [...new Set(warnings)]) console.log('  · ' + w)
}

console.log('\nФайлы: data/imported.json, data/imported-details.json')
