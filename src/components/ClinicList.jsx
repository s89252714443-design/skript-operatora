import YandexRating from './YandexRating.jsx'
import { formatDistance } from '../core/ranking.js'
import { deriveTags, TAG_STYLE } from '../core/tags.js'

const LABEL_STYLE = {
  'Ближе всего': 'bg-emerald-600 text-white',
}

export default function ClinicList({ rows, labels, ratings, selectedKey, onSelect, onOpen, todayIso }) {
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <ClinicCard
          key={r.key}
          row={r}
          labels={labels[r.key] ?? []}
          rating={ratings?.[r.clinic.id]}
          selected={r.key === selectedKey}
          onSelect={() => onSelect(r.key)}
          onOpen={() => onOpen(r.key)}
          todayIso={todayIso}
        />
      ))}
    </div>
  )
}

function ClinicCard({ row, labels, rating, selected, onSelect, onOpen, todayIso }) {
  const { clinic, clinicService: cs, ownStation: station } = row
  const distance = formatDistance(row.distanceMeters)
  const tags = deriveTags(row, todayIso).slice(0, 5)

  return (
    <div
      id={`clinic-${row.key}`}
      onClick={onSelect}
      className={[
        'cursor-pointer rounded-xl bg-white p-3.5 transition',
        selected ? 'ring-2 shadow-md ring-blue-500' : 'ring-1 ring-slate-200 hover:ring-slate-300',
      ].join(' ')}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        {labels.map((l) => (
          <span
            key={l}
            className={`rounded px-2 py-0.5 text-[11px] font-bold tracking-wide uppercase ${LABEL_STYLE[l] ?? 'bg-slate-400 text-white'}`}
          >
            {l}
          </span>
        ))}
        {row.stationApproximate && (
          <span
            title="Станции из анкеты нет в справочнике метро — привязка приблизительная, проверьте адрес"
            className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700"
          >
            метро под вопросом
          </span>
        )}
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900">{clinic.name}</div>
          {station && (
            <div className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: station.color }} />
              <span className="font-medium text-slate-700">{station.name}</span>
              {distance && (
                <>
                  <span className="text-slate-300">·</span>
                  <span
                    title="Расстояние по прямой от выбранной точки"
                    className="font-semibold text-slate-900"
                  >
                    {distance}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        {rating && (
          <div className="shrink-0 text-right text-sm">
            <YandexRating rating={rating} compact />
          </div>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {tags.map((t, i) => (
          <span
            key={i}
            title={t.kind}
            className={`rounded-md px-2 py-0.5 text-[11px] ring-1 ring-inset ${TAG_STYLE[t.kind]} ${t.strong ? 'font-semibold' : ''}`}
          >
            {t.text}
          </span>
        ))}
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
        className="mt-3 w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
      >
        Подробнее →
      </button>
    </div>
  )
}
