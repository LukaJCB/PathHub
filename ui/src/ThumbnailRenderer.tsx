import maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"

export class ThumbnailRenderer {
  private map: maplibregl.Map
  private container: HTMLDivElement
  private routeSourceId = "route"
  private loadedPromise: Promise<void>

  constructor(
    private width = 400,
    private height = 300,
  ) {
    this.container = document.createElement("div")
    this.container.style.width = `${this.width}px`
    this.container.style.height = `${this.height}px`
    this.container.style.position = "absolute"
    this.container.style.left = "-9999px"
    document.body.appendChild(this.container)

    this.map = new maplibregl.Map({
      container: this.container,
      interactive: false,
      canvasContextAttributes: {
        preserveDrawingBuffer: true,
      },
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
          },
        ],
      },
    })

    this.loadedPromise = new Promise((resolve) => {
      this.map.once("load", () => {
        this.map.addSource(this.routeSourceId, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        })

        this.map.addLayer({
          id: "route-line",
          type: "line",
          source: this.routeSourceId,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#d00", "line-width": 3 },
        })

        resolve()
      })
    })
  }

  async render(route: [number, number, number][]): Promise<Blob> {
    if (!route.length) throw new Error("Route is empty")

    await this.loadedPromise

    const coordinates: [number, number][] = route.map(([lat, lng]) => [lng, lat])
    const bounds = coordinates.reduce(
      (b, c) => b.extend(c),
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
    )

    const source = this.map.getSource(this.routeSourceId) as maplibregl.GeoJSONSource
    source.setData({
      type: "Feature",
      geometry: { type: "LineString", coordinates },
      properties: [],
    })

    this.map.fitBounds(bounds, { padding: 20, animate: false })

    return new Promise((resolve, reject) => {
      this.map.once("idle", () => {
        this.map.getCanvas().toBlob((blob) => {
          if (!blob) reject("Failed to create blob")
          else resolve(blob)
        }, "image/png")
      })
    })
  }

  destroy() {
    this.map.remove()
    this.container.remove()
  }
}

export async function renderRouteThumbnail(
  route: [number, number, number][],
  width = 400,
  height = 300,
): Promise<Blob> {
  const renderer = new ThumbnailRenderer(width, height)
  const blob = await renderer.render(route)
  renderer.destroy()
  return blob
}
