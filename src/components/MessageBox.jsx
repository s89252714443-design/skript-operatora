import { useState, useEffect, useRef } from 'react'
import { lintText } from '../core/lint.js'
import { plural } from '../core/metro.js'

// Готовый текст для пациента. Оператор может править вручную — линтер
// проверяет результат в реальном времени.

export default function MessageBox({ text, tones, tone, onTone, forbiddenPhrases, prepText, skippedPoints, notes, copySignal }) {
  const [draft, setDraft] = useState(text)
  const [copied, setCopied] = useState(null)
  const areaRef = useRef(null)

  // при смене подбора или тональности возвращаемся к сгенерированному тексту
  useEffect(() => setDraft(text), [text])

  const warnings = lintText(draft, forbiddenPhrases)

  const copy = async (value, what) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // запасной путь для окружений без Clipboard API
      areaRef.current?.select()
      document.execCommand('copy')
    }
    setCopied(what)
    setTimeout(() => setCopied(null), 1800)
  }

  // копирование по Enter из любого места экрана
  const draftRef = useRef(draft)
  draftRef.current = draft
  useEffect(() => {
    if (copySignal) copy(draftRef.current, 'msg')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copySignal])

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Готовое сообщение
        </h3>
        <select
          value={tone}
          onChange={(e) => onTone(e.target.value)}
          className="rounded-md border-0 bg-white py-1 pr-7 pl-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-blue-500"
        >
          {tones.map((t) => (
            <option key={t.tone} value={t.tone}>
              {t.toneName}
            </option>
          ))}
        </select>
      </div>

      <textarea
        ref={areaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={12}
        className="w-full resize-y rounded-lg border-0 bg-white p-3 font-sans text-sm leading-relaxed text-slate-800 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-blue-500"
      />

      {warnings.length > 0 && (
        <div className="mt-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-800 ring-1 ring-red-200">
          <div className="mb-1 font-semibold">Так писать нельзя (ФЗ-38 ст. 24):</div>
          <ul className="space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>
                «<span className="font-semibold">{w.phrase}</span>» — {w.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {skippedPoints?.length > 0 && (
        <div className="mt-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 ring-1 ring-amber-200">
          <span className="font-semibold">{skippedPoints.length}</span>{' '}
          {skippedPoints.length === 1
            ? 'тезис не попал в текст — не подтверждён клиникой'
            : `${plural(skippedPoints.length, 'тезис', 'тезиса', 'тезисов')} не попали в текст — не подтверждены клиникой`}
          . Пациенту не называем.
        </div>
      )}

      {notes?.length > 0 && (
        <div className="mt-2 rounded-lg bg-slate-100 p-2.5 text-xs text-slate-600">
          {notes.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => copy(draft, 'msg')}
          className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 active:bg-blue-800"
        >
          {copied === 'msg' ? '✓ Скопировано' : 'Скопировать текст  ⏎'}
        </button>
        {prepText && (
          <button
            onClick={() => copy(prepText, 'prep')}
            className="rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
          >
            {copied === 'prep' ? '✓ Скопировано' : 'Памятка'}
          </button>
        )}
      </div>
    </div>
  )
}
