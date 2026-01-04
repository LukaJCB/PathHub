import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router"
import { PostLocatorEntry } from "pathhub-client/src/manifest.js"
import { getPostLocatorAndMaps, getWordIndex, searchByTitle, tokenizeTitle } from "pathhub-client/src/indexing.js"
import { getPostTypeEmoji, getGearEmoji } from "./postTypeEmojis"
import { createRemoteStore } from "pathhub-client/src/remoteStore.js"
import { createContentClient } from "pathhub-client/src/http/storageClient.js"
import { useAuthRequired } from "./useAuth"

interface SearchResult {
  id: string
  entry: PostLocatorEntry
}

export const SearchView: React.FC = () => {
  const { user } = useAuthRequired()
  const [wordIndex, setWordIndex] = useState<Map<string, string[]> | null>(null)
  const [postLocator, setPostLocator] = useState<Map<string, PostLocatorEntry> | null>(null)
  const [typeMap, setTypeMap] = useState<Map<number, string> | null>(null)
  const [gearMap, setGearMap] = useState<Map<number, string> | null>(null)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const tokens = useMemo(() => tokenizeTitle(query), [query])

  const rs = useMemo(() => createRemoteStore(createContentClient("/storage", user.token)), [user.token])

  useEffect(() => {
    const loadIndexes = async () => {
      setInitializing(true)
      setError(null)
      try {
        const [wi, plAndMaps] = await Promise.all([
          getWordIndex(user.manifest, user.masterKey, rs),
          getPostLocatorAndMaps(user.manifest, user.masterKey, rs)
        ])
        const [pl, tm, gm] = plAndMaps
        setWordIndex(wi)
        setPostLocator(pl)
        setTypeMap(tm)
        setGearMap(gm)
      } catch (err) {
        console.error(err)
        setError("Unable to load search indexes. Please try again.")
      } finally {
        setInitializing(false)
      }
    }
    loadIndexes()
  }, [rs, user.manifest, user.masterKey])

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault()
    if (!wordIndex || !postLocator) return

    setLoading(true)

    const matches = searchByTitle(wordIndex, postLocator, query)
    const normalized: SearchResult[] = matches
      .map(([entry, id]) => ({ id, entry }))
      .sort((a, b) => b.entry.date - a.entry.date)

    setResults(normalized)
    setLoading(false)
  }

  const isReady = !initializing && wordIndex && postLocator && typeMap && gearMap

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white/90 backdrop-blur rounded-3xl shadow-lg border border-indigo-50 p-6 sm:p-8 mb-10">
          <div className="flex items-start justify-between gap-4 flex-col sm:flex-row sm:items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Search Posts</h1>
              <p className="text-gray-600 mt-2">Search your posts by title and jump straight to the matching entry.</p>
            </div>
            <div className="text-sm text-gray-500 bg-indigo-50 text-indigo-700 px-3 py-2 rounded-lg border border-indigo-100">
              {isReady ? "Indexes loaded" : "Loading indexes..."}
            </div>
          </div>

          <form onSubmit={handleSearch} className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="relative">
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search titles (e.g., sunrise run)"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              {tokens.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-600">
                  {tokens.map(token => (
                    <span key={token} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                      {token}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={!isReady || loading}
              className="h-full px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl shadow hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Searching..." : "Search"}
            </button>
          </form>

          {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
        </div>

        <div className="space-y-4">
          {loading && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-gray-500">Searching…</div>
          )}

          {results.length === 0 && isReady && !loading && (
            <div className="bg-white rounded-2xl p-6 text-gray-500 shadow-sm border border-gray-100">No results yet. Try another title.</div>
          )}

          {results.map(({ id, entry }) => {
            const typeName = entry.typeId ? typeMap?.get(entry.typeId) : undefined
            const gearName = entry.gearId ? gearMap?.get(entry.gearId) : undefined
            return (
            <Link
              key={id}
              to={`/user/${user.id}/${entry.pageIndex}/${id}`}
              className="block bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow p-5 border border-gray-100"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 leading-tight">{entry.title}</h2>
                  {(gearName || typeName) && (
                    <div className="flex items-center gap-2 text-sm text-gray-700 mt-2">
                      {typeName && (
                        <>
                          <span>{getPostTypeEmoji(typeName) || "✨"}</span>
                          <span className="font-medium text-gray-800">{typeName}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <span className="text-sm text-gray-500 whitespace-nowrap">{new Date(entry.date).toLocaleDateString()}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm text-gray-700">
                <div className="rounded-lg bg-indigo-50 px-3 py-2">
                  <div className="text-gray-500">Distance</div>
                  <div className="font-semibold text-indigo-700">{(entry.metrics.distance / 1000).toFixed(1)} km</div>
                </div>
                <div className="rounded-lg bg-blue-50 px-3 py-2">
                  <div className="text-gray-500">Elevation</div>
                  <div className="font-semibold text-blue-700">{Math.round(entry.metrics.elevation)} m</div>
                </div>
                <div className="rounded-lg bg-green-50 px-3 py-2">
                  <div className="text-gray-500">Duration</div>
                  <div className="font-semibold text-green-700">{(entry.metrics.duration / 3600000).toFixed(1)} h</div>
                </div>
                <div className="rounded-lg bg-amber-50 px-3 py-2">
                  <div className="text-gray-500">Gear</div>
                  <div className="font-semibold text-amber-700 text-xs break-all flex items-center gap-2">
                    <span role="img" aria-label="gear">{getGearEmoji(typeName)}</span>
                    <span>{gearName ?? "—"}</span>
                  </div>
                </div>
              </div>
            </Link>
          )})}
        </div>
      </div>
    </div>
  )
}
export default SearchView
