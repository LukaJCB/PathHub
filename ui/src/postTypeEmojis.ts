export const postTypeOptions: Array<{ value: string; emoji: string }> = [
  { value: "Ride", emoji: "🚴" },
  { value: "Run", emoji: "🏃" },
  { value: "Workout", emoji: "💪" },
  { value: "Hike", emoji: "🥾" },
  { value: "Walk", emoji: "🚶" },
  { value: "E-Bike Ride", emoji: "⚡️🚴" },
  { value: "Weight Training", emoji: "🏋️" },
  { value: "Virtual Ride", emoji: "🖥️🚴" },
  { value: "Virtual Run", emoji: "🖥️🏃" },
  { value: "Kayaking", emoji: "🛶" },
]

export const postTypeEmojiMap: Record<string, string> = postTypeOptions.reduce(
  (acc, { value, emoji }) => {
    acc[value] = emoji
    return acc
  },
  {} as Record<string, string>
)

export function getPostTypeEmoji(postType?: string): string | undefined {
  if (!postType) return undefined
  return postTypeEmojiMap[postType] ?? "✨"
}

export function getGearEmoji(postType?: string): string {
  if (!postType) return "⚙️"
  const bikeTypes = new Set(["Ride", "E-Bike Ride", "Virtual Ride"])
  const shoeTypes = new Set(["Run", "Virtual Run", "Hike", "Walk"])
  if (bikeTypes.has(postType)) return "🚲"
  if (shoeTypes.has(postType)) return "👟"
  return "⚙️"
}
