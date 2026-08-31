// Анкета «Общие вопросы» одна на клинику и покрывает сразу обе процедуры:
// в ней есть раздел «ТОЛЬКО ЭГДС» и раздел «ТОЛЬКО КОЛОНОСКОПИЯ». Показывать
// оператору оба, когда пациент пришёл за одной услугой, — значит заставлять
// его отличать одно от другого на ходу. Поэтому чужой раздел отсекаем.

import { isAboutOtherProcedure } from './service.js'

/** Оставляет разделы анкеты, относящиеся к выбранной услуге. */
export function filterQaForService(items, serviceId) {
  return items.filter((row) => !isAboutOtherProcedure(row.category, serviceId))
}

/** Группирует ответы по разделам, сохраняя порядок из анкеты. */
export function groupQa(items) {
  const byCategory = new Map()
  for (const row of items) {
    const key = row.category || 'Прочее'
    if (!byCategory.has(key)) byCategory.set(key, [])
    byCategory.get(key).push(row)
  }
  return [...byCategory.entries()].map(([category, rows]) => ({ category, rows }))
}
