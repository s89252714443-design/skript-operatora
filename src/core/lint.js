// Проверка текста на формулировки, запрещённые в рекламе медуслуг (ФЗ-38 ст. 24).
// Возвращает найденные совпадения с позициями — чтобы подсветить их в редакторе.

export function lintText(text, forbiddenPhrases) {
  const found = []
  const haystack = text.toLowerCase().replace(/ё/g, 'е')

  for (const { phrase, reason } of forbiddenPhrases) {
    const needle = phrase.toLowerCase().replace(/ё/g, 'е')
    let from = 0
    while (true) {
      const at = haystack.indexOf(needle, from)
      if (at === -1) break
      found.push({ phrase, reason, start: at, end: at + needle.length })
      from = at + needle.length
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

// Разбивает текст на куски для подсветки: [{ text, warning }]
export function splitByWarnings(text, warnings) {
  if (!warnings.length) return [{ text, warning: null }]
  const parts = []
  let cursor = 0
  for (const w of warnings) {
    if (w.start < cursor) continue
    if (w.start > cursor) parts.push({ text: text.slice(cursor, w.start), warning: null })
    parts.push({ text: text.slice(w.start, w.end), warning: w })
    cursor = w.end
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), warning: null })
  return parts
}
