import React, { useState, ChangeEvent, DragEvent, useEffect, useRef } from 'react';
import { useAuthRequired } from './useAuth';
import { createPost} from 'pathhub-client/src/createPost.js'
import { makeStore } from 'pathhub-client/src/indexedDbStore.js';
import { encodeRoute } from 'pathhub-client/src/codec/encode.js';
import { MessageClient } from 'pathhub-client/src/http/messageClient.js';
import { getCiphersuiteFromName, getCiphersuiteImpl } from 'ts-mls';
import { Link, useNavigate } from 'react-router';
import { base64urlToUint8, createRemoteStore } from 'pathhub-client/src/remoteStore.js';
import {decodeBlobWithMime, encodeBlobWithMime} from "pathhub-client/src/imageEncoding.js"
import { createContentClient } from 'pathhub-client/src/http/storageClient.js';
import MapLibreRouteMap from './MapLibreView';
import {renderRouteThumbnail} from "./ThumbnailRenderer"
import { postTypeOptions } from "./postTypeEmojis"

interface RouteData {
  coords: [number, number, number][]
  totalDistance: number,
  totalElevation: number,
  totalDuration: number
}

const FileUpload: React.FC = () => {
  const minimumDistanceThreshold = 3
  const minimumGainThreshold = 0.09

  const nav = useNavigate()

  const {user, updateUser} = useAuthRequired()
  const [gpxData, setGpxData] = useState<RouteData | null>(null);
  const [imageData, setImageData] = useState<Uint8Array[]>([]);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [title, setTitle] = useState("")
  const [postType, setPostType] = useState("Ride")
  const [gear, setGear] = useState("")
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    imageUrls.forEach(URL.revokeObjectURL);

    const urls = imageData.map((i) => {
      const { mimeType, bytes } = decodeBlobWithMime(i);
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType });
      return URL.createObjectURL(blob);
    });

    setImageUrls(urls);

    return () => {
      urls.forEach(URL.revokeObjectURL);
    };
  }, [imageData]);

  const processGpxFile = (file: File) => {
    setSelectedFile(file);
    const reader = new FileReader();

    if (file.name.endsWith('.gpx')) {
      reader.onload = () => {
        const text = reader.result as string;
        const { totalDistance, totalElevationGain, coords, totalDuration } = parseTrackData(text, minimumDistanceThreshold, minimumGainThreshold)!;

        setGpxData({ coords: coords, totalDuration, totalDistance, totalElevation: totalElevationGain});

      };
      reader.readAsText(file);
    } else {
      alert('Unsupported file type. Please upload a .gpx.');
    }
  };

  const processMediaFile = async (file: File) => {
    setSelectedFile(file);
    const fileType = file.type;

    if (fileType.startsWith('image/')) {
      const encoded = encodeBlobWithMime(await file.arrayBuffer(), fileType)
      setImageData(prev => [...prev, encoded]);
    } else {
      alert('Unsupported file type. Please upload an image.');
    }
  };


  const handleInputChangeGpx = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processGpxFile(file);
    }
  };

  const handleDropGpx = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      processGpxFile(file);
    }
  };

  const handleInputChangeMedia = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processMediaFile(file);
    }
  };

  const handleDropMedia = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      processMediaFile(file);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    const content = encodeRoute(gpxData!.coords)
    const ls = await makeStore(user.id)
    const rs = createRemoteStore(createContentClient("/storage", user.token))

    const blob = await renderRouteThumbnail(gpxData!.coords)

    const thumb = encodeBlobWithMime(await blob.arrayBuffer(), blob.type)

    const [newGroup, newPostManifestPage, newPostManifest, newManifest] = await createPost(content, 
      {elevation: gpxData!.totalElevation, duration: gpxData!.totalDuration, distance: gpxData!.totalDistance},
      title,
      thumb,
      imageData,
      Date.now(),
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
      user.masterKey
    )

    updateUser({currentPage: newPostManifestPage, postManifest: newPostManifest, manifest: newManifest, ownGroupState: newGroup})

    nav("/")
  };

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
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Activity Title
            </label>
            <input
              type="text" 
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Morning Trail Run"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
            />
          </div>

          <div className="mb-8">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Activity Type
            </label>
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
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Gear (optional)
            </label>
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
              <h3 className="text-lg font-semibold text-gray-900 mb-3">1. Upload GPX File</h3>
              <div
                onDrop={handleDropGpx}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  isDragging 
                    ? 'border-blue-500 bg-blue-50' 
                    : 'border-gray-300 bg-gray-50 hover:bg-gray-100'
                }`}
              >
                <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                  <path d="M28 8H12a4 4 0 00-4 4v20a4 4 0 004 4h24a4 4 0 004-4V20m-14-6l-4-4m0 0l-4 4m4-4v12m10-8h6m-6 4h6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <p className="mt-2 text-gray-700">
                  {isDragging ? '📍 Drop your GPX file here' : 'Drag & drop your .gpx file or'}
                </p>
                <input
                  type="file"
                  accept=".gpx"
                  onChange={handleInputChangeGpx}
                  className="hidden"
                  id="fileInputGpx"
                />
                <label htmlFor="fileInputGpx" className="inline-block mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg cursor-pointer transition-colors">
                  Browse Files
                </label>
              </div>
            </div>

            {/* Preview Section */}
            {gpxData && (
              <div className="border border-gray-200 rounded-lg p-6 bg-gray-50">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Activity Preview</h3>
                <div ref={ref} className="mb-4 rounded-lg overflow-hidden border border-gray-200">
                  <MapLibreRouteMap route={gpxData.coords} showMarkers/>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white p-4 rounded-lg border border-gray-200">
                    <div className="text-sm text-gray-600 mb-1">Duration</div>
                    <div className="text-2xl font-bold text-blue-600">{(gpxData.totalDuration / 3600000).toFixed(1)} hrs</div>
                  </div>
                  <div className="bg-white p-4 rounded-lg border border-gray-200">
                    <div className="text-sm text-gray-600 mb-1">Elevation</div>
                    <div className="text-2xl font-bold text-green-600">{Math.round(gpxData.totalElevation)} m</div>
                  </div>
                  <div className="bg-white p-4 rounded-lg border border-gray-200">
                    <div className="text-sm text-gray-600 mb-1">Distance</div>
                    <div className="text-2xl font-bold text-purple-600">{(gpxData.totalDistance / 1000).toFixed(1)} km</div>
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
                  isDragging 
                    ? 'border-green-500 bg-green-50' 
                    : 'border-gray-300 bg-gray-50 hover:bg-gray-100'
                }`}
              >
                <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                  <path d="M28 8H12a4 4 0 00-4 4v20a4 4 0 004 4h24a4 4 0 004-4V20m0-12h.01M17 29l4-4 6 6 8-8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <p className="mt-2 text-gray-700">
                  {isDragging ? '🖼️ Drop your photos here' : 'Drag & drop photos or'}
                </p>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={handleInputChangeMedia}
                  className="hidden"
                  id="fileInputMedia"
                />
                <label htmlFor="fileInputMedia" className="inline-block mt-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg cursor-pointer transition-colors">
                  Browse Files
                </label>
              </div>
            </div>

            {imageUrls.length > 0 && (
              <div className="border border-gray-200 rounded-lg p-6 bg-gray-50">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Photos ({imageUrls.length})</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {imageUrls.map((url, idx) => (
                    <div key={idx} className="aspect-square rounded-lg overflow-hidden border border-gray-200 shadow-sm hover:shadow-md transition">
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
              {selectedFile ? 'Upload Activity' : 'Select a GPX file to continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FileUpload;


export interface ParseResult { trackpoints: Element[]; totalDistance: number; totalElevationGain: number; coords: [number, number, number][]; totalDuration: number; }

export function parseTrackData(text: string, minimumDistanceThreshold: number, minimumGainThreshold: number): ParseResult | undefined {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(text, 'application/xml');

  const trackpoints = Array.from(xmlDoc.getElementsByTagName('trkpt'));

  function parse(pt: Element): [number, number, number] {
    return [
      parseFloat(pt.getAttribute('lat') || ''),
      parseFloat(pt.getAttribute('lon') || ''),
      parseFloat(pt.getElementsByTagName("ele").item(0)!.innerHTML || ''),
      //Date.parse(pt.getElementsByTagName("time").item(0)!.innerHTML || ''),
    ];
  }

  const coords: [number, number, number][] = Array(trackpoints.length);

  if (!trackpoints || !trackpoints[0] || !trackpoints[1]) return undefined
  coords[0] = parse(trackpoints[0]);
  let totalDistance = 0;
  let totalElevationGain = 0;

  for (let i = 1; i < trackpoints.length; i++) {
    const prev = coords[i - 1];
    const curr = parse(trackpoints[i]);
    coords[i] = curr;
    const distanceDelta = haversine(prev[0], prev[1], curr[0], curr[1]);
    if (distanceDelta > minimumDistanceThreshold) {
      totalDistance += haversine(prev[0], prev[1], curr[0], curr[1]);
    }
    const delta = curr[2] - prev[2];
    if (delta > minimumGainThreshold) totalElevationGain += delta;
  }

  const totalDuration = Date.parse(trackpoints[trackpoints.length - 1].getElementsByTagName("time").item(0)!.innerHTML || '') -
    Date.parse(trackpoints[0].getElementsByTagName("time").item(0)!.innerHTML || '');
  return { trackpoints, totalDistance, totalElevationGain, coords, totalDuration };
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

// Haversine distance in meters
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1);
  const Δλ = toRadians(lon2 - lon1);

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
