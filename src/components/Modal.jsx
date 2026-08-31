import { useEffect, useRef } from 'react'

// Большое окно поверх экрана. Нужно там, где содержимое не помещается
// в боковую колонку: карточка клиники с врачами, фото и готовым текстом.

export default function Modal({ open, onClose, title, subtitle, children }) {
  const boxRef = useRef(null)

  // Пока окно открыто, страница под ним не должна прокручиваться
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // Esc закрывает, но не когда оператор что-то печатает — иначе он потеряет
  // правку в тексте сообщения одним случайным нажатием
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-2000 flex items-center justify-center bg-slate-900/40 p-2 sm:p-4"
      onMouseDown={(e) => {
        // закрываем только по клику мимо окна, а не по отпусканию мыши
        // после выделения текста внутри
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={boxRef}
        className="flex h-full w-full max-w-[1800px] flex-col rounded-2xl bg-slate-50 shadow-2xl ring-1 ring-slate-900/10"
      >
        {/* Шапка не прокручивается: оператор всегда видит, о какой клинике речь */}
        <header className="flex shrink-0 items-start gap-4 rounded-t-2xl border-b border-slate-200 bg-white px-6 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xl leading-tight font-bold text-slate-900">
              {title}
            </h2>
            {subtitle}
          </div>
          <button
            onClick={onClose}
            title="Закрыть · Esc"
            className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            Закрыть ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 lg:overflow-hidden">{children}</div>
      </div>
    </div>
  )
}
