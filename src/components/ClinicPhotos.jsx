import { useEffect, useState } from 'react'

// Фотографии клиники в окне: пациент почти всегда спрашивает «а что там
// вообще», и оператору проще один раз посмотреть самому, чем пересказывать
// анкету. Крупный кадр плюс лента превью — листать быстрее, чем скроллить.

export default function ClinicPhotos({ photos, clinicName }) {
  const [index, setIndex] = useState(0)

  // при переходе к другой клинике лента должна начинаться сначала
  useEffect(() => setIndex(0), [clinicName])

  if (!photos.length) return null

  const current = photos[Math.min(index, photos.length - 1)]

  return (
    <div>
      <figure className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
        <img
          src={current.url}
          alt={`${clinicName}: ${current.caption ?? 'фотография клиники'}`}
          className="aspect-video max-h-[52vh] w-full bg-slate-100 object-cover"
        />
        {current.caption && (
          <figcaption className="px-3.5 py-2 text-sm text-slate-600">{current.caption}</figcaption>
        )}
      </figure>

      {photos.length > 1 && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {photos.map((p, i) => (
            <button
              key={p.url}
              onClick={() => setIndex(i)}
              title={p.caption}
              className={[
                'h-16 w-24 shrink-0 overflow-hidden rounded-lg transition',
                i === index ? 'ring-2 ring-blue-500' : 'opacity-70 ring-1 ring-slate-200 hover:opacity-100',
              ].join(' ')}
            >
              <img
                src={p.url}
                alt={p.caption ?? ''}
                className="h-full w-full bg-slate-100 object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
