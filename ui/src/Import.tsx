import React, { useState } from "react";
import { ZipReader, BlobReader, BlobWriter, Entry } from "@zip.js/zip.js";
import Papa from 'papaparse'
import { parseTrackData } from "./FileUploader";
import { encode } from "cbor-x";
import { base64urlToUint8, createRemoteStore } from "pathhub-client/src/remoteStore.js";
import { createContentClient } from "pathhub-client/src/http/storageClient.js";
import { useAuthRequired } from "./useAuth";
import { createPost } from "pathhub-client/src/createPost.js";
import { makeStore } from "pathhub-client/src/indexedDbStore.js";
import { MessageClient } from "pathhub-client/src/http/messageClient.js";
import { getCiphersuiteFromName, getCiphersuiteImpl } from "ts-mls";
import { encodeRoute } from "pathhub-client/src/codec/encode.js";
import { decodeBlobWithMime, encodeBlobWithMime } from "pathhub-client/src/imageEncoding.js";
import { ThumbnailRenderer } from "./ThumbnailRenderer";
import { Link } from "react-router";

export interface ActivityRecord {
  "Activity Count": string;
  "Activity Date": string;
  "Activity Description": string;
  "Activity Gear": string;
  "Activity ID": string;
  "Activity Name": string;
  "Activity Private Note": string;
  "Activity Type": string;
  "Apparent Temperature": string;
  "Athlete Weight": string;
  "Average Cadence": string;
  "Average Elapsed Speed": string;
  "Average Flow": string;
  "Average Grade": string;
  "Average Grade Adjusted Pace": string;
  "Average Heart Rate": string;
  "Average Negative Grade": string;
  "Average Positive Grade": string;
  "Average Speed": string;
  "Average Temperature": string;
  "Average Watts": string;
  Bike: string;
  "Bike Weight": string;
  Calories: string;
  "Carbon Saved": string;
  "Cloud Cover": string;
  Commute: string;
  Commute_1: string;
  Competition: string;
  Dewpoint: string;
  "Dirt Distance": string;
  Distance: string;
  Distance_1: string;
  "Downhill Time": string;
  "Elapsed Time": string;
  "Elapsed Time_1": string;
  "Elevation Gain": string;
  "Elevation High": string;
  "Elevation Loss": string;
  "Elevation Low": string;
  Filename: string;
  Flagged: string;
  "For a Cause": string;
  "From Upload": string;
  Gear: string;
  "Grade Adjusted Distance": string;
  Humidity: string;
  Intensity: string;
  "Jump Count": string;
  "Long Run": string;
  "Max Cadence": string;
  "Max Grade": string;
  "Max Heart Rate": string;
  "Max Heart Rate_1": string;
  "Max Speed": string;
  "Max Temperature": string;
  "Max Watts": string;
  Media: string;
  "Moon Phase": string;
  "Moving Time": string;
  "Newly Explored Dirt Distance": string;
  "Newly Explored Distance": string;
  "Number of Runs": string;
  "Other Time": string;
  "Perceived Exertion": string;
  "Perceived Relative Effort": string;
  "Pool Length": string;
  "Power Count": string;
  "Precipitation Intensity": string;
  "Precipitation Probability": string;
  "Precipitation Type": string;
  "Prefer Perceived Exertion": string;
  Recovery: string;
  "Relative Effort": string;
  "Relative Effort_1": string;
  "Start Time": string;
  "Sunrise Time": string;
  "Sunset Time": string;
  "Timer Time": string;
  "Total Cycles": string;
  "Total Grit": string;
  "Total Steps": string;
  "Total Weight Lifted": string;
  "Total Work": string;
  "Training Load": string;
  Type: string;
  "UV Index": string;
  "Uphill Time": string;
  "Weather Condition": string;
  "Weather Observation Time": string;
  "Weather Ozone": string;
  "Weather Pressure": string;
  "Weather Temperature": string;
  "Weather Visibility": string;
  "Weighted Average Power": string;
  "Wind Bearing": string;
  "Wind Gust": string;
  "Wind Speed": string;
  "With Pet": string;
}



export function BulkImport() {
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0)
  const {user, updateUser} = useAuthRequired()
  const [isDragging, setIsDragging] = useState(false);

  const handleDropZip = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0]
    if (!file) return;
    await processZip(file)
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    await processZip(file)
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  

  async function processZip(file: File) {
    // Open the zip
    const zipReader = new ZipReader(new BlobReader(file));
    const entries = await zipReader.getEntries();

    setProgress(0);

    const activities = entries.find(e => e.filename === 'activities.csv')
    if (activities === undefined || activities.directory === true) return;


    const blob = await activities.getData(new BlobWriter("text/csv"))
    const text = await blob.text();
    const result = Papa.parse<ActivityRecord>(text, { header: true }).data
    setTotal(result.length)

    const activityMap: Record<string, Entry> = entries.reduce((acc, cur) => {
        if (cur.filename.startsWith("activities/")) {
            const x = {...acc, [cur.filename]: cur}
            return x
        } else return acc} ,{})

    const mediaMap: Record<string, Entry> = entries.reduce((acc, cur) => {
        if (cur.filename.startsWith("media/")) {
            const x = {...acc, [cur.filename]: cur}
            return x
        } else return acc} ,{})

    const ls = await makeStore(user.id)
    const rs = createRemoteStore(createContentClient("/storage", user.token))
    const thumbRenderer = new ThumbnailRenderer()
    let currentPage = user.currentPage
    let currentPostManifest = user.postManifest
    let currentManifest = user.manifest
    let currentGroup = user.ownGroupState
    for (const [n, record] of result.slice(0, 4).entries()) {
        
        if (!record.Filename || record.Filename === "#error#") {
            continue;
        }
        const entry = activityMap[record.Filename]
        if (entry.directory === true) throw new Error("No good")

        if (!entry.filename.endsWith(".gpx")) {
            continue;
        }
        const mediaUrls: string[] = record.Media.split("|")

        const media: Uint8Array[] = []
        for (const url of mediaUrls) {
          if (!url) {
            continue;
          }
          if (!url.endsWith(".jpg")) {
            console.log("found non jpg url", url)
            continue;
          }
          const e = mediaMap[url]
          if (e.directory === true) throw new Error("Not good at all")

          const b = await e.getData(new BlobWriter("image/jpeg"))
          media.push(encodeBlobWithMime(await b.arrayBuffer(), "image/jpeg"))
        }

        const date = new Date(record["Activity Date"]).getTime()

        const blob = await entry.getData(new BlobWriter("application/xml"))
        const text = await blob.text()

        const parsed = parseTrackData(text, 3, 0.09)

        if (!parsed) {
            continue;
        }

        const content = encodeRoute(parsed.coords)

        const blobThumb = await thumbRenderer.render(parsed.coords)
        
        const thumb = encodeBlobWithMime(await blobThumb.arrayBuffer(), blobThumb.type)

        const [newGroup, newPage, newPostManifest, newManifest] = await createPost(content, 
              {elevation: parsed.totalElevationGain, duration: parsed.totalDuration, distance: parsed.totalDistance},
              record["Activity Name"],
              thumb,
              media,
              date,
              user.id,
              currentPage,
              currentPostManifest,
              user.ownGroupState,
              currentManifest,
              base64urlToUint8(user.manifestId),
              ls,
              rs,
              null as any as MessageClient,
              await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519")),
              user.masterKey
            )
        currentPage = newPage
        currentPostManifest = newPostManifest
        currentManifest = newManifest
        currentGroup = newGroup

        setProgress(n + 1)
    }
    thumbRenderer.destroy()
    updateUser({currentPage: currentPage, postManifest: currentPostManifest, manifest: currentManifest, ownGroupState: currentGroup})
    setProgress(result.length)

    await zipReader.close();
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Bulk Import Activities</h2>
          
          <div className="mb-8">
            <p className="text-gray-600 mb-4">Import multiple activities at once from a Strava export ZIP file.</p>
            
            <div 
              onDrop={handleDropZip}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 hover:bg-blue-50 transition-colors ${
                  isDragging 
                    ? 'border-blue-500 bg-blue-50' 
                    : 'border-gray-300 bg-gray-50 hover:bg-gray-100'
                }`}
              >
              <svg className="mx-auto h-12 w-12 text-gray-400 mb-3" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                <path d="M28 8H12a4 4 0 00-4 4v20a4 4 0 004 4h24a4 4 0 004-4V20m-14-6l-4-4m0 0l-4 4m4-4v12m10-8h6m-6 4h6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="text-gray-700 mb-4">Drop your Strava export ZIP file here or click to select</p>
              <input 
                type="file" 
                accept=".zip" 
                onChange={handleFile}
                className="hidden"
                id="zipInput"
              />
              <label 
                htmlFor="zipInput"
                className="inline-block px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg cursor-pointer transition-colors"
              >
                Browse Files
              </label>
            </div>
          </div>

          {total > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Import Progress</h3>
              
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Processing activities...</span>
                  <span className="text-sm font-bold text-blue-600">{progress} / {total}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-blue-500 to-blue-600 h-full transition-all duration-300 ease-out"
                    style={{ width: `${(progress / total) * 100}%` }}
                  ></div>
                </div>
              </div>

              {progress === total && total > 0 && (
                
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                  <Link to={`/user/${user.id}/0`}><p className="text-green-700 font-semibold">✓ Successfully imported {total} activities!</p></Link>
                </div>
                
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
