import { useState } from 'react'

// Нижняя панель-шпаргалка: возражения, подготовка, противопоказания.
// Открывается поверх выдачи, не уводя оператора с экрана.

const TABS = [
  { id: 'objections', name: 'Возражения' },
  { id: 'prep', name: 'Подготовка' },
  { id: 'screening', name: 'Противопоказания' },
]

export default function BottomTabs({
  serviceId,
  objections,
  prep,
  contraindications,
  screening,
  onScreening,
  onApplyFilter,
}) {
  const [open, setOpen] = useState(null)

  const blockers = contraindications.filter(
    (c) => c.severity === 'absolute' && screening[key(c)]
  )
  const flagged = contraindications.filter((c) => screening[key(c)]).length

  return (
    <div className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1500px] items-center gap-2 px-4 py-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setOpen(open === t.id ? null : t.id)}
            className={[
              'rounded-lg px-3 py-1.5 text-sm font-medium transition',
              open === t.id
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            ].join(' ')}
          >
            {t.name}
            {t.id === 'screening' && flagged > 0 && (
              <span
                className={`ml-1.5 rounded px-1.5 py-0.5 text-[11px] font-bold ${blockers.length ? 'bg-red-500 text-white' : 'bg-amber-400 text-amber-950'}`}
              >
                {flagged}
              </span>
            )}
          </button>
        ))}

        {blockers.length > 0 && (
          <span className="ml-2 text-sm font-semibold text-red-600">
            ⛔ Есть абсолютное противопоказание — записывать нельзя
          </span>
        )}
      </div>

      {open && (
        <div className="max-h-[45vh] overflow-y-auto border-t border-slate-100 bg-slate-50">
          <div className="mx-auto max-w-[1500px] px-4 py-4">
            {open === 'objections' && <Objections objections={objections} />}
            {open === 'prep' && <Prep prep={prep} />}
            {open === 'screening' && (
              <Screening
                items={contraindications}
                answers={screening}
                onToggle={onScreening}
                onApplyFilter={onApplyFilter}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const key = (c) => `${c.serviceId}|${c.question}`

function Objections({ objections }) {
  const [openId, setOpenId] = useState(objections[0]?.id ?? null)
  return (
    <div className="grid gap-3 md:grid-cols-[220px_1fr]">
      <div className="flex flex-wrap gap-1.5 md:flex-col">
        {objections.map((o) => (
          <button
            key={o.id}
            onClick={() => setOpenId(o.id)}
            className={[
              'rounded-md px-3 py-2 text-left text-sm font-medium transition',
              o.id === openId ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white',
            ].join(' ')}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="rounded-lg bg-white p-4 text-sm leading-relaxed whitespace-pre-line text-slate-700 ring-1 ring-slate-200">
        {objections.find((o) => o.id === openId)?.answer ?? 'Выберите возражение слева'}
      </div>
    </div>
  )
}

function Prep({ prep }) {
  if (!prep) return <p className="text-sm text-slate-500">Для этой услуги памятка не заведена.</p>
  return (
    <div className="rounded-lg bg-white p-4 ring-1 ring-slate-200">
      <h4 className="mb-2 font-semibold text-slate-900">{prep.title}</h4>
      <p className="text-sm leading-relaxed whitespace-pre-line text-slate-700">{prep.body}</p>
    </div>
  )
}

function Screening({ items, answers, onToggle, onApplyFilter }) {
  if (!items.length) {
    return <p className="text-sm text-slate-500">Для этой услуги вопросы не заведены.</p>
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        Задайте эти вопросы до записи — 10 секунд здесь экономят развёрнутого пациента на месте.
      </p>
      {items.map((c) => {
        const checked = !!answers[key(c)]
        return (
          <div
            key={key(c)}
            className={[
              'rounded-lg p-3 ring-1 transition',
              checked
                ? c.severity === 'absolute'
                  ? 'bg-red-50 ring-red-300'
                  : 'bg-amber-50 ring-amber-300'
                : 'bg-white ring-slate-200',
            ].join(' ')}
          >
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(key(c))}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-slate-800">
                {c.question}
                <span
                  className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${c.severity === 'absolute' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}
                >
                  {c.severity === 'absolute' ? 'абсолютное' : 'относительное'}
                </span>
              </span>
            </label>

            {checked && (
              <div className="mt-2 ml-7 text-sm text-slate-700">
                {c.blockText}
                {c.filter && (
                  <button
                    onClick={() => onApplyFilter(c.filter)}
                    className="ml-2 rounded bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white hover:bg-slate-700"
                  >
                    Включить фильтр
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
