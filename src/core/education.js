// Образование врача приезжает из анкеты одной сплошной строкой:
// «1999 г. "Лечебное дело" Московский… 2001 г. "Эндоскопия" Учебно-научный…».
// Читать это невозможно, а переписывать за клинику мы не имеем права —
// поэтому текст не меняем, а только режем на строки по годам.

// Год, с которого начинается очередная запись: «1999 г.», «2020 г. —», «2010 г. -»
const ENTRY_START = /(?=(?:19|20)\d{2}\s*г\.)/g
const YEAR_HEAD = /^((?:19|20)\d{2})\s*г\.\s*[-—–:]?\s*/

/**
 * Разбивает строку образования на записи вида { year, text }.
 * Текст без года (аккредитации, сертификаты в конце) остаётся отдельной
 * записью с year = null — выкидывать его нельзя, это тоже документ.
 */
export function splitEducation(raw) {
  const value = (raw ?? '').trim()
  if (!value) return []

  return value
    .split(ENTRY_START)
    .map((part) => part.trim().replace(/^[.,;]\s*/, ''))
    .filter(Boolean)
    .map((part) => {
      const head = part.match(YEAR_HEAD)
      if (!head) return { year: null, text: part }
      return { year: head[1], text: part.slice(head[0].length).trim() || part }
    })
    .filter((entry) => entry.text)
}
