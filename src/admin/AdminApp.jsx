import { useState, useMemo, useEffect } from 'react'

import catalogRaw from '../../data/catalog.json'
import contentRaw from '../../data/content.json'
import overridesRaw from '../../data/overrides.json'
import metroData from '../../data/metro.json'

import { applyOverrides, applyContentOverrides, findGaps, EMPTY_OVERRIDES } from '../core/overrides.js'
import { buildGraph } from '../core/metro.js'

const graph = buildGraph(metroData)
const DRAFT_KEY = 'skript-admin-draft'

// Черновик держим в localStorage: сотрудник может закрыть вкладку
// и вернуться, не потеряв час работы.
function loadDraft() {
  try {
    const saved = localStorage.getItem(DRAFT_KEY)
    if (saved) return JSON.parse(saved)
  } catch {
    // повреждённый черновик — не повод падать
  }
  return { ...EMPTY_OVERRIDES, ...overridesRaw }
}

const TABS = [
  { id: 'gaps', name: 'Что заполнить' },
  { id: 'clinics', name: 'Клиники' },
  { id: 'doctors', name: 'Врачи' },
  { id: 'content', name: 'Тексты' },
]

export default function AdminApp() {
  const [tab, setTab] = useState('gaps')
  const [overrides, setOverrides] = useState(loadDraft)
  const [focusId, setFocusId] = useState(null)
  const [saveState, setSaveState] = useState(null) // null | 'saving' | 'saved' | текст ошибки

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(overrides))
    } catch {
      // приватный режим — просто не сохраняем черновик
    }
  }, [overrides])

  const catalog = useMemo(() => applyOverrides(catalogRaw, overrides), [overrides])
  const content = useMemo(() => applyContentOverrides(contentRaw, overrides), [overrides])
  const gaps = useMemo(() => findGaps(catalog), [catalog])

  const editCount = useMemo(
    () =>
      Object.values(overrides)
        .filter((v) => v && typeof v === 'object')
        .reduce((n, group) => n + Object.keys(group).length, 0),
    [overrides]
  )

  const setIn = (group, id, patch) =>
    setOverrides((o) => ({
      ...o,
      [group]: { ...o[group], [id]: { ...(o[group]?.[id] ?? {}), ...patch } },
    }))

  // Некоторые правки — не объект с полями, а одно значение на клинику
  // (ссылка на Яндекс.Карты). Для них отдельный сеттер.
  const setFlat = (group, id, value) =>
    setOverrides((o) => {
      const next = { ...(o[group] ?? {}) }
      if (value) next[id] = value
      else delete next[id]
      return { ...o, [group]: next }
    })

  // Правки уезжают прямо в data/overrides.json — тот же файл, который читает
  // основной экран. Vite увидит запись и перезагрузит страницу сам.
  const save = async () => {
    setSaveState('saving')
    const clean = { ...overrides }
    delete clean._comment
    try {
      const res = await fetch('/api/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clean),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error ?? `сервер ответил ${res.status}`)
      setSaveState('saved')
    } catch (e) {
      // на собранной статике писать некуда — остаётся скачать файл
      setSaveState(e.message)
    }
  }

  useEffect(() => {
    if (saveState !== 'saved') return
    const t = setTimeout(() => setSaveState(null), 2500)
    return () => clearTimeout(t)
  }, [saveState])

  const download = () => {
    const clean = { ...overrides }
    delete clean._comment
    const body = JSON.stringify(
      { _comment: overridesRaw._comment, ...clean },
      null,
      2
    )
    const blob = new Blob([body], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'overrides.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const reset = () => {
    if (!confirm('Сбросить все несохранённые правки?')) return
    setOverrides({ ...EMPTY_OVERRIDES, ...overridesRaw })
  }

  return (
    <div className="flex h-full flex-col bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3">
          <h1 className="text-sm font-bold text-slate-900">Заполнение данных</h1>
          <nav className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={[
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                  tab === t.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                ].join(' ')}
              >
                {t.name}
                {t.id === 'gaps' && gaps.length > 0 && (
                  <span className="ml-1.5 rounded bg-amber-400 px-1.5 py-0.5 text-[11px] font-bold text-amber-950">
                    {gaps.length}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <a href="#" className="text-sm text-slate-500 hover:text-slate-900">
              ← к подбору
            </a>
            {editCount > 0 && (
              <button onClick={reset} className="text-sm text-slate-500 hover:text-red-600">
                сбросить
              </button>
            )}
            <button
              onClick={download}
              title="Файл на случай, когда сохранить на сервер нельзя"
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-300 transition hover:bg-slate-100"
            >
              Скачать файл
            </button>
            <button
              onClick={save}
              disabled={saveState === 'saving'}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
            >
              {saveState === 'saving' ? 'Сохраняю…' : 'Сохранить'}
              {editCount > 0 && <span className="ml-1.5 opacity-80">· {editCount}</span>}
            </button>
          </div>
        </div>
      </header>

      {saveState === 'saved' && (
        <p className="bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          Сохранено в <code>data/overrides.json</code> — правки уже на основном экране.
        </p>
      )}
      {saveState && saveState !== 'saved' && saveState !== 'saving' && (
        <p className="bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Не удалось сохранить на сервер: {saveState}. Так бывает на собранной статике, где
          писать файлы некуда — нажмите «Скачать файл» и положите его в <code>data/</code>.
        </p>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1400px] p-4">
          {tab === 'gaps' && (
            <Gaps
              gaps={gaps}
              onGo={(g) => {
                setTab(g.kind === 'doctor' ? 'doctors' : 'clinics')
                setFocusId(g.kind === 'doctor' ? g.id : g.id.split('|')[0].replace(/__.*$/, ''))
              }}
            />
          )}
          {tab === 'clinics' && (
            <Clinics
              catalog={catalog}
              overrides={overrides}
              setIn={setIn}
              setFlat={setFlat}
              focusId={focusId}
              onFocus={setFocusId}
            />
          )}
          {tab === 'doctors' && (
            <Doctors
              catalog={catalog}
              overrides={overrides}
              setIn={setIn}
              setOverrides={setOverrides}
              focusId={focusId}
              onFocus={setFocusId}
            />
          )}
          {tab === 'content' && <Content content={content} setIn={setIn} />}
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-2 text-xs text-slate-500">
        Правки хранятся в браузере, пока вы их не скачали. Скачанный{' '}
        <code className="rounded bg-slate-100 px-1">overrides.json</code> положите в папку{' '}
        <code className="rounded bg-slate-100 px-1">data/</code> проекта — импорт анкет его не
        затирает.
      </footer>
    </div>
  )
}

// ── Что заполнить ───────────────────────────────────────────────────────────
function Gaps({ gaps, onGo }) {
  const byLabel = {}
  for (const g of gaps) (byLabel[g.label] ??= []).push(g)

  if (!gaps.length) {
    return (
      <div className="rounded-xl bg-white p-6 text-sm text-slate-600 ring-1 ring-slate-200">
        Всё заполнено — пробелов нет.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Чего не хватает, чтобы оператор мог работать. Список считается по текущим данным
        и обновляется сразу, как вы что-то впишете.
      </p>
      {Object.entries(byLabel).map(([label, items]) => (
        <div key={label} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
          <h3 className="mb-2 font-semibold text-slate-900">
            {label} <span className="text-slate-400">· {items.length}</span>
          </h3>
          <ul className="space-y-1 text-sm">
            {items.map((g, i) => (
              <li key={i}>
                <button
                  onClick={() => onGo(g)}
                  className="text-left text-blue-700 hover:underline"
                >
                  {g.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

// ── Клиники ─────────────────────────────────────────────────────────────────
function Clinics({ catalog, overrides, setIn, setFlat, focusId, onFocus }) {
  const selected = catalog.clinics.find((c) => c.id === focusId) ?? catalog.clinics[0]
  if (!selected) return <Empty>Клиник пока нет — сначала импортируйте анкеты.</Empty>

  const metroRows = catalog.clinicMetro.filter((m) => m.clinicId === selected.id)
  const services = catalog.clinicServices.filter((s) => s.clinicId === selected.id)

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <List
        items={catalog.clinics.map((c) => ({ id: c.id, name: c.name, hint: c.address }))}
        selectedId={selected.id}
        onSelect={onFocus}
      />

      <div className="space-y-4">
        <Card title={selected.name} subtitle={selected.legalName}>
          <Row label="Адрес">
            <Text
              value={selected.address ?? ''}
              onChange={(v) => setIn('clinics', selected.id, { address: v })}
            />
          </Row>
          <Row label="Телефон">
            <Text
              value={selected.phone ?? ''}
              placeholder="+7 812 000-00-00"
              onChange={(v) => setIn('clinics', selected.id, { phone: v || null })}
            />
          </Row>
          <Row label="Часы работы">
            <Text
              value={selected.workHours ?? ''}
              placeholder="пн–пт 08:00–20:00, сб 09:00–16:00"
              onChange={(v) => setIn('clinics', selected.id, { workHours: v || null })}
            />
          </Row>
          <Row label="Приоритет">
            <select
              value={selected.priorityTier ?? 'A'}
              onChange={(e) => setIn('clinics', selected.id, { priorityTier: e.target.value })}
              className={inputClass}
            >
              <option value="A">A — приоритетный партнёр</option>
              <option value="B">B — обычная</option>
              <option value="C">C — по остаточному принципу</option>
            </select>
          </Row>
          <Row label="Подходит ВИП-пациенту">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 select-none">
              <input
                type="checkbox"
                checked={!!selected.isVip}
                onChange={(e) => setIn('clinics', selected.id, { isVip: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              показывать при фильтре «ВИП-пациент»
            </label>
          </Row>
          <Row label="Пауза">
            <Text
              value={selected.pausedReason ?? ''}
              placeholder="причина, если временно не берут пациентов"
              onChange={(v) => setIn('clinics', selected.id, { pausedReason: v || null })}
            />
          </Row>
          <Row label="Карточка на Яндекс.Картах">
            <Text
              value={overrides.clinicYandex?.[selected.id] ?? ''}
              placeholder="https://yandex.ru/maps/-/… — ссылка на нужный филиал"
              onChange={(v) => setFlat('clinicYandex', selected.id, v.trim())}
            />
          </Row>
          <Row label="Заметка для оператора">
            <Text
              value={selected.notesInternal ?? ''}
              onChange={(v) => setIn('clinics', selected.id, { notesInternal: v || null })}
            />
          </Row>
        </Card>

        <Card title="Метро">
          {metroRows.length === 0 && <p className="text-sm text-slate-500">Станции не привязаны.</p>}
          {metroRows.map((m) => {
            const node = graph.nodes.get(m.stationId)
            return (
              <Row key={m.stationId} label={node?.name ?? m.stationId}>
                <div className="flex items-center gap-2">
                  <Number
                    value={m.walkMinutes}
                    placeholder="мин"
                    onChange={(v) =>
                      setIn('clinicMetro', `${m.clinicId}|${m.stationId}`, { walkMinutes: v })
                    }
                  />
                  <span className="text-xs text-slate-400">минут пешком до входа</span>
                  {m.approximate && (
                    <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700">
                      привязка приблизительная
                    </span>
                  )}
                </div>
              </Row>
            )
          })}
        </Card>

        <Card title="Услуги и стоимость">
          {services.map((s) => (
            <Row key={s.id} label={s.serviceVariantId}>
              <div className="flex items-center gap-2">
                <Number
                  value={s.avgCaseCost}
                  placeholder="₽"
                  onChange={(v) => setIn('clinicServices', s.id, { avgCaseCost: v })}
                />
                <span className="text-xs text-slate-400">средняя стоимость кейса</span>
              </div>
            </Row>
          ))}
        </Card>
      </div>
    </div>
  )
}

// ── Врачи ───────────────────────────────────────────────────────────────────
function Doctors({ catalog, overrides, setIn, setOverrides, focusId, onFocus }) {
  const selected = catalog.doctors.find((d) => d.id === focusId) ?? catalog.doctors[0]
  if (!selected) return <Empty>Врачей пока нет — сначала импортируйте анкеты.</Empty>

  const clinic = catalog.clinics.find((c) => c.id === selected.clinicId)
  const points = catalog.doctorSellingPoints.filter((p) => p.doctorId === selected.id)

  const setPoints = (next) =>
    setOverrides((o) => ({ ...o, sellingPoints: { ...o.sellingPoints, [selected.id]: next } }))

  const editable = points.map((p) => ({ text: p.text, type: p.type, confidence: p.confidence }))

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <List
        items={catalog.doctors.map((d) => ({
          id: d.id,
          name: d.fullName,
          hint: catalog.clinics.find((c) => c.id === d.clinicId)?.name,
        }))}
        selectedId={selected.id}
        onSelect={onFocus}
      />

      <div className="space-y-4">
        <Card title={selected.fullName} subtitle={clinic?.name}>
          <Row label="Специальность">
            <Text
              value={selected.specialty ?? ''}
              onChange={(v) => setIn('doctors', selected.id, { specialty: v })}
            />
          </Row>
          <Row label="Стаж, лет">
            <Number
              value={selected.experienceYears}
              onChange={(v) => setIn('doctors', selected.id, { experienceYears: v })}
            />
          </Row>
          <Row label="Категория">
            <select
              value={selected.category ?? ''}
              onChange={(e) =>
                setIn('doctors', selected.id, { category: e.target.value || null })
              }
              className={inputClass}
            >
              <option value="">нет</option>
              <option value="высшая">высшая</option>
              <option value="первая">первая</option>
              <option value="вторая">вторая</option>
            </select>
          </Row>
          <Row label="Учёная степень">
            <select
              value={selected.degree ?? ''}
              onChange={(e) => setIn('doctors', selected.id, { degree: e.target.value || null })}
              className={inputClass}
            >
              <option value="">нет</option>
              <option value="к.м.н.">к.м.н.</option>
              <option value="д.м.н.">д.м.н.</option>
            </select>
          </Row>
          <Row label="Фото, ссылка">
            <Text
              value={selected.photoUrl ?? ''}
              placeholder="https://…"
              onChange={(v) => setIn('doctors', selected.id, { photoUrl: v || null })}
            />
          </Row>
          <Row label="Данные подтверждены клиникой">
            <select
              value={selected.confidence ?? 'unverified'}
              onChange={(e) => setIn('doctors', selected.id, { confidence: e.target.value })}
              className={inputClass}
            >
              <option value="confirmed">да — можно называть пациенту</option>
              <option value="unverified">нет — только для оператора</option>
            </select>
          </Row>
          <Row label="Подходит тревожным">
            <input
              type="checkbox"
              checked={!!selected.forAnxious}
              onChange={(e) => setIn('doctors', selected.id, { forAnxious: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />
          </Row>
        </Card>

        <Card
          title="Тезисы для сообщения"
          subtitle="В текст пациенту попадают только подтверждённые"
        >
          {editable.map((p, i) => (
            <div key={i} className="mb-2 flex items-start gap-2">
              <textarea
                value={p.text}
                rows={2}
                onChange={(e) => {
                  const next = [...editable]
                  next[i] = { ...next[i], text: e.target.value }
                  setPoints(next)
                }}
                className={inputClass + ' flex-1'}
              />
              <select
                value={p.confidence}
                onChange={(e) => {
                  const next = [...editable]
                  next[i] = { ...next[i], confidence: e.target.value }
                  setPoints(next)
                }}
                className="rounded-lg border-0 bg-white px-2 py-1.5 text-xs ring-1 ring-slate-200"
              >
                <option value="confirmed">подтверждён</option>
                <option value="unverified">не подтверждён</option>
              </select>
              <button
                onClick={() => setPoints(editable.filter((_, j) => j !== i))}
                className="rounded px-2 py-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                title="Удалить"
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              setPoints([...editable, { text: '', type: 'подход', confidence: 'confirmed' }])
            }
            className="mt-1 rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200"
          >
            + тезис
          </button>
        </Card>
      </div>
    </div>
  )
}

// ── Тексты ──────────────────────────────────────────────────────────────────
const CONTENT_SECTIONS = [
  { key: 'messageTemplates', name: 'Шаблоны сообщений', main: 'body', title: (x) => x.toneName },
  { key: 'objections', name: 'Возражения', main: 'answer', title: (x) => x.label },
  { key: 'prepInstructions', name: 'Памятки по подготовке', main: 'body', title: (x) => x.title },
  {
    key: 'contraindications',
    name: 'Противопоказания',
    main: 'blockText',
    title: (x) => x.question,
  },
]

function Content({ content, setIn }) {
  const [section, setSection] = useState('messageTemplates')
  const cfg = CONTENT_SECTIONS.find((s) => s.key === section)
  const items = content[section] ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {CONTENT_SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={[
              'rounded-lg px-3 py-1.5 text-sm font-medium transition',
              section === s.key
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50',
            ].join(' ')}
          >
            {s.name}
          </button>
        ))}
      </div>

      {items.map((item, i) => (
        <Card key={item.id ?? i} title={cfg.title(item) || `Запись ${i + 1}`}>
          {!item.id && (
            <p className="mb-2 text-xs text-amber-600">
              У записи нет id — правка не сохранится. Добавьте id в data/content.json.
            </p>
          )}
          <textarea
            value={item[cfg.main] ?? ''}
            rows={cfg.key === 'messageTemplates' || cfg.key === 'prepInstructions' ? 8 : 3}
            disabled={!item.id}
            onChange={(e) => setIn('content', section, { [item.id]: { [cfg.main]: e.target.value } })}
            className={inputClass + ' font-sans leading-relaxed disabled:bg-slate-50'}
          />
        </Card>
      ))}
    </div>
  )
}

// ── Мелочи ──────────────────────────────────────────────────────────────────
const inputClass =
  'w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-blue-500'

function List({ items, selectedId, onSelect }) {
  return (
    <div className="max-h-[70vh] overflow-y-auto rounded-xl bg-white p-2 ring-1 ring-slate-200">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onSelect(it.id)}
          className={[
            'mb-1 w-full rounded-lg px-3 py-2 text-left text-sm transition',
            it.id === selectedId ? 'bg-slate-900 text-white' : 'hover:bg-slate-100',
          ].join(' ')}
        >
          <div className="font-medium">{it.name}</div>
          {it.hint && (
            <div className={it.id === selectedId ? 'text-xs text-slate-300' : 'text-xs text-slate-400'}>
              {it.hint}
            </div>
          )}
        </button>
      ))}
    </div>
  )
}

function Card({ title, subtitle, children }) {
  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="mb-3 text-xs text-slate-500">{subtitle}</p>}
      <div className={subtitle ? '' : 'mt-3'}>{children}</div>
    </section>
  )
}

function Row({ label, children }) {
  return (
    <div className="mb-3 grid gap-1.5 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-center">
      <label className="text-sm text-slate-500">{label}</label>
      {children}
    </div>
  )
}

function Text({ value, onChange, placeholder }) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
    />
  )
}

function Number_({ value, onChange, placeholder }) {
  return (
    <input
      type="number"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === '' ? null : globalThis.Number(e.target.value))}
      className={inputClass + ' max-w-[140px]'}
    />
  )
}
const Number = Number_

function Empty({ children }) {
  return (
    <div className="rounded-xl bg-white p-6 text-sm text-slate-600 ring-1 ring-slate-200">
      {children}
    </div>
  )
}
