// Теги клиники — то, что оператор считывает за полсекунды, не читая цифры.
// Все они выводятся из данных, ничего не задаётся руками.

import { daysBetween } from './ranking.js'
import { plural } from './metro.js'

export const TAG_KIND = {
  access: 'доступность записи',
  location: 'локация',
  staff: 'специалисты',
  service: 'сервис',
  equipment: 'оборудование',
}

export function deriveTags(option, todayIso) {
  const { clinic, clinicService: cs, travel, doctors, service } = option
  const tags = []
  const add = (kind, text, strong = false) => tags.push({ kind, text, strong })

  // ── Специалисты ──
  if (service.model === 'doctor' && doctors.length) {
    const maxExp = Math.max(...doctors.map((d) => d.experienceYears || 0))
    const step = maxExp >= 30 ? 30 : maxExp >= 20 ? 20 : maxExp >= 10 ? 10 : null
    if (step) add('staff', `Стаж специалистов ${step}+`, step >= 20)

    if (doctors.some((d) => d.degree)) add('staff', 'Есть кандидаты и доктора наук')
    if (doctors.some((d) => d.category === 'высшая')) add('staff', 'Врачи высшей категории')

    const rated = doctors.filter((d) => d.ratingValue)
    if (rated.length) {
      const avg = rated.reduce((s, d) => s + d.ratingValue, 0) / rated.length
      if (avg >= 4.8) add('service', 'Качественный сервис', true)
    }
  }

  // ── Сервис и оборудование ──
  if (cs.hasSedation && cs.hasAnesthesiologist) add('service', 'Есть седация', true)
  if (cs.mriType === 'open') add('equipment', 'Открытый томограф', true)
  if (cs.tesla >= 3) add('equipment', `${cs.tesla} Тесла`, true)
  if (cs.reportHours && cs.reportHours <= 2) add('service', 'Заключение за час-два')
  if (/круглосуточно/i.test(clinic.workHours ?? '')) add('service', 'Круглосуточно')

  return tags
}

export const TAG_STYLE = {
  access: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  location: 'bg-sky-50 text-sky-700 ring-sky-200',
  staff: 'bg-violet-50 text-violet-700 ring-violet-200',
  service: 'bg-amber-50 text-amber-700 ring-amber-200',
  equipment: 'bg-slate-100 text-slate-700 ring-slate-300',
}
