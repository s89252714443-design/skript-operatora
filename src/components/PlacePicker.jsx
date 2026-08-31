import { useState, useRef, useEffect } from 'react'
import { searchPlaces, KIND_LABEL } from '../core/places.js'
import { geocodeAddress } from '../core/geocode.js'

// Одно поле на всё: адрес, метро, район или улица. Оператор не выбирает тип —
// печатает то, что назвал пациент, а система сама понимает, что это.
//
// Метро, районы и улицы ищутся мгновенно по локальному справочнику.
// Конкретный адрес с домом ищется в геокодере — это единственный способ
// узнать, где пациент реально находится.

const KIND_ICON = { metro: 'М', district: 'Р', street: 'У', address: 'А' }
const KIND_COLOR = {
  metro: 'bg-red-100 text-red-700',
  district: 'bg-emerald-100 text-emerald-700',
  street: 'bg-sky-100 text-sky-700',
  address: 'bg-violet-100 text-violet-700',
}

export default function PlacePicker({ places, cityId, value, onChange, inputRef }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [addresses, setAddresses] = useState([])
  const [geoState, setGeoState] = useState('idle') // idle | loading | error
  const boxRef = useRef(null)
  const localRef = useRef(null)
  const ref = inputRef ?? localRef

  const local = searchPlaces(places, query, cityId)
  const results = [...addresses, ...local]

  // Адрес ищем в геокодере — с задержкой, чтобы не слать запрос на каждую букву
  useEffect(() => {
    const q = query.trim()
    if (q.length < 4) {
      setAddresses([])
      setGeoState('idle')
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setGeoState('loading')
      geocodeAddress(q, cityId, { signal: controller.signal })
        .then((found) => {
          setAddresses(found)
          setGeoState('idle')
        })
        .catch((e) => {
          if (e.name === 'AbortError') return
          setAddresses([])
          setGeoState('error')
        })
    }, 600)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, cityId])

  useEffect(() => {
    const outside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [])

  const choose = (place) => {
    onChange(place)
    setQuery('')
    setAddresses([])
    setOpen(false)
    ref.current?.blur()
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter' && results[cursor]) {
      e.preventDefault()
      choose(results[cursor])
    } else if (e.key === 'Escape') {
      setOpen(false)
      ref.current?.blur()
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <label className="mb-1.5 block text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Где пациенту удобно
      </label>

      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400">
          ⌖
        </span>
        <input
          ref={ref}
          value={open ? query : (value?.name ?? '')}
          onChange={(e) => {
            setQuery(e.target.value)
            setCursor(0)
            setOpen(true)
          }}
          onFocus={() => {
            setQuery('')
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          placeholder="адрес, метро, район или улица"
          className="w-full rounded-lg border-0 bg-white py-2.5 pr-8 pl-9 text-sm font-medium text-slate-900 ring-1 ring-slate-200 outline-none placeholder:font-normal placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500"
        />
        {value && !open && (
          <button
            onClick={() => onChange(null)}
            title="Очистить"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded px-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ×
          </button>
        )}
      </div>

      {/* Подсказка нужна постоянно: по одному выбранному значению не видно,
          что поле принимает не только метро. Тип выбранного значения тут
          не показываем — он уже назван в самой подсказке. */}
      {!open && (
        <p className="mt-1 text-xs text-slate-400">
          ищите по метро, району или точному адресу
        </p>
      )}

      {open && (
        <ul className="absolute z-1000 mt-1 max-h-72 w-full overflow-y-auto rounded-lg bg-white py-1 shadow-lg ring-1 ring-slate-200">
          {results.length === 0 && geoState !== 'loading' && (
            <li className="px-3 py-2.5 text-sm text-slate-400">
              {geoState === 'error'
                ? 'Поиск адреса недоступен. Спросите станцию метро или район.'
                : 'Ничего не нашлось. Попробуйте станцию метро или район.'}
            </li>
          )}
          {geoState === 'loading' && (
            <li className="px-3 py-1.5 text-xs text-slate-400">Ищем адрес…</li>
          )}
          {results.map((p, i) => (
            <li key={p.id}>
              <button
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(p)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${i === cursor ? 'bg-blue-50' : ''}`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold ${KIND_COLOR[p.kind]}`}
                  title={KIND_LABEL[p.kind]}
                >
                  {KIND_ICON[p.kind]}
                </span>
                <span className="truncate text-slate-800" title={p.fullName ?? p.name}>
                  {p.name}
                </span>
                {p.kind === 'metro' && (
                  <span className="ml-auto flex shrink-0 gap-1">
                    {p.lines.map((l) => (
                      <span
                        key={l.id}
                        title={l.name}
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: l.color }}
                      />
                    ))}
                  </span>
                )}
                {p.kind !== 'metro' && (
                  <span className="ml-auto shrink-0 text-xs text-slate-400">
                    {KIND_LABEL[p.kind]}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
