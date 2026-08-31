import { groupQa } from '../core/qa.js'

// Лист «Общие вопросы» из анкеты клиники: седация, подготовка, гистология,
// оборудование, ограничения. Всё открыто и идёт блоками сверху вниз —
// оператор читает это вслух пациенту, ничего раскрывать и искать не нужно.
// Разделы чужой процедуры сюда не попадают, их отсекает filterQaForService.

export default function ClinicQa({ items }) {
  if (!items.length) return null

  return (
    <div className="space-y-3">
      {groupQa(items).map(({ category, rows }) => (
        <section key={category} className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
          <h4 className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800">
            {category}
          </h4>
          <dl>
            {rows.map((row) => (
              <div
                key={`${row.question}-${row.sort}`}
                className="flex gap-4 border-b border-slate-50 px-4 py-2.5 text-sm last:border-b-0"
              >
                <dt className="flex-1 text-slate-500">{row.question}</dt>
                <dd
                  className={
                    row.answer
                      ? 'w-[40%] shrink-0 font-medium text-slate-900'
                      : 'w-[40%] shrink-0 text-amber-600'
                  }
                >
                  {row.answer ?? 'клиника не ответила'}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}
