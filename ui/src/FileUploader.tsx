import React, { useState, ChangeEvent, DragEvent, useEffect, useRef } from "react"
import FitParser from "fit-file-parser"
import { useAuthRequired } from "./useAuth"
import { createPost } from "pathhub-client/src/createPost.js"
import { makeStore } from "pathhub-client/src/indexedDbStore.js"
import { encodeRoute } from "pathhub-client/src/codec/encode.js"
import { MessageClient } from "pathhub-client/src/http/messageClient.js"
import { getCiphersuiteFromName, getCiphersuiteImpl } from "ts-mls"
import { Link, useNavigate } from "react-router"
import { base64urlToUint8, createRemoteStore } from "pathhub-client/src/remoteStore.js"
import { decodeBlobWithMime, encodeBlobWithMime } from "pathhub-client/src/imageEncoding.js"
import { createContentClient } from "pathhub-client/src/http/storageClient.js"
import MapLibreRouteMap from "./MapLibreView"
import { renderRouteThumbnail } from "./ThumbnailRenderer"
import { postTypeOptions } from "./postTypeEmojis"

interface RouteData {
  coords: [number, number, number][]
  totalDistance: number
  totalElevation: number
  totalDuration: number
}

export const minimumDistanceThreshold = 3
export const minimumGainThreshold = 0.09
export const maximumGainThreshold = 15

const FileUpload: React.FC = () => {
  const nav = useNavigate()

  const { user, updateUser } = useAuthRequired()
  const [gpxData, setGpxData] = useState<RouteData | null>(null)
  const [imageData, setImageData] = useState<Uint8Array[]>([])
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [postType, setPostType] = useState("Ride")
  const [gear, setGear] = useState("")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    imageUrls.forEach(URL.revokeObjectURL)

    const urls = imageData.map((i) => {
      const { mimeType, bytes } = decodeBlobWithMime(i)
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], {
        type: mimeType,
      })
      return URL.createObjectURL(blob)
    })

    setImageUrls(urls)

    return () => {
      urls.forEach(URL.revokeObjectURL)
    }
  }, [imageData])

  const decompressGzip = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer()
    const stream = new Response(arrayBuffer).body!
    const decompressedStream = stream.pipeThrough(new DecompressionStream("gzip"))
    const decompressedResponse = new Response(decompressedStream)
    return await decompressedResponse.text()
  }

  const decompressGzipToArrayBuffer = async (file: File): Promise<ArrayBuffer> => {
    const arrayBuffer = await file.arrayBuffer()
    const stream = new Response(arrayBuffer).body!
    const decompressedStream = stream.pipeThrough(new DecompressionStream("gzip"))
    const decompressedResponse = new Response(decompressedStream)
    const decompressedBuffer = await decompressedResponse.arrayBuffer()
    return decompressedBuffer
  }

  const processGpxFile = async (file: File) => {
    setSelectedFile(file)
    const reader = new FileReader()
    const isGzipped = file.name.endsWith(".gz")
    const isGpx = file.name.endsWith(".gpx") || file.name.endsWith(".gpx.gz")
    const isTcx = file.name.endsWith(".tcx") || file.name.endsWith(".tcx.gz")
    const isFit = file.name.endsWith(".fit") || file.name.endsWith(".fit.gz")

    if (isGpx) {
      if (isGzipped) {
        try {
          const text = await decompressGzip(file)
          const result = parseGpxData(text, minimumDistanceThreshold, minimumGainThreshold, maximumGainThreshold)

          if (!result) {
            alert("Failed to parse GPX file. Please ensure it contains valid trackpoint data.")
            return
          }

          const { totalDistance, totalElevationGain, coords, totalDuration } = result
          setGpxData({
            coords: coords,
            totalDuration,
            totalDistance,
            totalElevation: totalElevationGain,
          })
        } catch (error) {
          console.error("Failed to decompress file:", error)
          alert("Failed to decompress .gz file. Please ensure it is a valid gzip file.")
        }
      } else {
        reader.onload = () => {
          const text = reader.result as string
          const result = parseGpxData(text, minimumDistanceThreshold, minimumGainThreshold, maximumGainThreshold)

          if (!result) {
            alert("Failed to parse GPX file. Please ensure it contains valid trackpoint data.")
            return
          }

          const { totalDistance, totalElevationGain, coords, totalDuration } = result
          setGpxData({
            coords: coords,
            totalDuration,
            totalDistance,
            totalElevation: totalElevationGain,
          })
        }
        reader.readAsText(file)
      }
    } else if (isTcx) {
      if (isGzipped) {
        try {
          const text = await decompressGzip(file)
          const result = parseTcxData(text, minimumDistanceThreshold, minimumGainThreshold, maximumGainThreshold)

          if (!result) {
            alert("Failed to parse TCX file. Please ensure it contains valid trackpoint data.")
            return
          }

          const { totalDistance, totalElevationGain, coords, totalDuration } = result
          setGpxData({
            coords: coords,
            totalDuration,
            totalDistance,
            totalElevation: totalElevationGain,
          })
        } catch (error) {
          console.error("Failed to decompress file:", error)
          alert("Failed to decompress .gz file. Please ensure it is a valid gzip file.")
        }
      } else {
        reader.onload = () => {
          const text = reader.result as string
          const result = parseTcxData(text, minimumDistanceThreshold, minimumGainThreshold, maximumGainThreshold)

          if (!result) {
            alert("Failed to parse TCX file. Please ensure it contains valid trackpoint data.")
            return
          }

          const { totalDistance, totalElevationGain, coords, totalDuration } = result
          setGpxData({
            coords: coords,
            totalDuration,
            totalDistance,
            totalElevation: totalElevationGain,
          })
        }
        reader.readAsText(file)
      }
    } else if (isFit) {
      if (isGzipped) {
        try {
          const bytes = await decompressGzipToArrayBuffer(file)
          const result = await parseFitData(bytes, minimumDistanceThreshold, minimumGainThreshold, maximumGainThreshold)

          if (!result) {
            alert("Failed to parse FIT file. Please ensure it contains valid record data.")
            return
          }

          const { totalDistance, totalElevationGain, coords, totalDuration } = result
          setGpxData({
            coords: coords,
            totalDuration,
            totalDistance,
            totalElevation: totalElevationGain,
          })
        } catch (error) {
          console.error("Failed to decompress file:", error)
          alert("Failed to decompress .gz file. Please ensure it is a valid gzip file.")
        }
      } else {
        try {
          const bytes = await file.arrayBuffer()
          const result = await parseFitData(bytes, minimumDistanceThreshold, minimumGainThreshold, maximumGainThreshold)

          if (!result) {
            alert("Failed to parse FIT file. Please ensure it contains valid record data.")
            return
          }

          const { totalDistance, totalElevationGain, coords, totalDuration } = result
          setGpxData({
            coords: coords,
            totalDuration,
            totalDistance,
            totalElevation: totalElevationGain,
          })
        } catch (error) {
          console.error("FIT parse error:", error)
          alert("Failed to parse FIT file.")
        }
      }
    } else {
      alert("Unsupported file type. Please upload a .gpx, .tcx, .fit, .gpx.gz, .tcx.gz, or .fit.gz file.")
    }
  }

  const processMediaFile = async (file: File) => {
    setSelectedFile(file)
    const fileType = file.type

    if (fileType.startsWith("image/")) {
      const encoded = encodeBlobWithMime(await file.arrayBuffer(), fileType)
      setImageData((prev) => [...prev, encoded])
    } else {
      alert("Unsupported file type. Please upload an image.")
    }
  }

  const handleInputChangeGpx = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      await processGpxFile(file)
    }
  }

  const handleDropGpx = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const file = e.dataTransfer.files?.[0]
    if (file) {
      await processGpxFile(file)
    }
  }

  const handleInputChangeMedia = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      await processMediaFile(file)
    }
  }

  const handleDropMedia = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const file = e.dataTransfer.files?.[0]
    if (file) {
      processMediaFile(file)
    }
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleUpload = async () => {
    if (!selectedFile) return

    const content = encodeRoute(gpxData!.coords)
    const ls = await makeStore(user.id)
    const rs = createRemoteStore(createContentClient("/storage", user.token))

    const blob = await renderRouteThumbnail(gpxData!.coords)

    const thumb = encodeBlobWithMime(await blob.arrayBuffer(), blob.type)

    const [newGroup, newPostManifestPage, newPostManifest, newManifest] = await createPost(
      content,
      {
        elevation: gpxData!.totalElevation,
        duration: gpxData!.totalDuration,
        distance: gpxData!.totalDistance,
      },
      title,
      thumb,
      imageData,
      Date.now(),
      description,
      postType,
      gear || undefined,
      user.id,
      user.currentPage,
      user.postManifest,
      user.ownGroupState,
      user.manifest,
      base64urlToUint8(user.manifestId),
      ls,
      rs,
      null as any as MessageClient,
      await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519")),
      user.masterKey,
    )

    updateUser({
      currentPage: newPostManifestPage,
      postManifest: newPostManifest,
      manifest: newManifest,
      ownGroupState: newGroup,
    })

    nav("/")
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-8 mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-3xl font-bold text-gray-900">Upload an Activity</h2>
              <p className="text-gray-600 mt-1">Share your single activity with details and photos</p>
            </div>
            <Link
              to="/bulkImport"
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              Bulk Import
            </Link>
          </div>

          <div className="mb-8">
            <label className="block text-sm font-medium text-gray-700 mb-2">Activity Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Morning Trail Run"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
            />
          </div>

          <div className="mb-8">
            <label className="block text-sm font-medium text-gray-700 mb-2">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Notes about conditions, effort, or highlights"
              rows={4}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition resize-none"
            />
          </div>

          <div className="mb-8">
            <label className="block text-sm font-medium text-gray-700 mb-2">Activity Type</label>
            <select
              value={postType}
              onChange={(e) => setPostType(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition bg-white"
            >
              {postTypeOptions.map(({ value, emoji }) => (
                <option key={value} value={value}>
                  {`${emoji} ${value}`}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-8">
            <label className="block text-sm font-medium text-gray-700 mb-2">Gear (optional)</label>
            <input
              type="text"
              value={gear}
              onChange={(e) => setGear(e.target.value)}
              placeholder="e.g., Canyon Endurace CF SLX"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
            />
          </div>

          <div className="space-y-6">
            {/* GPX Upload */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">1. Upload GPX, TCX, or FIT File</h3>
              <div
                onDrop={handleDropGpx}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  isDragging ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-gray-50 hover:bg-gray-100"
                }`}
              >
                <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                  <path
                    d="M28 8H12a4 4 0 00-4 4v20a4 4 0 004 4h24a4 4 0 004-4V20m-14-6l-4-4m0 0l-4 4m4-4v12m10-8h6m-6 4h6"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <p className="mt-2 text-gray-700">
                  {isDragging
                    ? "📍 Drop your GPX, TCX, or FIT file here"
                    : "Drag & drop your .gpx, .tcx, .fit, .gpx.gz, .tcx.gz, or .fit.gz file or"}
                </p>
                <input
                  type="file"
                  accept=".gpx,.tcx,.fit,.gz"
                  onChange={handleInputChangeGpx}
                  className="hidden"
                  id="fileInputGpx"
                />
                <label
                  htmlFor="fileInputGpx"
                  className="inline-block mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg cursor-pointer transition-colors"
                >
                  Browse Files
                </label>
              </div>
            </div>

            {/* Preview Section */}
            {gpxData && (
              <div className="border border-gray-200 rounded-lg p-6 bg-gray-50">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Activity Preview</h3>
                <div ref={ref} className="mb-4 rounded-lg overflow-hidden border border-gray-200">
                  <MapLibreRouteMap route={gpxData.coords} showMarkers />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white p-4 rounded-lg border border-gray-200">
                    <div className="text-sm text-gray-600 mb-1">Duration</div>
                    <div className="text-2xl font-bold text-blue-600">
                      {(gpxData.totalDuration / 3600000).toFixed(1)} hrs
                    </div>
                  </div>
                  <div className="bg-white p-4 rounded-lg border border-gray-200">
                    <div className="text-sm text-gray-600 mb-1">Elevation</div>
                    <div className="text-2xl font-bold text-green-600">{Math.round(gpxData.totalElevation)} m</div>
                  </div>
                  <div className="bg-white p-4 rounded-lg border border-gray-200">
                    <div className="text-sm text-gray-600 mb-1">Distance</div>
                    <div className="text-2xl font-bold text-purple-600">
                      {(gpxData.totalDistance / 1000).toFixed(1)} km
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Media Upload */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">2. Upload Photos (Optional)</h3>
              <div
                onDrop={handleDropMedia}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  isDragging ? "border-green-500 bg-green-50" : "border-gray-300 bg-gray-50 hover:bg-gray-100"
                }`}
              >
                <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                  <path
                    d="M28 8H12a4 4 0 00-4 4v20a4 4 0 004 4h24a4 4 0 004-4V20m0-12h.01M17 29l4-4 6 6 8-8"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <p className="mt-2 text-gray-700">
                  {isDragging ? "🖼️ Drop your photos here" : "Drag & drop photos or"}
                </p>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={handleInputChangeMedia}
                  className="hidden"
                  id="fileInputMedia"
                />
                <label
                  htmlFor="fileInputMedia"
                  className="inline-block mt-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg cursor-pointer transition-colors"
                >
                  Browse Files
                </label>
              </div>
            </div>

            {imageUrls.length > 0 && (
              <div className="border border-gray-200 rounded-lg p-6 bg-gray-50">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Photos ({imageUrls.length})</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {imageUrls.map((url, idx) => (
                    <div
                      key={idx}
                      className="aspect-square rounded-lg overflow-hidden border border-gray-200 shadow-sm hover:shadow-md transition"
                    >
                      <img src={url} alt={`Preview ${idx + 1}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Upload Button */}
            <button
              onClick={handleUpload}
              disabled={!selectedFile}
              className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
            >
              {selectedFile ? "Upload Activity" : "Select a file to continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FileUpload

export interface ParseResult {
  trackpoints: Element[]
  totalDistance: number
  totalElevationGain: number
  coords: [number, number, number][]
  totalDuration: number
}

export async function parseFitData(
  buffer: ArrayBuffer,
  minimumDistanceThreshold: number,
  minimumGainThreshold: number,
  maximumGainThreshold: number,
): Promise<ParseResult | undefined> {
  const fitParser = new FitParser({
    force: true,
    speedUnit: "m/s",
    lengthUnit: "m",
    temperatureUnit: "celsius",
    elapsedRecordField: true,
  })

  minimumGainThreshold = 6

  const data = await fitParser.parseAsync(buffer)

  if (!Array.isArray(data.records)) return undefined

  const coords: [number, number, number][] = []
  const distances: number[] = []
  const timestamps: (Date | undefined)[] = []
  let maxElevation: number = 0

  for (const record of data.records) {
    if (record.position_lat == null || record.position_long == null) continue
    const lat = record.position_lat
    const lon = record.position_long
    const ele =
      typeof record.enhanced_altitude === "number"
        ? record.enhanced_altitude
        : typeof record.altitude === "number"
          ? record.altitude
          : 0

    if (ele > maxElevation) {
      maxElevation = ele
    }

    coords.push([lat, lon, ele])
    distances.push(typeof record.distance === "number" ? record.distance : NaN)
    timestamps.push(new Date(record.timestamp))
  }

  if (coords.length < 2) return undefined

  let totalDistance = 0
  let totalElevationGain = 0

  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1]!
    const curr = coords[i]!

    const prevDist = distances[i - 1]!
    const currDist = distances[i]!

    let distanceDelta: number
    if (!isNaN(prevDist) && !isNaN(currDist) && currDist >= prevDist) {
      distanceDelta = currDist - prevDist
    } else {
      distanceDelta = haversine(prev[0], prev[1], curr[0], curr[1])
    }

    if (distanceDelta > minimumDistanceThreshold) totalDistance += distanceDelta

    const deltaEle = curr[2] - prev[2]
    if (deltaEle > minimumGainThreshold && deltaEle < maximumGainThreshold) totalElevationGain += deltaEle
  }

  const firstTs = timestamps[0]
  const lastTs = timestamps[timestamps.length - 1]
  const totalDuration = firstTs && lastTs ? lastTs.getTime() - firstTs.getTime() : 0

  return {
    trackpoints: [],
    totalDistance,
    totalElevationGain,
    coords,
    totalDuration,
  }
}

export function parseGpxData(
  text: string,
  minimumDistanceThreshold: number,
  minimumGainThreshold: number,
  maximumGainThreshold: number,
): ParseResult | undefined {
  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(text, "application/xml")

  const trackpoints = Array.from(xmlDoc.getElementsByTagName("trkpt"))

  function parse(pt: Element): [number, number, number] {
    return [
      parseFloat(pt.getAttribute("lat") || ""),
      parseFloat(pt.getAttribute("lon") || ""),
      parseFloat(pt.getElementsByTagName("ele").item(0)!.innerHTML || ""),
      //Date.parse(pt.getElementsByTagName("time").item(0)!.innerHTML || ''),
    ]
  }

  const coords: [number, number, number][] = Array(trackpoints.length)

  if (!trackpoints || !trackpoints[0] || !trackpoints[1]) return undefined
  coords[0] = parse(trackpoints[0])
  let totalDistance = 0
  let totalElevationGain = 0
  let maxElevation = 0

  for (let i = 1; i < trackpoints.length; i++) {
    const prev = coords[i - 1]!
    const curr = parse(trackpoints[i]!)
    coords[i] = curr
    const distanceDelta = haversine(prev[0], prev[1], curr[0], curr[1])
    if (distanceDelta > minimumDistanceThreshold) {
      totalDistance += haversine(prev[0], prev[1], curr[0], curr[1])
    }
    const delta = curr[2] - prev[2]

    if (curr[2] > maxElevation) {
      maxElevation = curr[2]
    }
    if (delta > minimumGainThreshold && delta < maximumGainThreshold) totalElevationGain += delta
  }

  const totalDuration =
    Date.parse(trackpoints[trackpoints.length - 1]!.getElementsByTagName("time").item(0)!.innerHTML || "") -
    Date.parse(trackpoints[0].getElementsByTagName("time").item(0)!.innerHTML || "")
  return {
    trackpoints,
    totalDistance,
    totalElevationGain,
    coords,
    totalDuration,
  }
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180)
}

// Haversine distance in meters
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000 // Earth's radius in meters
  const φ1 = toRadians(lat1)
  const φ2 = toRadians(lat2)
  const Δφ = toRadians(lat2 - lat1)
  const Δλ = toRadians(lon2 - lon1)

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export function parseTcxData(
  text: string,
  minimumDistanceThreshold: number,
  minimumGainThreshold: number,
  maximumGainThreshold: number,
): ParseResult | undefined {
  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(text.trim(), "application/xml")

  // Check for parse errors
  const parserError = xmlDoc.getElementsByTagName("parsererror")
  if (parserError.length > 0) {
    console.error("TCX XML parsing error:", parserError[0]!.textContent)
    return undefined
  }

  const trackpoints = Array.from(xmlDoc.getElementsByTagName("Trackpoint"))

  if (!trackpoints || trackpoints.length < 2) {
    console.error("TCX file must contain at least 2 trackpoints. Found:", trackpoints.length)
    return undefined
  }

  function parse(pt: Element): [number, number, number] | null {
    const position = pt.getElementsByTagName("Position")[0]
    const latElement = position?.getElementsByTagName("LatitudeDegrees")[0]
    const lonElement = position?.getElementsByTagName("LongitudeDegrees")[0]
    const eleElement = pt.getElementsByTagName("AltitudeMeters")[0]

    const lat = parseFloat(latElement?.textContent || "")
    const lon = parseFloat(lonElement?.textContent || "")
    const ele = parseFloat(eleElement?.textContent || "0")

    if (isNaN(lat) || isNaN(lon)) {
      return null
    }

    return [lat, lon, isNaN(ele) ? 0 : ele]
  }

  const coords: [number, number, number][] = []

  for (let i = 0; i < trackpoints.length; i++) {
    const parsed = parse(trackpoints[i]!)
    if (parsed) {
      coords.push(parsed)
    }
  }

  if (coords.length < 2) {
    console.error("Not enough valid coordinates found in TCX file. Found:", coords.length)
    return undefined
  }

  let totalDistance = 0
  let totalElevationGain = 0

  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1]!
    const curr = coords[i]!
    const distanceDelta = haversine(prev[0], prev[1], curr[0], curr[1])
    if (distanceDelta > minimumDistanceThreshold) {
      totalDistance += distanceDelta
    }
    const delta = curr[2] - prev[2]
    if (delta > minimumGainThreshold && delta < maximumGainThreshold) totalElevationGain += delta
  }

  const firstTime = trackpoints[0]!.getElementsByTagName("Time")[0]?.textContent
  const lastTime = trackpoints[trackpoints.length - 1]!.getElementsByTagName("Time")[0]?.textContent

  const totalDuration = firstTime && lastTime ? Date.parse(lastTime) - Date.parse(firstTime) : 0

  return {
    trackpoints,
    totalDistance,
    totalElevationGain,
    coords,
    totalDuration,
  }
}
