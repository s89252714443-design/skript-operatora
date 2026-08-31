// Сборка текста сообщения для пациента из шаблона и данных подобранного варианта.
//
// Главное правило: в текст попадают ТОЛЬКО тезисы со статусом confirmed
// (подтверждённые клиникой). Непроверенное остаётся на экране оператора.
//
// Цены в сообщении нет вовсе. Средняя стоимость кейса — внутренний показатель
// по юрлицу, а не цена услуги: назвав её, мы пообещали бы сумму, которую
// пациент на месте не увидит. Стоимость оператор говорит отдельно, когда
// узнает её у клиники.

import { plural } from './metro.js'
import { isAboutOtherProcedure } from './service.js'

const MAX_POINTS = 3

// Рейтинг с Яндекс.Карт живёт в сообщении, только пока он свежий. Число
// месячной давности пациент откроет и увидит другое — лучше не называть.
const RATING_MAX_AGE_DAYS = 30

export function formatMoney(n) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' ₽'
}

export function formatSlot(dateIso, todayIso) {
  const days = Math.round(
    (new Date(dateIso + 'T00:00:00') - new Date(todayIso + 'T00:00:00')) / 86400000
  )
  if (days <= 0) return 'сегодня'
  if (days === 1) return 'завтра'
  if (days === 2) return 'послезавтра'
  const d = new Date(dateIso + 'T00:00:00')
  const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' }).format(d)
  const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(d)
  return `${weekday}, ${date}`
}

export function formatSlotShort(dateIso, todayIso) {
  const s = formatSlot(dateIso, todayIso)
  return s.length > 14 ? s.split(',')[0] : s
}

// «высшая» → «высшей категории»: в тексте нужен родительный падеж
const CATEGORY_GENITIVE = { высшая: 'высшей', первая: 'первой', вторая: 'второй' }

function doctorShortLine(doctor) {
  const parts = []
  if (doctor.experienceYears) {
    parts.push(`${doctor.experienceYears} ${plural(doctor.experienceYears, 'год', 'года', 'лет')} практики`)
  }
  if (doctor.category) {
    parts.push(`врач ${CATEGORY_GENITIVE[doctor.category] ?? doctor.category} категории`)
  }
  if (doctor.degree) parts.push(doctor.degree)
  return parts.join(', ')
}

// «Колоноскопия во сне (седация)» → «Колоноскопия во сне»:
// скобки в живом сообщении читаются как канцелярит
function variantPhrase(name) {
  return name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

function equipmentLine(cs) {
  if (!cs.equipmentModel) return ''
  const parts = [`Томограф ${cs.equipmentModel}`]
  if (cs.tesla) parts.push(`${String(cs.tesla).replace('.', ',')} Тесла`)
  if (cs.mriType === 'open') parts.push('открытого типа — без замкнутой трубы')
  else if (cs.mriType === 'closed') parts.push('закрытый контур')
  if (cs.maxWeightKg) parts.push(`стол выдерживает до ${cs.maxWeightKg} кг`)
  return parts.join(', ') + '.'
}

function reportLine(cs) {
  if (!cs.reportHours) return ''
  if (cs.reportHours <= 2) {
    return `Заключение отдают в течение ${cs.reportHours} ${plural(cs.reportHours, 'часа', 'часов', 'часов')}, снимки записывают на диск — второй раз ехать не придётся.`
  }
  if (cs.reportHours <= 24) return 'Заключение готово на следующий день, снимки записывают на диск.'
  return `Заключение готовят до ${Math.round(cs.reportHours / 24)} дней.`
}

function sedationLine(cs, variant) {
  if (variant.isSedation || (cs.hasSedation && cs.hasAnesthesiologist)) {
    return 'Процедура проходит в медикаментозном сне под контролем анестезиолога — вы ничего не почувствуете и проснётесь, когда всё уже закончится.'
  }
  return ''
}

// Рейтинг клиники одной строкой. Звезда читается в любом мессенджере
// и отбивает строку от остального текста лучше, чем слово «рейтинг».
// Ничего не приукрашиваем: число и источник, пациент может проверить сам.
function ratingLine(rating, todayIso) {
  if (!rating?.rating) return { line: '', note: null }

  const age = Math.round((Date.parse(todayIso) - Date.parse(rating.checkedAt)) / 86400000)
  if (age > RATING_MAX_AGE_DAYS) {
    return {
      line: '',
      note: `Рейтинг с Яндекс.Карт не вставлен в текст: он снят ${age} ${plural(age, 'день', 'дня', 'дней')} назад. Обновите — npm run ratings.`,
    }
  }

  const value = rating.rating.toFixed(1).replace('.', ',')
  const reviews =
    rating.reviews != null
      ? ` — ${rating.reviews} ${plural(rating.reviews, 'отзыв', 'отзыва', 'отзывов')}`
      : ''
  return { line: `★ ${value} на Яндекс.Картах${reviews}`, note: null }
}

/**
 * Возвращает { text, usedPoints, skippedPoints } — второе и третье нужны,
 * чтобы показать оператору, что именно не попало в текст и почему.
 */
export function buildMessage({ option, template, graph, todayIso, doctor, rating }) {
  const { clinic, clinicService: cs, variant } = option
  const chosen = doctor ?? option.doctors?.[0] ?? null

  const all = chosen?.sellingPoints ?? []
  const skipped = all.filter((p) => p.confidence !== 'confirmed')

  // У эндоскописта тезисы сразу про обе процедуры. Пациенту, который пришёл
  // за колоноскопией, «2000 гастроскопий в год» не говорит ничего — берём
  // только то, что про его исследование или про врача вообще.
  const confirmed = all.filter(
    (p) => p.confidence === 'confirmed' && !isAboutOtherProcedure(p.text, option.service.id)
  )
  const used = confirmed.slice(0, MAX_POINTS)

  // Если тезис врача уже говорит про сон и анестезиолога — не повторяем то же
  // самое отдельной строкой, иначе сообщение выглядит сгенерированным.
  const pointsCoverSedation = used.some((p) => /сне|седац|анестезиолог/i.test(p.text))

  const shortLine = chosen && chosen.confidence === 'confirmed' ? doctorShortLine(chosen) : ''

  const { line: ratingText, note: ratingNote } = ratingLine(rating, todayIso)

  const vars = {
    // не оборачиваем повторно, если название уже в кавычках
    clinicName: /^[«"']/.test(clinic.name) ? clinic.name : `«${clinic.name}»`,
    opener:
      option.service.model === 'doctor'
        ? 'Подобрали для вас вариант'
        : 'Подобрали для вас центр',
    // называем станцию, но не время и не расстояние: пациенту важен ориентир,
    // а расстояние по прямой он всё равно не пройдёт напрямую
    walkPhrase: option.ownStation ? `рядом с метро ${option.ownStation.name}` : clinic.address,
    variantName: variantPhrase(variant.name),
    doctorName: chosen?.fullName ?? '',
    // Регалии называем пациенту только если карточка врача подтверждена клиникой
    doctorShort: shortLine,
    doctorShortClause: shortLine ? `, ${shortLine}` : '',
    points: used.map((p) => p.text).join(', '),
    // Если подтверждённых тезисов нет — не оставляем висячее двоеточие
    // и вообще ничего не заявляем о враче, кроме имени.
    pointsClause: used.length ? `: ${used.map((p) => p.text).join(', ')}` : '',
    slot: cs.nearestSlotDate ? formatSlot(cs.nearestSlotDate, todayIso) : '[ОКНО УТОЧНИТЬ]',
    sedationLine: pointsCoverSedation ? '' : sedationLine(cs, variant),
    equipmentLine: equipmentLine(cs),
    reportLine: reportLine(cs),
    // с переводом строки внутри: если рейтинга нет, пустой строки в тексте
    // тоже не остаётся
    ratingClause: ratingText ? `
${ratingText}` : '',
    prepNote: option.service.id === 'colono' || option.service.id === 'gastro'
      ? ' Памятку по подготовке пришлю сразу после записи.'
      : '',
  }

  let text = template.body.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')
  // убираем пустые строки, оставшиеся от незаполненных плейсхолдеров
  text = text
    .split('\n')
    .filter((line, i, arr) => line.trim() !== '' || (arr[i - 1]?.trim() !== '' && i !== 0))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return {
    text,
    usedPoints: used,
    skippedPoints: skipped,
    doctor: chosen,
    notes: ratingNote ? [ratingNote] : [],
  }
}
