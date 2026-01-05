import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router"
import { IndexCollection, PostLocatorEntry, PostReference } from "pathhub-client/src/manifest.js"
import { getAllIndexes, searchByTitle, tokenizeTitle } from "pathhub-client/src/indexing.js"
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
  const [indexes, setIndexes] = useState<IndexCollection | null>(null)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<"date" | "distance" | "elevation" | "duration">("date")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set())
  const [selectedGears, setSelectedGears] = useState<Set<string>>(new Set())

  const tokens = useMemo(() => tokenizeTitle(query), [query])

  const rs = useMemo(() => createRemoteStore(createContentClient("/storage", user.token)), [user.token])

  const isReady = !initializing && indexes

  useEffect(() => {
    const loadIndexes = async () => {
      setInitializing(true)
      setError(null)
      try {
        //TODO maybe only load specific indexes when we need them?
        const allIndexes = await getAllIndexes(user.manifest, user.masterKey, rs)
        setIndexes(allIndexes)
      } catch (err) {
        console.error(err)
        setError("Unable to load search indexes. Please try again.")
      } finally {
        setInitializing(false)
      }
    }
    loadIndexes()
  }, [rs, user])

  useEffect(() => {
    if (isReady && results.length === 0 && !loading && query === "") {
      // sorted descending by date by sdefault
      const dateIndexResults: SearchResult[] = []
      for (const ref of indexes!.byDuration) {
        const entry = indexes!.postLocator.get(ref.postId)
        if (entry) {
          dateIndexResults.push({ id: ref.postId, entry })
        }
      }
      setResults(dateIndexResults.reverse())
    }
  }, [isReady, user.currentPage, results.length, loading, query, indexes])


  const sortedResults = useMemo(() => {
    if (!indexes) return results

    let sorted: SearchResult[] = []
    

    if (sortBy === "date") {

      sorted = [...results].sort((a, b) => a.entry.date - b.entry.date)
    } else if (sortBy === "distance") {

      const indexMap = new Map<string, number>()
      for (let i = 0; i < indexes.byDistance.length; i++) {
        indexMap.set(indexes.byDistance[i].postId, i)
      }
      sorted = [...results].sort((a, b) => {
        const indexA = indexMap.get(a.id) ?? Infinity
        const indexB = indexMap.get(b.id) ?? Infinity
        return indexA - indexB
      })
    } else if (sortBy === "elevation") {

      const indexMap = new Map<string, number>()
      for (let i = 0; i < indexes.byElevation.length; i++) {
        indexMap.set(indexes.byElevation[i].postId, i)
      }
      sorted = [...results].sort((a, b) => {
        const indexA = indexMap.get(a.id) ?? Infinity
        const indexB = indexMap.get(b.id) ?? Infinity
        return indexA - indexB
      })
    } else if (sortBy === "duration") {

      const indexMap = new Map<string, number>()
      for (let i = 0; i < indexes.byDuration.length; i++) {
        indexMap.set(indexes.byDuration[i].postId, i)
      }
      sorted = [...results].sort((a, b) => {
        const indexA = indexMap.get(a.id) ?? Infinity
        const indexB = indexMap.get(b.id) ?? Infinity
        return indexA - indexB
      })
    }

    return sortDirection === "asc" ? sorted : sorted.reverse()
  }, [results, sortBy, sortDirection, indexes])


  const availableTypes = useMemo(() => {
    if (!indexes) return []
    return Array.from(indexes.typeMap.values()).sort()
  }, [indexes])

  const availableGears = useMemo(() => {
    if (!indexes) return []
    return Array.from(indexes.gearMap.values()).sort()
  }, [indexes])


  const filteredResults = useMemo(() => {
    if (!indexes) return sortedResults


    if (selectedTypes.size === 0 && selectedGears.size === 0) {
      return sortedResults
    }


    let typeFilteredIds: Set<string> | null = null
    if (selectedTypes.size > 0) {
      typeFilteredIds = new Set<string>()
      for (const [typeId, typeName] of indexes.typeMap) {
        if (selectedTypes.has(typeName)) {
          const postIds = indexes.byType.get(typeId) || []
          postIds.forEach(id => typeFilteredIds!.add(id))
        }
      }
    }

    let gearFilteredIds: Set<string> | null = null
    if (selectedGears.size > 0) {
      gearFilteredIds = new Set<string>()
      for (const [gearId, gearName] of indexes.gearMap) {
        if (selectedGears.has(gearName)) {
          const postIds = indexes.byGear.get(gearId) || []
          postIds.forEach(id => gearFilteredIds!.add(id))
        }
      }
    }

    return sortedResults.filter(({ id }) => {
      if (typeFilteredIds !== null && !typeFilteredIds.has(id)) return false
      if (gearFilteredIds !== null && !gearFilteredIds.has(id)) return false
      return true
    })
  }, [sortedResults, selectedTypes, selectedGears, indexes])

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault()
    if (!indexes) return

    setLoading(true)

    const matches = searchByTitle(indexes.wordIndex, indexes.postLocator, query)
    const normalized: SearchResult[] = matches
      .map(([entry, id]) => ({ id, entry }))
      .sort((a, b) => b.entry.date - a.entry.date)

    setResults(normalized)
    setLoading(false)
  }


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

        {/* Sort Controls */}
        {(results.length > 0 || (isReady && !loading)) && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-gray-700">Sort by:</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setSortBy("date")}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    sortBy === "date"
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Date
                </button>
                <button
                  onClick={() => setSortBy("distance")}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    sortBy === "distance"
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Distance
                </button>
                <button
                  onClick={() => setSortBy("elevation")}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    sortBy === "elevation"
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Elevation
                </button>
                <button
                  onClick={() => setSortBy("duration")}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    sortBy === "duration"
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  Duration
                </button>
              </div>
              <button
                onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
                className="ml-auto px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors flex items-center gap-1"
              >
                {sortDirection === "asc" ? "↑ Ascending" : "↓ Descending"}
              </button>
            </div>
          </div>
        )}

        {/* Filter Controls */}
        {(results.length > 0 || (isReady && !loading)) && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4">
            <div className="space-y-4">
              {availableTypes.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Type</h3>
                  <div className="flex flex-wrap gap-2">
                    {availableTypes.map(type => (
                      <button
                        key={type}
                        onClick={() => {
                          const newSelected = new Set(selectedTypes)
                          if (newSelected.has(type)) {
                            newSelected.delete(type)
                          } else {
                            newSelected.add(type)
                          }
                          setSelectedTypes(newSelected)
                        }}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          selectedTypes.has(type)
                            ? "bg-indigo-600 text-white"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {availableGears.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-gray-700">Gear</h3>
                    {selectedGears.size > 0 && (
                      <button
                        onClick={() => setSelectedGears(new Set())}
                        className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <select
                    multiple
                    value={Array.from(selectedGears)}
                    onChange={(e) => {
                      const selected = new Set<string>()
                      for (const option of e.currentTarget.options) {
                        if (option.selected) {
                          selected.add(option.value)
                        }
                      }
                      setSelectedGears(selected)
                    }}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors hover:border-gray-300"
                    style={{ minHeight: '120px' }}
                  >
                    {availableGears.map(gear => (
                      <option key={gear} value={gear} className="py-2">
                        {gear}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Hold Ctrl/Cmd to select multiple</p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {loading && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-gray-500">Searching…</div>
          )}

          {filteredResults.length === 0 && isReady && !loading && results.length > 0 && (
            <div className="bg-white rounded-2xl p-6 text-gray-500 shadow-sm border border-gray-100">No results match your filters.</div>
          )}

          {filteredResults.map(({ id, entry }) => {
            const typeName = entry.typeId ? indexes?.typeMap.get(entry.typeId) : undefined
            const gearName = entry.gearId ? indexes?.gearMap.get(entry.gearId) : undefined
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
