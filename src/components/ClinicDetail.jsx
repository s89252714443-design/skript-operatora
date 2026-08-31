import { useEffect, useMemo, useState } from 'react'

import Avatar from './Avatar.jsx'
import ClinicPhotos from './ClinicPhotos.jsx'
import ClinicQa from './ClinicQa.jsx'
import { plural } from '../core/metro.js'
import { formatMoney } from '../core/message.js'
import { splitEducation } from '../core/education.js'
import { filterQaForService } from '../core/qa.js'
import { formatDistance } from '../core/ranking.js'
import { deriveTags, TAG_STYLE } from '../core/tags.js'

// Содержимое окна клиники.
//
// Раньше всё лежало одной лентой: факты, фото, пятеро врачей, 49 ответов
// анкеты — три тысячи пикселей прокрутки. Оператору за раз нужно что-то
// одно: либо выбрать врача, либо найти ответ на вопрос пациента. Поэтому
// разделы разведены по вкладкам, а полоса с ценой и текст сообщения видны
// всегда — это то, ради чего окно вообще открывают.
export default function ClinicDetail({
  option,
  todayIso,
  doctorId,
  onDoctor,
  qa = [],
  photos = [],
  children,
}) {
  const { clinicService: cs, service, doctors } = option
  const tags = deriveTags(option, todayIso)

  // Разделы анкеты по чужой процедуре оператору не нужны: пришли за
  // колоноскопией — «ТОЛЬКО ЭГДС» только мешает
  const visibleQa = useMemo(() => filterQaForService(qa, service.id), [qa, service.id])

  const tabs = [
    service.model === 'doctor'
      ? { id: 'doctors', label: 'Врачи', count: doctors.length }
      : { id: 'equipment', label: 'Оборудование', count: null },
    photos.length && { id: 'photos', label: 'Фото клиники', count: photos.length },
    visibleQa.length && { id: 'qa', label: 'Ответы клиники', count: visibleQa.length },
  ].filter(Boolean)

  const [tab, setTab] = useState(tabs[0].id)

  // у другой клиники может не быть той вкладки, что была открыта
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab(tabs[0].id)
  }, [option.key])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        {option.stationApproximate && (
          <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-800 ring-1 ring-red-200">
            Станции из анкеты нет в справочнике метро — клиника привязана к ближайшей
            известной. Проверьте адрес, прежде чем называть станцию пациенту.
          </div>
        )}

        {/* Цена и теги не уезжают за вкладки: их спрашивают в первую очередь */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200">
          <Fact
            label="Средняя стоимость мед. кейса"
            value={option.costKnown ? formatMoney(cs.avgCaseCost) : 'не заведена'}
            big
            warn={!option.costKnown}
          />
          {cs.durationMin && <Fact label="Длительность" value={`${cs.durationMin} мин`} />}
          {tags.length > 0 && (
            <div className="flex flex-1 flex-wrap justify-end gap-1.5">
              {tags.map((t, i) => (
                <span
                  key={i}
                  title={t.kind}
                  className={`rounded-md px-2.5 py-1 text-sm ring-1 ring-inset ${TAG_STYLE[t.kind]} ${t.strong ? 'font-semibold' : ''}`}
                >
                  {t.text}
                </span>
              ))}
            </div>
          )}
        </div>

        {option.clinic.notesInternal && (
          <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-500">Для оператора, не для пациента: </span>
            {option.clinic.notesInternal}
          </div>
        )}

        <div className="flex shrink-0 gap-1 border-b border-slate-200">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={[
                '-mb-px border-b-2 px-3.5 py-2 text-sm font-semibold transition',
                t.id === tab
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800',
              ].join(' ')}
            >
              {t.label}
              {t.count != null && (
                <span className="ml-1.5 text-xs font-normal text-slate-400">{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Прокручивается только содержимое вкладки — шапка, цена и текст
            сообщения остаются на месте. На узком экране колонок нет,
            и страница листается целиком, как обычно. */}
        <div className="min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
          {tab === 'doctors' && (
            <Doctors doctors={doctors} selectedId={doctorId} onSelect={onDoctor} />
          )}
          {tab === 'equipment' && <Equipment cs={cs} />}
          {tab === 'photos' && (
            <ClinicPhotos photos={photos} clinicName={option.clinic.name} />
          )}
          {tab === 'qa' && <ClinicQa items={visibleQa} />}
        </div>
      </div>

      {/* Текст сообщения бывает длинным: пусть прокручивается сам,
          а не выталкивает окно за край экрана */}
      <div className="w-full shrink-0 lg:w-[420px] lg:overflow-y-auto xl:w-[480px]">
        {children}
      </div>
    </div>
  )
}

function Doctors({ doctors, selectedId, onSelect }) {
  if (!doctors.length) {
    return (
      <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
        В карточке клиники не заведён врач для этой услуги.
      </div>
    )
  }
  const current = doctors.find((d) => d.id === selectedId) ?? doctors[0]

  return (
    <div>
      <div className="space-y-3">
        {doctors.map((d) => (
          <DoctorCard
            key={d.id}
            doctor={d}
            active={d.id === current.id}
            onSelect={() => onSelect(d.id)}
          />
        ))}
      </div>
    </div>
  )
}

function DoctorCard({ doctor, active, onSelect }) {
  const confirmed = doctor.sellingPoints.filter((p) => p.confidence === 'confirmed')
  const unverified = doctor.sellingPoints.filter((p) => p.confidence !== 'confirmed')

  return (
    // Кликом выбирается вся карточка, а не только кнопка справа: попадать
    // курсором в маленькую кнопку на каждом звонке — лишняя секунда
    <div
      onClick={onSelect}
      className={[
        'rounded-xl bg-white p-3.5 transition',
        active
          ? 'ring-2 ring-blue-500'
          : 'cursor-pointer ring-1 ring-slate-200 hover:ring-slate-300 hover:shadow-sm',
      ].join(' ')}
    >
      {/* Карточка идёт во всю ширину списка: имя и фото слева, регалии
          и тезисы справа — иначе поперёк карточки тянется пустое место */}
      <div className="flex items-start gap-3.5">
        <Avatar name={doctor.fullName} photoUrl={doctor.photoUrl} size={56} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {/* Регалии стоят рядом с именем, а не строкой ниже: так врач
                  читается одним взглядом — кто это и чем силён */}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <span className="font-semibold text-slate-900">{doctor.fullName}</span>
                {doctor.degree && (
                  <Chip tone="violet" strong title="Учёная степень">
                    {doctor.degree}
                  </Chip>
                )}
                {doctor.experienceYears > 0 && (
                  <Chip tone="slate" strong={doctor.experienceYears >= 20}>
                    стаж {doctor.experienceYears}{' '}
                    {plural(doctor.experienceYears, 'год', 'года', 'лет')}
                  </Chip>
                )}
                {doctor.category && <Chip tone="sky">{doctor.category} категория</Chip>}
                {doctor.proceduresCount > 0 && (
                  <Chip tone="slate">
                    {new Intl.NumberFormat('ru-RU').format(doctor.proceduresCount)} процедур
                  </Chip>
                )}
                {doctor.forAnxious && (
                  <Chip
                    tone="emerald"
                    title="Клиника отметила врача как подходящего тревожным пациентам"
                  >
                    для тревожных
                  </Chip>
                )}
              </div>
              <div className="text-sm text-slate-500">{doctor.specialty}</div>
            </div>
            {active ? (
              <span className="shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white">
                в сообщении
              </span>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect()
                }}
                className="shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-200 transition hover:bg-blue-50"
              >
                выбрать
              </button>
            )}
          </div>

          <div className="mt-2.5 grid gap-x-6 gap-y-2.5 lg:grid-cols-2 lg:items-start">
            {confirmed.length > 0 && (
              <ul className="space-y-1 text-sm">
                {confirmed.map((p) => (
                  <li key={p.id} className="flex items-start gap-2 text-slate-700">
                    <span className="mt-0.5 text-emerald-600">✓</span>
                    {p.text}
                  </li>
                ))}
              </ul>
            )}

            <Education raw={doctor.education} />
          </div>

          {unverified.length > 0 && (
            <details className="mt-2 text-xs" onClick={(e) => e.stopPropagation()}>
              <summary className="cursor-pointer text-amber-600 hover:text-amber-700">
                Не подтверждено клиникой — не для пациента ({unverified.length})
              </summary>
              <ul className="mt-1 space-y-0.5 pl-4 text-slate-400">
                {unverified.map((p) => (
                  <li key={p.id}>{p.text}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}

// Образование приходит сплошной строкой. Разбиваем по годам и показываем
// строками: оператору важно увидеть профильную подготовку, а не вычитывать
// абзац. Ничего не прячем — карточка растёт под содержимое, чтобы врач
// читался целиком, без раскрытия скрытых кусков.
function Education({ raw }) {
  const entries = splitEducation(raw)
  if (!entries.length) return null

  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold tracking-wide text-slate-400 uppercase">
        Образование и обучение
      </div>
      <ul className="space-y-1.5 text-sm">
        {entries.map((e, i) => (
          <EducationRow key={i} entry={e} />
        ))}
      </ul>
    </div>
  )
}

function EducationRow({ entry }) {
  return (
    <li className="flex gap-2.5">
      <span className="w-9 shrink-0 pt-px text-xs font-semibold text-slate-400 tabular-nums">
        {entry.year ?? '·'}
      </span>
      <span className="leading-snug text-slate-600">{entry.text}</span>
    </li>
  )
}

function Equipment({ cs }) {
  return (
    <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Оборудование
      </h3>
      <div className="font-semibold text-slate-900">{cs.equipmentModel ?? 'Аппарат не указан'}</div>
      <dl className="mt-2 space-y-1.5 text-sm">
        {cs.tesla && <Row label="Поле" value={`${String(cs.tesla).replace('.', ',')} Тесла`} />}
        {cs.mriType && (
          <Row label="Тип" value={cs.mriType === 'open' ? 'Открытый контур' : 'Закрытый контур'} />
        )}
        {cs.maxWeightKg && <Row label="Предел по весу" value={`${cs.maxWeightKg} кг`} />}
        {cs.reportHours && (
          <Row
            label="Заключение"
            value={
              cs.reportHours <= 2
                ? `через ${cs.reportHours} ${plural(cs.reportHours, 'час', 'часа', 'часов')}`
                : cs.reportHours <= 24
                  ? 'на следующий день'
                  : `до ${Math.round(cs.reportHours / 24)} дней`
            }
          />
        )}
      </dl>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-slate-400">{label}</dt>
      <dd className="text-slate-700">{value}</dd>
    </div>
  )
}

// Небольшой тег для регалий врача
const CHIP_TONE = {
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200',
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
}

function Chip({ tone = 'slate', strong, title, children }) {
  return (
    <span
      title={title}
      className={[
        'rounded-md px-2.5 py-1 text-sm ring-1 ring-inset',
        CHIP_TONE[tone],
        strong ? 'font-semibold' : '',
      ].join(' ')}
    >
      {children}
    </span>
  )
}

function Fact({ label, value, big, warn }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div
        className={[
          big ? 'text-base font-bold' : 'text-sm font-medium',
          warn ? 'text-amber-600' : 'text-slate-900',
        ].join(' ')}
      >
        {value}
      </div>
    </div>
  )
}
