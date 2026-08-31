// Рейтинг клиники с Яндекс.Карт.
//
// Официального способа получить рейтинг нет: API поиска по организациям
// отдаёт адрес, телефоны и часы, но не рейтинг и не отзывы. Поэтому берём
// то, что отдаётся обычным запросом страницы — в <meta og:description>
// Яндекс сам пишет «Рейтинг 4,9. 1564 отзыва».
//
// Что важно помнить:
//  · это не API, а страница: разметка может поменяться в любой день, поэтому
//    скрипт не молчит при неудаче, а пишет, что именно не разобралось;
//  · старое значение при ошибке не затирается — лучше показать вчерашнее
//    число с датой, чем пустое место;
//  · ходим медленно и по одному адресу за раз, клиник всего единицы.
//
// Ссылки на карточки клиник лежат в data/overrides.json → clinicYandex,
// их вставляют сотрудники через админку. Ссылка должна вести на нужный
// филиал: у сетей карточка на каждый адрес своя.
//
// Запуск: npm run ratings

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { plural } from '../src/core/metro.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_PATH = resolve(ROOT, 'public/ratings.json')

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

const PAUSE_MS = 4000

const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Достаёт рейтинг и число отзывов из HTML страницы организации.
 * Возвращает null, если не нашлось — значит разметка изменилась.
 */
export function parseRating(html) {
  // Основной источник: og:description вида
  // «🏆 Обладатель награды «Хорошее место — 2026». ⭐️ Рейтинг 4,6. 534 отзыва»
  const og = html.match(/property="og:description"\s+content="([^"]*)"/i)?.[1] ?? ''
  const ratingFromOg = og.match(/Рейтинг\s+(\d+[.,]\d+)/i)?.[1]
  const reviewsFromOg = og.match(/(\d[\d\s ]*)\s*отзыв/i)?.[1]

  // Награда «Хорошее место» — её Яндекс выдаёт по оценкам пользователей.
  // Берём вместе с годом: «Хорошее место» без года ничего не говорит,
  // а прошлогодняя награда и сегодняшняя — разные вещи.
  const awardMatch = og.match(/«?Хорошее место(?:\s*[—–-]\s*(\d{4}))?»?/i)
  const award = awardMatch
    ? { name: 'Хорошее место', year: awardMatch[1] ? Number(awardMatch[1]) : null }
    : null

  // Запасной источник: те же числа лежат в данных страницы
  const ratingRaw = ratingFromOg ?? html.match(/"ratingValue"\s*:\s*"?([\d.]+)/i)?.[1]
  const reviewsRaw = reviewsFromOg ?? html.match(/"reviewCount"\s*:\s*"?(\d+)/i)?.[1]

  if (!ratingRaw) return null

  const rating = Math.round(Number(String(ratingRaw).replace(',', '.')) * 10) / 10
  const reviews = reviewsRaw ? Number(String(reviewsRaw).replace(/[^\d]/g, '')) : null

  // 4,9 — правдоподобно, 49 или 0 — уже нет: значит разобрали не то
  if (!(rating > 0 && rating <= 5)) return null

  return { rating, reviews: Number.isFinite(reviews) ? reviews : null, award }
}

async function fetchRating(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const html = await res.text()
  if (/showcaptcha|SmartCaptcha/i.test(html)) {
    throw new Error('Яндекс показал капчу — сегодня больше не ходим')
  }

  const parsed = parseRating(html)
  if (!parsed) throw new Error('на странице не нашлось рейтинга (разметка изменилась?)')

  // Яндекс возвращает адрес с хвостом из utm и координат. Обычно карточка
  // лежит прямо в пути (/maps/org/…/id/) — тогда хвост можно срезать.
  // Но короткая ссылка может развернуться в страницу города, где организация
  // указана только в параметрах: срезав их, мы получили бы карту Петербурга
  // вместо клиники. В таком случае оставляем исходную короткую ссылку —
  // она ведёт куда надо.
  const resolved = new URL(res.url)
  const resolvedUrl = resolved.pathname.includes('/org/')
    ? resolved.origin + resolved.pathname
    : url

  return { ...parsed, resolvedUrl }
}

async function main() {
  const catalog = read('data/catalog.json')
  const overrides = read('data/overrides.json')
  const links = overrides.clinicYandex ?? {}

  const previous = existsSync(OUT_PATH) ? JSON.parse(readFileSync(OUT_PATH, 'utf8')) : { items: {} }
  const items = { ...previous.items }

  const clinicName = (id) => catalog.clinics.find((c) => c.id === id)?.name ?? id
  const targets = Object.entries(links).filter(([, url]) => url)

  if (!targets.length) {
    console.log('Ни у одной клиники не указана ссылка на Яндекс.Карты.')
    console.log('Вставьте их в админке (#admin → Клиники → Карточка на Яндекс.Картах).')
    return
  }

  console.log(`Обновляю рейтинги: ${targets.length} ${targets.length === 1 ? 'клиника' : 'клиник'}\n`)

  const failures = []
  for (const [clinicId, url] of targets) {
    const name = clinicName(clinicId)
    try {
      const { rating, reviews, award, resolvedUrl } = await fetchRating(url)
      items[clinicId] = {
        rating,
        reviews,
        award,
        url,
        resolvedUrl,
        checkedAt: new Date().toISOString().slice(0, 10),
      }
      const count =
        reviews == null ? 'отзывы не посчитались' : `${reviews} ${plural(reviews, 'отзыв', 'отзыва', 'отзывов')}`
      const badge = award ? ` · 🏆 ${award.name}${award.year ? ' ' + award.year : ''}` : ''
      console.log(`  ✓ ${name}: ${rating.toFixed(1).replace('.', ',')} · ${count}${badge}`)
    } catch (e) {
      failures.push(`${name}: ${e.message}`)
      const old = items[clinicId]
      console.log(`  ✗ ${name}: ${e.message}${old ? ` (оставил прежнее от ${old.checkedAt})` : ''}`)
    }
    await sleep(PAUSE_MS)
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        _comment:
          'Рейтинги с Яндекс.Карт. Собирает npm run ratings. Файл читается приложением на лету, пересборка не нужна.',
        updatedAt: new Date().toISOString(),
        items,
      },
      null,
      2
    ),
    'utf8'
  )

  console.log(`\nЗаписал public/ratings.json — ${Object.keys(items).length} клиник.`)
  if (failures.length) {
    console.log('\nНе получилось обновить:')
    for (const f of failures) console.log('  · ' + f)
  }
}

// при импорте из тестов main не запускаем
if (process.argv[1] && process.argv[1].endsWith('ratings.js')) {
  main().catch((e) => {
    console.error('Сорвалось:', e.message)
    process.exit(1)
  })
}
