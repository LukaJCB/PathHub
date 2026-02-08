import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useAuth } from "./useAuth"
import { createMessageClient, MessageClient } from "pathhub-client/src/http/messageClient.js"
import { createRemoteStore, RemoteStore } from "pathhub-client/src/remoteStore.js"
import { createContentClient } from "pathhub-client/src/http/storageClient.js"
import { processIncoming } from "pathhub-client/src/inbox.js"
import { useEffect } from "react"
import { useLocation } from "react-router"

export const MessageProcessor: React.FC = () => {
  const { user, updateUser } = useAuth()
  const location = useLocation()
  const queryClient = useQueryClient()

  useQuery({
    queryKey: ["messages", user?.id],
    enabled: !!user,
    queryFn: queryAndProcess,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    staleTime: Infinity,
  })

  async function queryAndProcess(): Promise<boolean> {
    if (user) {
      const messager: MessageClient = createMessageClient("/messaging", user.token)
      const remoteStore: RemoteStore = createRemoteStore(createContentClient("/storage", user.token))
      const [followRequests, manifest, postManifest, currentPage, _followerManifest, _clientState] =
        await processIncoming(
          messager,
          user.manifest,
          user.postManifest,
          user.currentPage,
          user.ownGroupState,
          user.followRequests,
          user.id,
          user.masterKey,
          remoteStore,
          user.mlsContext,
        )
      updateUser({ manifest, followRequests, postManifest, currentPage })
      return true
    }
    return false
  }

  useEffect(() => {
    if (!user) return

    queryClient.invalidateQueries({
      queryKey: ["messages", user.id],
    })
  }, [location.key, user?.id])

  return null
}
