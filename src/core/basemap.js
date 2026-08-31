// Выбор подложки карты. Оба варианта бесплатны и не требуют API-ключа.
//
// 1. Свой файл .pmtiles (VITE_BASEMAP_PMTILES) — рекомендуемый режим.
//    Вся подложка лежит одним статичным файлом рядом с приложением.
//    Ничей сервис не задействован: нельзя ни превысить лимит, ни лишиться
//    доступа, ни столкнуться с изменением условий. Работает и без интернета.
//
// 2. Растровые тайлы OpenStreetMap — режим по умолчанию, работает сразу.
//    Бесплатно и без ключа, но это чужой сервер: по правилам OSMF доступ
//    коммерческим сервисам может быть закрыт в любой момент, гарантий нет.
//    Годится, чтобы попробовать; для боевой работы переключитесь на п.1.

import { layers, namedFlavor } from '@protomaps/basemaps'

export const PMTILES_URL = import.meta.env?.VITE_BASEMAP_PMTILES ?? ''
export const usePmtiles = Boolean(PMTILES_URL)

const OSM_ATTRIBUTION = '&copy; OpenStreetMap contributors'
const PROTOMAPS_ASSETS = 'https://protomaps.github.io/basemaps-assets'

export function buildStyle() {
  if (usePmtiles) {
    return {
      version: 8,
      glyphs: `${PROTOMAPS_ASSETS}/fonts/{fontstack}/{range}.pbf`,
      sprite: `${PROTOMAPS_ASSETS}/sprites/v4/light`,
      sources: {
        protomaps: {
          type: 'vector',
          url: `pmtiles://${PMTILES_URL}`,
          attribution: OSM_ATTRIBUTION,
        },
      },
      layers: layers('protomaps', namedFlavor('light'), { lang: 'ru' }),
    }
  }

  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: OSM_ATTRIBUTION,
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  }
}

export const basemapName = usePmtiles ? 'свой файл .pmtiles' : 'OpenStreetMap'
