import { useState, useMemo, useEffect, useRef, useCallback } from 'react'

import metroData from '../data/metro.json'
import placesData from '../data/places.json'
import catalogRaw from '../data/catalog.json'
import contentRaw from '../data/content.json'
import overrides from '../data/overrides.json'

import { assetUrl } from './core/assets.js'
import { buildGraph } from './core/metro.js'
import { applyOverrides, applyContentOverrides } from './core/overrides.js'
import { buildPlaces, resolveOrigin, originSummary, knowsPatientLocation } from './core/places.js'
import { findOptions, deriveLabels, formatDistance } from './core/ranking.js'
import { buildMessage } from './core/message.js'

import Sidebar from './components/Sidebar.jsx'
import MapView from './components/MapView.jsx'
import ClinicList from './components/ClinicList.jsx'
import ClinicDetail from './components/ClinicDetail.jsx'
import Modal from './components/Modal.jsx'
import MessageBox from './components/MessageBox.jsx'
import YandexRating from './components/YandexRating.jsx'
import BottomTabs from './components/BottomTabs.jsx'

// Ручные правки сотрудников лежат отдельным файлом и накладываются поверх
// импортированного каталога — так повторный импорт анкет их не затирает.
const catalog = applyOverrides(catalogRaw, overrides)
const content = applyContentOverrides(contentRaw, overrides)

const graph = buildGraph(metroData)
const places = buildPlaces(graph, placesData, catalog)
const todayIso = new Date().toISOString().slice(0, 10)

const findPlace = (id) => places.find((p) => p.id === id) ?? null

// Сколько клиник вообще отмечено как ВИП — нужно, чтобы отличить «под этот
// подбор не нашлось» от «отметку ещё никто не проставил».
const vipMarked = catalog.clinics.filter((c) => c.isVip).length

const ENDO_SERVICES = ['colono', 'gastro']

// Для эндоскопии подвид не выбирают руками: он однозначно следует из того,
// нужна ли седация. Держать его отдельным состоянием — значит рисковать
// рассинхроном между фильтром и выбранным вариантом.
function endoVariantId(serviceId, needSedation) {
  const pool = catalog.serviceVariants.filter((v) => v.serviceId === serviceId)
  const matching = pool.filter((v) => Boolean(v.isSedation) === Boolean(needSedation))
  return (matching.find((v) => v.isPopular) ?? matching[0] ?? pool[0])?.id ?? null
}

export default function App() {
  const [cityId, setCityId] = useState('msk')
  const [serviceId, setServiceId] = useState('colono')
  const [variantId, setVariantId] = useState('colono-sed')
  const [variantQuery, setVariantQuery] = useState('')
  const [place, setPlace] = useState(() => findPlace('m-msk|Автозаводская'))
  const [filters, setFilters] = useState({})
  const [selectedKey, setSelectedKey] = useState(null)
  const [openKey, setOpenKey] = useState(null) // «провалились внутрь клиники»
  const [doctorId, setDoctorId] = useState(null)
  const [tone, setTone] = useState('calm')
  const [screening, setScreening] = useState({})
  const [copySignal, setCopySignal] = useState(0)
  const [ratings, setRatings] = useState({})

  // Рейтинги с Яндекс.Карт лежат отдельным файлом, его раз в сутки обновляет
  // npm run ratings. Читаем на лету: пересобирать приложение ради числа не надо.
  useEffect(() => {
    fetch(assetUrl('/ratings.json'))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data?.items && setRatings(data.items))
      .catch(() => {}) // файла может не быть — это не повод ломать экран
  }, [])

  const variantInputRef = useRef(null)
  const placeInputRef = useRef(null)
  const listRef = useRef(null)

  const service = catalog.services.find((s) => s.id === serviceId)
  const isEndo = ENDO_SERVICES.includes(serviceId)

  // то, по чему реально идёт подбор
  const activeVariantId = isEndo ? endoVariantId(serviceId, filters.needSedation) : variantId

  // ── подбор ───────────────────────────────────────────────────────────────
  const origin = useMemo(() => resolveOrigin(place, graph), [place])
  const { rows, rejected } = useMemo(
    () =>
      findOptions({
        catalog, origin, graph, cityId, variantId: activeVariantId, filters, todayIso,
      }),
    [origin, cityId, activeVariantId, filters]
  )

  // Ярлыки-подсказки для карточек. В списке и на карте показываем
  // все подходящие клиники, ярлыки лишь расставляют акценты.
  const labels = useMemo(() => deriveLabels(rows), [rows])

  const selected = rows.find((r) => r.key === selectedKey) ?? rows[0] ?? null
  const opened = rows.find((r) => r.key === openKey) ?? null

  // если открытая клиника выпала из выдачи — возвращаемся к списку
  useEffect(() => {
    if (openKey && !rows.some((r) => r.key === openKey)) setOpenKey(null)
  }, [rows, openKey])

  // клик по точке на карте — подсвечиваем карточку и подкручиваем к ней список
  const selectFromMap = useCallback((key) => {
    setSelectedKey(key)
    const el = document.getElementById(`clinic-${key}`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  const openClinic = useCallback((key) => {
    setSelectedKey(key)
    setOpenKey(key)
    setDoctorId(null)
    listRef.current?.scrollTo({ top: 0 })
  }, [])

  // ── сообщение ────────────────────────────────────────────────────────────
  const tones = useMemo(
    () => content.messageTemplates.filter((t) => t.model === service.model),
    [service.model]
  )
  const template = tones.find((t) => t.tone === tone) ?? tones[0]

  const message = useMemo(() => {
    if (!opened || !template) return null
    // Для тревожного пациента по умолчанию берём врача, которого клиника
    // сама отметила как подходящего для таких случаев.
    const fallback =
      (template.tone === 'anxious' && opened.doctors?.find((d) => d.forAnxious)) ||
      opened.doctors?.[0]
    const doctor = opened.doctors?.find((d) => d.id === doctorId) ?? fallback
    return buildMessage({
      option: opened,
      template,
      graph,
      todayIso,
      doctor,
      rating: ratings[opened.clinic.id],
    })
  }, [opened, template, doctorId, ratings])

  // Ответы клиники на общий лист анкеты — показываем в окне клиники
  const openedQa = useMemo(
    () => (catalog.clinicQa ?? []).filter((q) => q.clinicId === opened?.clinic.id),
    [opened]
  )

  const openedPhotos = useMemo(
    () => (catalog.clinicPhotos ?? []).filter((p) => p.clinicId === opened?.clinic.id),
    [opened]
  )

  const prep = content.prepInstructions.find((p) => p.serviceId === serviceId)
  const objections = content.objections.filter(
    (o) => o.serviceId === null || o.serviceId === serviceId
  )
  const contraindications = content.contraindications.filter((c) => c.serviceId === serviceId)

  // ── переключения ─────────────────────────────────────────────────────────
  const changeService = useCallback((id) => {
    setServiceId(id)
    setVariantQuery('')
    setScreening({})
    setOpenKey(null)
    const first =
      catalog.serviceVariants.find((v) => v.serviceId === id && v.isPopular) ??
      catalog.serviceVariants.find((v) => v.serviceId === id)
    setVariantId(first?.id ?? null)
  }, [])

  const changeCity = (id) => {
    setCityId(id)
    setPlace(null)
    setOpenKey(null)
  }

  const applyFilter = (name) => {
    if (name === 'openMri') setFilters((f) => ({ ...f, claustrophobia: true }))
    if (name === 'heavy') setFilters((f) => ({ ...f, patientWeight: f.patientWeight || 130 }))
    if (name === 'anesth') setFilters((f) => ({ ...f, needSedation: true }))
  }

  // ── горячие клавиши ──────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)
      if (e.key === '/' && !inField) {
        e.preventDefault()
        placeInputRef.current?.focus()
        return
      }
      if (e.key === 'Escape' && !inField && openKey) {
        setOpenKey(null)
        return
      }
      if (e.key === 'Enter' && !inField) {
        e.preventDefault()
        if (openKey) setCopySignal((n) => n + 1)
        else if (selected) openClinic(selected.key)
        return
      }
      if (inField) return
      const byHotkey = catalog.services.find((s) => s.hotkey === e.key)
      if (byHotkey) {
        e.preventDefault()
        changeService(byHotkey.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [changeService, openKey, selected, openClinic])

  const blocked = contraindications.some(
    (c) => c.severity === 'absolute' && screening[`${c.serviceId}|${c.question}`]
  )

  return (
    <div className="flex h-full flex-col">
      <main className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto grid h-full max-w-[1800px] gap-4 p-4 xl:grid-cols-[280px_minmax(0,1fr)_420px] lg:grid-cols-[260px_minmax(0,1fr)] md:grid-cols-[240px_minmax(0,1fr)] grid-cols-1">
          <Sidebar
            catalog={catalog}
            cities={metroData.cities}
            serviceId={serviceId}
            onService={changeService}
            cityId={cityId}
            onCity={changeCity}
            variantId={variantId}
            onVariant={(id) => {
              setVariantId(id)
              setOpenKey(null)
            }}
            variantQuery={variantQuery}
            onVariantQuery={setVariantQuery}
            places={places}
            place={place}
            onPlace={(p) => {
              setPlace(p)
              setOpenKey(null)
            }}
            filters={filters}
            onFilters={setFilters}
            placeInputRef={placeInputRef}
          />

          <section className="min-h-[300px]">
            {place ? (
              <MapView
                rows={rows}
                origin={origin}
                cityId={cityId}
                selectedKey={selected?.key ?? null}
                onSelect={selectFromMap}
                onOpen={openClinic}
              />
            ) : (
              <div className="flex h-full items-center justify-center rounded-xl bg-white text-center ring-1 ring-slate-200">
                <p className="max-w-sm text-sm text-slate-500">
                  Спросите у пациента, где ему удобно — адрес, станция метро, район или улица.
                  <br />
                  Введите это слева, и клиники появятся на карте.
                </p>
              </div>
            )}
          </section>

          <aside
            ref={listRef}
            className="min-h-0 overflow-y-auto rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-200"
          >
            {blocked && (
              <div className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
                <div className="font-semibold">Абсолютное противопоказание</div>
                Записывать нельзя. Вкладка «Противопоказания» внизу — там что предложить взамен.
              </div>
            )}

            {
              <>
                <div className="mb-2.5">
                  <h2 className="text-sm font-semibold text-slate-900">
                    {place ? `Подошло клиник: ${rows.length}` : 'Клиники'}
                  </h2>
                  {origin && (
                    <p className="mt-0.5 text-xs text-slate-500">
                      Считаем от: {originSummary(origin)}
                      {origin.entry && (
                        <span className="text-slate-400"> · ближайшее метро {origin.entry.name}</span>
                      )}
                    </p>
                  )}
                  {origin && !knowsPatientLocation(origin) && (
                    <p className="mt-1 text-xs text-amber-600">
                      Где пациент сейчас — неизвестно. Введите адрес, если нужен подбор от точного места.
                    </p>
                  )}
                </div>

                {place && rows.length === 0 && (
                  <p className="rounded-lg bg-white p-4 text-sm text-slate-500 ring-1 ring-slate-200">
                    {/* Пустой список из-за ВИП-фильтра — это чаще всего не «нет клиник»,
                        а «никто ещё не отметил, кого можно предлагать ВИПу» */}
                    {filters.vipOnly && vipMarked === 0 ? (
                      <>
                        Ни одна клиника пока не отмечена как подходящая ВИП-пациенту. Кого
                        предлагать — решает отдел: отметьте клиники в админке (адрес{' '}
                        <code className="rounded bg-slate-100 px-1">#admin</code> → Клиники →
                        «Подходит ВИП-пациенту»).
                      </>
                    ) : (
                      <>
                        Под эти условия ничего не подошло. Снимите фильтр или выберите другой
                        подвид услуги.
                      </>
                    )}
                  </p>
                )}

                <ClinicList
                  rows={rows}
                  labels={labels}
                  ratings={ratings}
                  selectedKey={selected?.key ?? null}
                  onSelect={setSelectedKey}
                  onOpen={openClinic}
                  todayIso={todayIso}
                />

                {rejected.length > 0 && (
                  <details className="mt-3 text-xs text-slate-500">
                    <summary className="cursor-pointer hover:text-slate-700">
                      Отсеяно клиник: {rejected.length}
                    </summary>
                    <ul className="mt-1.5 space-y-0.5 pl-4">
                      {rejected.map((r, i) => (
                        <li key={i}>
                          {r.clinic.name} — {r.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            }
          </aside>
        </div>
      </main>

      <Modal
        open={Boolean(opened)}
        onClose={() => setOpenKey(null)}
        title={
          opened && (
            <>
              <span>{opened.clinic.name}</span>
              <YandexRating rating={ratings[opened.clinic.id]} />
            </>
          )
        }
        subtitle={
          opened && (
            <div className="mt-1 space-y-0.5 text-sm text-slate-500">
              <p>{opened.clinic.address}</p>
              <p className="flex flex-wrap items-center gap-1.5 text-slate-600">
                {opened.ownStation && (
                  <>
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: opened.ownStation.color }}
                    />
                    <span className="font-semibold">метро {opened.ownStation.name}</span>
                  </>
                )}
                {opened.distanceMeters != null && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span title="Расстояние по прямой от выбранной точки">
                      {formatDistance(opened.distanceMeters)} по прямой
                    </span>
                  </>
                )}
              </p>
              {(opened.clinic.workHours || opened.clinic.phone) && (
                <p>
                  {[opened.clinic.workHours, opened.clinic.phone].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          )
        }
      >
        {opened && (
          <ClinicDetail
            option={opened}
            todayIso={todayIso}
            doctorId={doctorId}
            onDoctor={setDoctorId}
            qa={openedQa}
            photos={openedPhotos}
          >
            {message && (
              <MessageBox
                text={message.text}
                tones={tones}
                tone={template.tone}
                onTone={setTone}
                forbiddenPhrases={content.forbiddenPhrases}
                prepText={prep ? `${prep.title}\n\n${prep.body}` : null}
                skippedPoints={message.skippedPoints}
                notes={message.notes}
                copySignal={copySignal}
              />
            )}
          </ClinicDetail>
        )}
      </Modal>

      <BottomTabs
        serviceId={serviceId}
        objections={objections}
        prep={prep}
        contraindications={contraindications}
        screening={screening}
        onScreening={(k) => setScreening((s) => ({ ...s, [k]: !s[k] }))}
        onApplyFilter={applyFilter}
      />
    </div>
  )
}

