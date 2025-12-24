import React, { useState, ChangeEvent, DragEvent, useEffect, useRef } from 'react';
import LeafletRouteMap from './LeafleftMapView';
import { useAuthRequired } from './useAuth';
import { createPost} from 'pathhub-client/src/createPost.js'
import { makeStore } from 'pathhub-client/src/indexedDbStore.js';
import { encodeRoute } from 'pathhub-client/src/codec/encode.js';
import { MessageClient } from 'pathhub-client/src/http/messageClient.js';
import { getCiphersuiteFromName, getCiphersuiteImpl } from 'ts-mls';
import { useNavigate } from 'react-router';
import { base64urlToUint8, createRemoteStore } from 'pathhub-client/src/remoteStore.js';
import {decodeBlobWithMime, encodeBlobWithMime} from "pathhub-client/src/imageEncoding.js"
import { createContentClient, StorageClient } from 'pathhub-client/src/http/storageClient.js';
import { domToBlob } from "modern-screenshot"
import MapLibreRouteMap from './MapLibreView';
import {renderRouteThumbnail} from "./ThumbnailRenderer"

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
    const fileType = file.type;
    const reader = new FileReader();

    if (file.name.endsWith('.gpx')) {
      reader.onload = () => {
        const text = reader.result as string;
        const { trackpoints, totalDistance, totalElevationGain, coords, totalDuration } = parseTrackData(text, minimumDistanceThreshold, minimumGainThreshold)!;

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
    const rs = await createRemoteStore(createContentClient("/storage", user.token))

    const blob = await renderRouteThumbnail(gpxData!.coords)

    const thumb = encodeBlobWithMime(await blob.arrayBuffer(), blob.type)

    const [newGroup, newPostManifest, newManifest] = await createPost(content, 
      {elevation: gpxData!.totalElevation, duration: gpxData!.totalDuration, distance: gpxData!.totalDistance},
      title,
      thumb,
      imageData,
      Date.now(),
      user.id,
      user.currentManifest,
      user.manifest.currentPostManifest,
      user.ownGroupState,
      user.manifest,
      base64urlToUint8(user.manifestId),
      ls,
      rs,
      null as any as MessageClient,
      await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519")),
      user.masterKey
    )

    updateUser({currentManifest: newPostManifest, manifest: newManifest, ownGroupState: newGroup})

    nav("/")
  };

  return (
    <div>
      <h2>Upload a .gpx</h2>
      <label>Title: </label>
        <input
          type="text" 
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      
      <div
        onDrop={handleDropGpx}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        style={{
          border: '2px dashed #ccc',
          padding: '2rem',
          marginBottom: '1rem',
          textAlign: 'center',
          backgroundColor: isDragging ? '#f0f8ff' : '#fafafa',
          transition: 'background-color 0.2s ease',
        }}
      >

        {isDragging ? 'Drop the .gpx file here...' : 'Drag & drop a .gpx file here or click to select'}
        <input
          type="file"
          accept=".gpx"
          onChange={handleInputChangeGpx}
          style={{ display: 'none' }}
          id="fileInputGpx"
        />
        <label htmlFor="fileInputGpx" style={{ display: 'block', marginTop: '1rem', cursor: 'pointer', color: '#007bff' }}>
          Browse Files
        </label>
      </div>
      <div 
        onDrop={handleDropMedia}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        style={{
          border: '2px dashed #ccc',
          padding: '2rem',
          marginBottom: '1rem',
          textAlign: 'center',
          backgroundColor: isDragging ? '#f0f8ff' : '#fafafa',
          transition: 'background-color 0.2s ease',
        }}>
        {isDragging ? 'Drop media files here...' : 'Drag & drop media files here or click to select'}
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={handleInputChangeMedia}
          style={{ display: 'none' }}
          id="fileInputMedia"
        />
        <label htmlFor="fileInputMedia" style={{ display: 'block', marginTop: '1rem', cursor: 'pointer', color: '#007bff' }}>
          Browse Files
        </label>
      </div>
      {gpxData && (
        <div>
          <h3>Activity Preview</h3>
            <div ref={ref}>
              <MapLibreRouteMap route={gpxData.coords} showMarkers/>
            </div>
            <div>Duration: {gpxData.totalDuration / 3600000} hours</div>
            <div>Elevation: {gpxData.totalElevation} meters</div>
            <div>Distance: {gpxData.totalDistance / 1000} kilometers</div>
        </div>
      )}

      {imageUrls && (
        <div>
          <h3>Image Preview:</h3>
          <ul>
            {imageUrls.map((url, idx) => (
              <li key={idx}>
                <img src={url} style={{ maxWidth: '300px' }} />
              </li>
            ))}
          </ul>
          
        </div>
      )}

      <button onClick={handleUpload} disabled={!selectedFile}>
        Upload
      </button>
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
