import {
  useQuery,
  useMutation,
  useQueryClient,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { useAuth, useAuthRequired } from './useAuth';
import { createMessageClient, MessageClient } from 'pathhub-client/src/http/messageClient.js';
import { base64urlToUint8, createRemoteStore, RemoteStore } from 'pathhub-client/src/remoteStore.js';
import { createContentClient } from 'pathhub-client/src/http/storageClient.js';
import { processIncoming } from 'pathhub-client/src/inbox.js';
import { getCiphersuiteFromName, getCiphersuiteImpl } from 'ts-mls';

export const MessageProcessor: React.FC = () => {

    const {user,updateUser} = useAuth()

    useQuery({
        queryKey: ["messages"],
        enabled: !!user,
        queryFn: queryAndProcess,
        refetchInterval: 60_000,
        refetchIntervalInBackground: true,
        staleTime: Infinity,
    });

    async function queryAndProcess(): Promise<boolean> {
        if (user) {
            const messager: MessageClient = createMessageClient("/messaging", user.token)
            const remoteStore: RemoteStore = createRemoteStore(createContentClient("/storage", user.token))
            const [followRequests, manifest, followerManifest, clientState]  = await processIncoming(messager, user.manifest, base64urlToUint8(user.manifestId), user.followRequests, user.id, user.masterKey, remoteStore, await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519")))
            updateUser({manifest, followRequests})
            return true
        }
        return false
    }
    

  return null;
}
