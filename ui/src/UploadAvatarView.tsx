import { useEffect, useState } from "react";
import { useAuthRequired } from "./useAuth";
import { useNavigate, useParams } from "react-router";
import { createContentClient } from "pathhub-client/src/http/storageClient.js";
import { updateAvatar } from "pathhub-client/src/userInfo.js";
import { bytesToArrayBuffer } from "ts-mls/util/byteArray.js";

export const UploadAvatarView: React.FC = () => {
  const { user, updateUser } = useAuthRequired();
  const navigate = useNavigate();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(null);

  const storageClient = createContentClient("/storage", user.token);

  useEffect(() => {
    let revokable: string | null = null;
    (async () => {
        const res = await storageClient.getAvatar(user.id);
        if (!res) return;
        if (res.contentType === "image/svg+xml") {
          const decoded = new TextDecoder().decode(res.body);
          setCurrentAvatarUrl(`data:image/svg+xml;utf8,${encodeURIComponent(decoded)}`);
        } else if (res.contentType === "image/png" || res.contentType === "image/jpeg") {
          const blob = new Blob([bytesToArrayBuffer(res.body)], { type: res.contentType });
          const url = URL.createObjectURL(blob);
          setCurrentAvatarUrl(url);
          revokable = url;
        }
      
    })();
    return () => {
      if (revokable) URL.revokeObjectURL(revokable);
    };
  }, []);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (f) setPreviewUrl(URL.createObjectURL(f));
  }

  async function onUpload() {
    if (!file) {
      setError("Please select an image file");
      return;
    }
    const allowed = ["image/png", "image/jpeg", "image/svg+xml"];
    if (!allowed.includes(file.type)) {
      setError("Unsupported type. Use PNG, JPEG, or SVG.");
      return;
    }
    setIsUploading(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      await updateAvatar(buf, file.type as "image/png" | "image/jpeg" | "image/svg+xml", storageClient);
      const existingAvatarUrl = user.avatarUrl
      updateUser({avatarUrl: previewUrl})

      URL.revokeObjectURL(existingAvatarUrl)
      setCurrentAvatarUrl(previewUrl)
      setFile(null)
      setPreviewUrl(null)
    } catch (e: any) {
      setError(e?.message || "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-md p-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Update Profile Picture</h2>
        <div className="mb-6 bg-indigo-50 border border-indigo-200 rounded-lg p-4 flex items-center gap-4">
          {currentAvatarUrl ? (
            <img src={currentAvatarUrl} alt="Current avatar" className="w-16 h-16 rounded-full object-cover ring-2 ring-indigo-100" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-indigo-200 text-indigo-700 flex items-center justify-center font-semibold">
              {user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
            </div>
          )}
          <div>
            <div className="text-sm font-semibold text-indigo-700">You're editing your profile picture</div>
            <div className="text-xs text-indigo-700/80">This will replace your current avatar across the app.</div>
          </div>
        </div>
        <p className="text-gray-600 mb-6">PNG, JPEG, or SVG. A square image looks best. Note this image will be stored unencrypted and publically available.</p>

        {previewUrl ? (
          <div className="mb-6">
            <div className="flex items-center gap-6">
              <img src={previewUrl} alt="Preview" className="w-28 h-28 rounded-full object-cover ring-2 ring-indigo-100" />
              <button onClick={() => { setPreviewUrl(null); setFile(null); }} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Remove</button>
            </div>
          </div>
        ) : (
          <div 
            className="mb-6 border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-indigo-400 transition-colors"
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation();
              const f = e.dataTransfer.files?.[0];
              if (!f) return;
              const allowed = ["image/png", "image/jpeg", "image/svg+xml"];
              if (!allowed.includes(f.type)) {
                setError("Unsupported type. Use PNG, JPEG, or SVG.");
                return;
              }
              setFile(f);
              if (previewUrl) URL.revokeObjectURL(previewUrl);
              setPreviewUrl(URL.createObjectURL(f));
            }}
          >
            <p className="text-gray-600 mb-4">Drag & drop your image here</p>
            <p className="text-xs text-gray-500 mb-4">PNG, JPEG, or SVG. A square image looks best.</p>
            <label className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors cursor-pointer">
              Choose File
              <input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={onFileChange} className="hidden" />
            </label>
          </div>
        )}

        {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

        <div className="flex gap-3">
          <button 
            onClick={onUpload}
            disabled={!file || isUploading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-lg transition-colors"
          >
            {isUploading ? "Uploading..." : "Save Avatar"}
          </button>
          <button onClick={() => navigate(-1)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default UploadAvatarView;