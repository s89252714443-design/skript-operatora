import { plural } from '../core/metro.js'

// Рейтинг клиники с Яндекс.Карт — рядом с названием филиала, потому что это
// первое, чем оператор отвечает на «а клиника нормальная?».
//
// Это чужое число, снятое в известный день, поэтому рядом всегда стоит дата
// и ссылка на карточку: оператор должен видеть, откуда оно и не протухло ли,
// прежде чем называть его пациенту.
const STALE_DAYS = 3

export default function YandexRating({ rating, compact }) {
  if (!rating?.rating) return null

  // считаем в календарных днях: снятое сегодня утром число — «сегодня»,
  // а не «1 день назад» из-за часов
  const today = new Date().toISOString().slice(0, 10)
  const days = Math.round((Date.parse(today) - Date.parse(rating.checkedAt)) / 86400000)
  const stale = days > STALE_DAYS

  // Яндекс пишет «5,0», а не «5» — показываем так же, иначе оператор
  // и пациент видят разные числа
  const value = rating.rating.toFixed(1).replace('.', ',')
  const checked = `проверено ${formatDay(rating.checkedAt)}`

  // В списке места мало: только звезда, число и количество отзывов. Ссылку
  // здесь не даём — карточка целиком кликабельная, и переход на Яндекс
  // перебивал бы выбор клиники. Дату показываем, только если она устарела:
  // свежее число оператор увидит с датой, когда откроет карточку.
  if (compact) {
    return (
      <span
        title={`Рейтинг на Яндекс.Картах, ${checked}`}
        className="inline-flex items-baseline gap-1 whitespace-nowrap"
      >
        <span className="text-amber-500">★</span>
        <span className="font-bold text-slate-900">{value}</span>
        {rating.reviews != null && (
          <span className="text-xs text-slate-400">{rating.reviews}</span>
        )}
        {rating.award && (
          <span title={awardTitle(rating.award)} className="text-amber-500">
            🏆
          </span>
        )}
        {stale && (
          <span className="text-xs text-amber-600">· {formatDay(rating.checkedAt)}</span>
        )}
      </span>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
    <a
      href={rating.resolvedUrl ?? rating.url}
      target="_blank"
      rel="noreferrer"
      title="Открыть карточку клиники на Яндекс.Картах"
      className="inline-flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-1.5 ring-1 ring-amber-200 transition hover:bg-amber-100"
    >
      <span className="text-xl leading-none text-amber-500">★</span>
      <span className="text-2xl leading-none font-bold text-slate-900">
        {value}
      </span>
      <span className="text-xs leading-tight font-normal text-slate-500">
        {rating.reviews != null && (
          <>
            {rating.reviews} {plural(rating.reviews, 'отзыв', 'отзыва', 'отзывов')}
            <br />
          </>
        )}
        на Яндекс.Картах
      </span>
      <span
        className={`self-end text-[11px] font-normal ${stale ? 'text-amber-700' : 'text-slate-400'}`}
        title="Когда мы в последний раз смотрели это число"
      >
        {days <= 0 ? 'сегодня' : `${days} ${plural(days, 'день', 'дня', 'дней')} назад`}
      </span>
    </a>

    {/* Награду Яндекс присуждает по оценкам пользователей — это его слова,
        не наши, поэтому она и живёт рядом с рейтингом и той же датой */}
    {rating.award && (
      <span
        title={awardTitle(rating.award)}
        className="inline-flex items-center gap-1.5 rounded-xl bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-900 ring-1 ring-amber-300"
      >
        <span className="text-base leading-none">🏆</span>
        {rating.award.name}
        {rating.award.year && <span className="font-normal">{rating.award.year}</span>}
      </span>
    )}
    </span>
  )
}

// «Награда Яндекс.Карт «Хорошее место 2026», проверено 29.08»
function awardTitle(award) {
  return `Награда Яндекс.Карт «${award.name}${award.year ? ' ' + award.year : ''}»`
}

// «29.08» — короткая дата для тесной карточки
function formatDay(iso) {
  const [, month, day] = iso.split('-')
  return `${day}.${month}`
}
