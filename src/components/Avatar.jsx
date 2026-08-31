import { useState } from 'react'

// Фото врача. Пока в данных фото нет — рисуем инициалы на детерминированном
// градиенте: выглядит осознанно, а не как сломанная картинка.
// Когда клиника пришлёт фото, поле photoUrl подставится сюда само.

const PALETTES = [
  ['#0ea5e9', '#2563eb'],
  ['#8b5cf6', '#6366f1'],
  ['#10b981', '#0d9488'],
  ['#f59e0b', '#ea580c'],
  ['#ec4899', '#be185d'],
  ['#64748b', '#334155'],
]

function hash(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export default function Avatar({ name, photoUrl, size = 56 }) {
  // Ссылка может протухнуть или вести не на картинку — тогда возвращаемся
  // к инициалам, а не показываем оператору битую иконку.
  const [broken, setBroken] = useState(false)

  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  if (photoUrl && !broken) {
    return (
      <img
        src={photoUrl}
        alt={name}
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    )
  }

  const [from, to] = PALETTES[hash(name) % PALETTES.length]
  return (
    <div
      aria-label={name}
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white select-none"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, ${from}, ${to})`,
      }}
    >
      {initials}
    </div>
  )
}
