// Внешний вид точки на карте: название клиники целиком.
//
// Обрезать его нельзя — у сети четыре филиала подряд начинаются одинаково
// («Первая семейная клиника на…»), и по обрезанной метке их не различить:
// отличается как раз хвост. Поэтому метка переносится на две строки,
// ширина ограничена, а не текст. Станция и расстояние есть в карточке
// справа, адрес — в подсказке при наведении.

// data-clinic нужен для делегирования клика: у HTML-меток разных карт
// свои события, а обработчик на контейнере работает везде одинаково.
const MAX_WIDTH_PX = 170
const MAX_LINES = 2

export function pillHtml(row, index, active) {
  const top = index === 0
  const bg = active ? '#1d4ed8' : top ? '#0f172a' : '#ffffff'
  const fg = active || top ? '#ffffff' : '#0f172a'
  const border = active ? '#1d4ed8' : top ? '#0f172a' : '#cbd5e1'

  return `<div data-clinic="${escapeHtml(row.key)}" style="
      transform: translate(-50%, -120%);
      display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:${MAX_LINES};
      overflow:hidden; text-align:center; max-width:${MAX_WIDTH_PX}px;
      padding:3px 8px; border-radius:12px;
      background:${bg}; color:${fg}; border:2px solid ${border};
      font: 600 12px/1.25 Inter, 'Segoe UI', system-ui, sans-serif;
      box-shadow: 0 2px 6px rgba(15,23,42,.25); cursor:pointer;">
      ${top ? '★ ' : ''}${escapeHtml(row.clinic.name)}
    </div>`
}

export function escapeHtml(s) {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )
}

// Границы, охватывающие все точки, с запасом по краям.
// points — массив [lat, lng].
export function boundsOf(points, padRatio = 0.15) {
  const lats = points.map((p) => p[0])
  const lngs = points.map((p) => p[1])
  let minLat = Math.min(...lats)
  let maxLat = Math.max(...lats)
  let minLng = Math.min(...lngs)
  let maxLng = Math.max(...lngs)

  const padLat = Math.max((maxLat - minLat) * padRatio, 0.004)
  const padLng = Math.max((maxLng - minLng) * padRatio, 0.006)
  minLat -= padLat
  maxLat += padLat
  minLng -= padLng
  maxLng += padLng

  return { minLat, maxLat, minLng, maxLng }
}
