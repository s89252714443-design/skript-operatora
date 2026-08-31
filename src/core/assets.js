// Пути к файлам из public — с учётом того, где приложение развёрнуто.
//
// Локально сайт живёт в корне (http://localhost:5173/), а на GitHub Pages —
// в подпапке (https://…github.io/skript-operatora/). Путь вида
// «/clinics/x.webp», записанный от корня домена, во втором случае даст 404.
//
// В данных пути так и остаются от корня — это естественная форма записи,
// и сотрудник в админке пишет именно её. Приставку добавляем при показе.

// Vite подставляет сюда base: '/' в деве, '/skript-operatora/' в сборке
const BASE = import.meta.env.BASE_URL ?? '/'

/** «/clinics/x.webp» → «/skript-operatora/clinics/x.webp» */
export function assetUrl(path) {
  if (!path) return path
  // внешние ссылки трогать нельзя
  if (/^(https?:)?\/\//i.test(path) || path.startsWith('data:')) return path
  return BASE.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '')
}
