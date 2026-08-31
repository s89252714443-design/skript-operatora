import { searchVariants } from '../core/ranking.js'
import PlacePicker from './PlacePicker.jsx'

// Все условия подбора — одной колонкой слева, сверху вниз в порядке разговора:
// какая услуга → город → что именно → где удобно → уточнения.
//
// Услуга и город — выпадающие списки: их выбирают один раз за смену,
// место на экране они занимать не должны.

// Поиск подвида нужен только там, где их десятки (МРТ, КТ).
// Для колоноскопии и гастроскопии хватает списка из трёх-четырёх строк.
const SEARCH_FROM_VARIANTS = 6

export default function Sidebar({
  catalog,
  cities,
  serviceId,
  onService,
  cityId,
  onCity,
  variantId,
  onVariant,
  variantQuery,
  onVariantQuery,
  places,
  place,
  onPlace,
  filters,
  onFilters,
  placeInputRef,
}) {
  const service = catalog.services.find((s) => s.id === serviceId)
  const allVariants = catalog.serviceVariants.filter((v) => v.serviceId === serviceId)
  const needsSearch = allVariants.length >= SEARCH_FROM_VARIANTS
  const shown = needsSearch ? searchVariants(catalog, serviceId, variantQuery) : allVariants

  const isEndo = serviceId === 'colono' || serviceId === 'gastro'
  const isImaging = serviceId === 'mri' || serviceId === 'ct'
  const set = (patch) => onFilters({ ...filters, ...patch })

  // У колоноскопии и гастроскопии подвид полностью определяется фильтром
  // «Седация»: диагностическая или во сне. Отдельный список дублировал бы
  // уже сделанный выбор, поэтому его не показываем.

  return (
    <aside className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <Field label="Услуга">
        <select
          value={serviceId}
          onChange={(e) => onService(e.target.value)}
          className="w-full rounded-lg border-0 bg-white py-2.5 pr-8 pl-3 text-sm font-semibold text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-blue-500"
        >
          {catalog.services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Город">
        <select
          value={cityId}
          onChange={(e) => onCity(e.target.value)}
          className="w-full rounded-lg border-0 bg-white py-2.5 pr-8 pl-3 text-sm font-medium text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-blue-500"
        >
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      {!isEndo && (
      <Field label={`Что именно · ${service.name.toLowerCase()}`}>
        {needsSearch && (
          <input
            value={variantQuery}
            onChange={(e) => onVariantQuery(e.target.value)}
            placeholder="поясница, колено, пазухи…"
            className="mb-1.5 w-full rounded-lg border-0 bg-white px-3 py-2 text-sm ring-1 ring-slate-200 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500"
          />
        )}
        <select
          value={shown.some((v) => v.id === variantId) ? variantId : (shown[0]?.id ?? '')}
          onChange={(e) => onVariant(e.target.value)}
          size={needsSearch ? Math.min(8, Math.max(3, shown.length)) : undefined}
          className="w-full rounded-lg border-0 bg-white py-2.5 pr-8 pl-3 text-sm text-slate-900 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-blue-500"
        >
          {shown.length === 0 && <option>Ничего не нашлось</option>}
          {shown.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </Field>
      )}

      <PlacePicker
        places={places}
        cityId={cityId}
        value={place}
        onChange={onPlace}
        inputRef={placeInputRef}
      />

      <Field label="Уточнения">
        {isEndo && (
          <label className="flex items-center justify-between gap-2 text-sm text-slate-700">
            <span>Седация</span>
            <select
              value={filters.needSedation ? 'yes' : 'any'}
              onChange={(e) => set({ needSedation: e.target.value === 'yes' })}
              className="rounded-md border-0 bg-white py-1.5 pr-7 pl-2 text-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="any">не важно</option>
              <option value="yes">нужна</option>
            </select>
          </label>
        )}

        <div className="mt-2.5">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 select-none">
            <input
              type="checkbox"
              checked={!!filters.vipOnly}
              onChange={(e) => set({ vipOnly: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            ВИП-пациент?
          </label>
          <p className="mt-1 ml-6 text-xs text-slate-400">только отмеченные клиники</p>
        </div>

        {serviceId === 'mri' && (
          <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-sm text-slate-700 select-none">
            <input
              type="checkbox"
              checked={!!filters.claustrophobia}
              onChange={(e) => set({ claustrophobia: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Клаустрофобия
            <span className="text-xs text-slate-400">— открытый томограф</span>
          </label>
        )}

        {isImaging && (
          <label className="mt-2.5 flex items-center justify-between gap-2 text-sm text-slate-700">
            <span>Вес пациента</span>
            <input
              type="number"
              min="0"
              max="300"
              value={filters.patientWeight ?? ''}
              onChange={(e) => set({ patientWeight: e.target.value ? Number(e.target.value) : null })}
              placeholder="кг"
              className="w-20 rounded-md border-0 bg-white px-2 py-1.5 text-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
        )}
      </Field>
    </aside>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {label}
      </div>
      {children}
    </div>
  )
}
