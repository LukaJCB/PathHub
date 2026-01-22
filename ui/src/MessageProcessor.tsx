import {
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useAuth } from './useAuth';
import { createMessageClient, MessageClient } from 'pathhub-client/src/http/messageClient.js';
import { base64urlToUint8, createRemoteStore, RemoteStore } from 'pathhub-client/src/remoteStore.js';
import { createContentClient } from 'pathhub-client/src/http/storageClient.js';
import { processIncoming } from 'pathhub-client/src/inbox.js';
import { getCiphersuiteFromName, getCiphersuiteImpl } from 'ts-mls';
import { useEffect } from 'react';
import { useLocation } from 'react-router';

export const MessageProcessor: React.FC = () => {

    const { user, updateUser } = useAuth();
    const location = useLocation();
    const queryClient = useQueryClient()

    useQuery({
        queryKey: ["messages", user?.id],
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
            const [followRequests, manifest, postManifest, currentPage, _followerManifest, _clientState]  = await processIncoming(
                messager, user.manifest, user.postManifest, user.currentPage, base64urlToUint8(user.manifestId), user.ownGroupState, user.followRequests, user.id, user.masterKey, remoteStore, await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519")))
            updateUser({manifest, followRequests, postManifest, currentPage})
            return true
        }
        return false
    }

    useEffect(() => {
        if (!user) return;

        queryClient.invalidateQueries({
            queryKey: ["messages", user.id],
        });
    }, [location.key, user?.id]);
    

  return null;
}
