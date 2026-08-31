// Одноразовый скрипт: добавляет координаты станциям в data/metro.json
// и создаёт data/places.json (районы и крупные улицы для поиска).
//
// Координаты демонстрационные, взяты приблизительно. В боевой версии
// станции берутся из открытых данных, клиники — из геокодера.
//
// Запуск: node scripts/geodata.js

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const COORDS = {
  // ── Москва ──
  'm1-komsomolskaya': [55.7758, 37.6558], 'm1-krasnye-vorota': [55.769, 37.649],
  'm1-chistye-prudy': [55.7648, 37.6386], 'm1-lubyanka': [55.7594, 37.6266],
  'm1-ohotny-ryad': [55.7576, 37.6156], 'm1-biblioteka': [55.7515, 37.6098],
  'm1-kropotkinskaya': [55.7452, 37.6039], 'm1-park-kultury': [55.7355, 37.5936],
  'm1-frunzenskaya': [55.7275, 37.5797], 'm1-sportivnaya': [55.7232, 37.5637],
  'm1-vorobyovy': [55.7104, 37.5593], 'm1-universitet': [55.6924, 37.5347],

  'm2-belorusskaya': [55.7767, 37.5822], 'm2-mayakovskaya': [55.77, 37.596],
  'm2-tverskaya': [55.7648, 37.6062], 'm2-teatralnaya': [55.758, 37.6188],
  'm2-novokuznetskaya': [55.7418, 37.6291], 'm2-paveletskaya': [55.73, 37.6367],
  'm2-avtozavodskaya': [55.7069, 37.657], 'm2-tehnopark': [55.6944, 37.665],
  'm2-kolomenskaya': [55.6786, 37.6644], 'm2-kashirskaya': [55.6555, 37.6488],

  'm5-belorusskaya': [55.7775, 37.5817], 'm5-novoslobodskaya': [55.7793, 37.6006],
  'm5-prospekt-mira': [55.7801, 37.6337], 'm5-komsomolskaya': [55.7754, 37.6551],
  'm5-kurskaya': [55.7583, 37.6597], 'm5-taganskaya': [55.7404, 37.6531],
  'm5-paveletskaya': [55.7296, 37.6362], 'm5-dobryninskaya': [55.7284, 37.6234],
  'm5-oktyabrskaya': [55.729, 37.6114], 'm5-park-kultury': [55.7356, 37.5934],
  'm5-kievskaya': [55.744, 37.5666], 'm5-krasnopresnenskaya': [55.7605, 37.5776],

  'm6-prospekt-mira': [55.7793, 37.633], 'm6-suharevskaya': [55.7727, 37.6317],
  'm6-turgenevskaya': [55.7656, 37.6383], 'm6-kitay-gorod': [55.7554, 37.634],
  'm6-tretyakovskaya': [55.7409, 37.6288], 'm6-oktyabrskaya': [55.7285, 37.6117],
  'm6-shabolovskaya': [55.7189, 37.6079], 'm6-leninsky': [55.7075, 37.5836],
  'm6-akademicheskaya': [55.6879, 37.5735], 'm6-profsoyuznaya': [55.6775, 37.5625],
  'm6-novye-cheryomushki': [55.67, 37.549],

  'm7-barrikadnaya': [55.7601, 37.581], 'm7-pushkinskaya': [55.7654, 37.6053],
  'm7-kuznetsky-most': [55.7614, 37.6242], 'm7-kitay-gorod': [55.7551, 37.6345],
  'm7-taganskaya': [55.7409, 37.6534], 'm7-proletarskaya': [55.7317, 37.664],
  'm7-volgogradsky': [55.7217, 37.677], 'm7-tekstilshchiki': [55.709, 37.7318],
  'm7-kuzminki': [55.7053, 37.7648],

  'm9-mendeleevskaya': [55.7823, 37.5993], 'm9-tsvetnoy': [55.7716, 37.6206],
  'm9-chehovskaya': [55.7659, 37.6067], 'm9-borovitskaya': [55.7508, 37.6091],
  'm9-polyanka': [55.7369, 37.6182], 'm9-serpuhovskaya': [55.728, 37.6255],
  'm9-tulskaya': [55.7091, 37.6234], 'm9-nagatinskaya': [55.6853, 37.6183],
  'm9-nagornaya': [55.6752, 37.6046], 'm9-nahimovsky': [55.664, 37.6017],

  'm10-trubnaya': [55.769, 37.6206], 'm10-sretensky': [55.7655, 37.6367],
  'm10-chkalovskaya': [55.7568, 37.6592], 'm10-rimskaya': [55.7455, 37.6706],
  'm10-krestyanskaya': [55.7325, 37.6674], 'm10-dubrovka': [55.7226, 37.674],
  'm10-kozhuhovskaya': [55.7069, 37.6809], 'm10-pechatniki': [55.692, 37.7288],
  'm10-volzhskaya': [55.7085, 37.7495],

  // ── Санкт-Петербург ──
  's1-vosstaniya': [59.931, 30.3609], 's1-vladimirskaya': [59.9273, 30.3475],
  's1-pushkinskaya': [59.9203, 30.3293], 's1-tehinstitut': [59.9169, 30.3182],
  's1-baltiyskaya': [59.9077, 30.2996], 's1-narvskaya': [59.901, 30.2748],
  's1-kirovsky': [59.8797, 30.2618], 's1-avtovo': [59.8672, 30.261],

  's2-petrogradskaya': [59.9663, 30.3116], 's2-gorkovskaya': [59.956, 30.3175],
  's2-nevsky': [59.9355, 30.3273], 's2-sennaya': [59.927, 30.32],
  's2-tehinstitut': [59.9166, 30.3186], 's2-frunzenskaya': [59.9053, 30.3178],
  's2-moskovskie-vorota': [59.8912, 30.3182], 's2-elektrosila': [59.8801, 30.3187],
  's2-park-pobedy': [59.8663, 30.3216], 's2-moskovskaya': [59.8514, 30.322],

  's3-vasileostrovskaya': [59.943, 30.2795], 's3-gostiny': [59.9339, 30.3308],
  's3-mayakovskaya': [59.9316, 30.3592], 's3-nevskogo': [59.9245, 30.3849],
  's3-elizarovskaya': [59.8975, 30.4166], 's3-lomonosovskaya': [59.877, 30.4341],

  's4-spasskaya': [59.9271, 30.3184], 's4-dostoevskaya': [59.9276, 30.3479],
  's4-ligovsky': [59.9203, 30.3549], 's4-nevskogo': [59.925, 30.3854],
  's4-novocherkasskaya': [59.9297, 30.4113], 's4-ladozhskaya': [59.9327, 30.4396],

  's5-komendantsky': [60.009, 30.2588], 's5-staraya-derevnya': [59.9893, 30.2554],
  's5-krestovsky': [59.972, 30.26], 's5-chkalovskaya': [59.9611, 30.2924],
  's5-sportivnaya': [59.9531, 30.2926], 's5-admiralteyskaya': [59.936, 30.3155],
  's5-sadovaya': [59.9268, 30.3187], 's5-zvenigorodskaya': [59.9202, 30.3298],
  's5-obvodny': [59.9142, 30.3411], 's5-volkovskaya': [59.8961, 30.3573],
}

// ── Районы ───────────────────────────────────────────────────────────────
const DISTRICTS = [
  ['msk', 'Даниловский', 55.71, 37.62], ['msk', 'Таганский', 55.74, 37.66],
  ['msk', 'Замоскворечье', 55.735, 37.63], ['msk', 'Тверской', 55.77, 37.6],
  ['msk', 'Пресненский', 55.76, 37.57], ['msk', 'Мещанский', 55.78, 37.63],
  ['msk', 'Красносельский', 55.78, 37.66], ['msk', 'Басманный', 55.765, 37.67],
  ['msk', 'Хамовники', 55.73, 37.58], ['msk', 'Якиманка', 55.73, 37.61],
  ['msk', 'Академический', 55.69, 37.57], ['msk', 'Гагаринский', 55.69, 37.56],
  ['msk', 'Ломоносовский', 55.685, 37.53], ['msk', 'Обручевский', 55.66, 37.53],
  ['msk', 'Черёмушки', 55.67, 37.56], ['msk', 'Котловка', 55.67, 37.6],
  ['msk', 'Нагорный', 55.675, 37.61], ['msk', 'Нагатино-Садовники', 55.68, 37.63],
  ['msk', 'Донской', 55.705, 37.61], ['msk', 'Южнопортовый', 55.715, 37.68],
  ['msk', 'Печатники', 55.69, 37.72], ['msk', 'Текстильщики', 55.705, 37.73],
  ['msk', 'Кузьминки', 55.7, 37.77], ['msk', 'Нижегородский', 55.73, 37.71],
  ['msk', 'Марьина Роща', 55.79, 37.61], ['msk', 'Раменки', 55.7, 37.5],

  ['spb', 'Центральный', 59.935, 30.36], ['spb', 'Адмиралтейский', 59.92, 30.31],
  ['spb', 'Василеостровский', 59.94, 30.27], ['spb', 'Петроградский', 59.96, 30.3],
  ['spb', 'Московский', 59.87, 30.32], ['spb', 'Фрунзенский', 59.87, 30.38],
  ['spb', 'Невский', 59.89, 30.43], ['spb', 'Красногвардейский', 59.95, 30.44],
  ['spb', 'Калининский', 59.99, 30.4], ['spb', 'Выборгский', 60.01, 30.34],
  ['spb', 'Приморский', 60.0, 30.26], ['spb', 'Кировский', 59.87, 30.26],
]

// ── Крупные улицы и ориентиры ────────────────────────────────────────────
const STREETS = [
  ['msk', 'Тверская улица', 55.764, 37.606], ['msk', 'Ленинский проспект', 55.7, 37.58],
  ['msk', 'Ленинградский проспект', 55.79, 37.55], ['msk', 'Кутузовский проспект', 55.74, 37.53],
  ['msk', 'Профсоюзная улица', 55.67, 37.55], ['msk', 'Варшавское шоссе', 55.66, 37.62],
  ['msk', 'Каширское шоссе', 55.65, 37.66], ['msk', 'Волгоградский проспект', 55.72, 37.7],
  ['msk', 'Рязанский проспект', 55.72, 37.78], ['msk', 'Проспект Вернадского', 55.68, 37.51],
  ['msk', 'Арбат', 55.75, 37.59], ['msk', 'Пятницкая улица', 55.74, 37.628],
  ['msk', 'Большая Тульская улица', 55.708, 37.618], ['msk', 'Шаболовка', 55.718, 37.608],
  ['msk', 'Комсомольский проспект', 55.727, 37.585],

  ['spb', 'Невский проспект', 59.933, 30.335], ['spb', 'Московский проспект', 59.89, 30.319],
  ['spb', 'Литейный проспект', 59.94, 30.348], ['spb', 'Большой проспект П.С.', 59.956, 30.29],
  ['spb', 'Каменноостровский проспект', 59.965, 30.312], ['spb', 'Лиговский проспект', 59.92, 30.356],
  ['spb', 'Садовая улица', 59.928, 30.318], ['spb', 'Загородный проспект', 59.922, 30.335],
]

// ── Патчим metro.json ────────────────────────────────────────────────────
const metroPath = resolve(ROOT, 'data/metro.json')
const metro = JSON.parse(readFileSync(metroPath, 'utf8'))

let patched = 0
const missing = []
for (const line of metro.lines) {
  line.stations = line.stations.map((entry) => {
    const [id, name] = entry
    const c = COORDS[id]
    if (!c) {
      missing.push(id)
      return [id, name]
    }
    patched++
    return [id, name, c[0], c[1]]
  })
}
writeFileSync(metroPath, JSON.stringify(metro, null, 2), 'utf8')

// ── Пишем places.json ────────────────────────────────────────────────────
const slug = (s) => s.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '')
const places = {
  _comment: 'Районы и улицы для поиска «где пациенту удобно». Координаты приблизительные.',
  districts: DISTRICTS.map(([cityId, name, lat, lng]) => ({
    id: `d-${cityId}-${slug(name)}`, cityId, name, lat, lng,
  })),
  streets: STREETS.map(([cityId, name, lat, lng]) => ({
    id: `st-${cityId}-${slug(name)}`, cityId, name, lat, lng,
  })),
}
writeFileSync(resolve(ROOT, 'data/places.json'), JSON.stringify(places, null, 2), 'utf8')

console.log(`станциям проставлены координаты: ${patched}`)
if (missing.length) console.log(`БЕЗ КООРДИНАТ: ${missing.join(', ')}`)
console.log(`районов: ${places.districts.length}, улиц: ${places.streets.length}`)
