## Post Storage and E2E Encryption

Every user creates an MLS group for themselves, every other users that follows them is added to this group. 
Whenever the owner wants to upload a post they generate a new AES key (data encryption key, DEK) and encrypt the content with it.
They then upload the encrypted content and obtain a unique objectId for that post.
The owner then uses the MLS group to send the DEK to the group along with the object id, the owner also stores the objectId and DEK locally in their post manifest.
The owner's followers receive the message and can then fetch the post and decrypt it using the DEK.

If someone new is accepted as a follower of the owner they are added to the group. 
The owner then sends their post manifest to the group, the new followers can then use the post manifest to fetch any content from the owner.

When someone is removed as a follower they are also removed from the group.
As such they will no longer receive any updates if the owner uploads a new post, and the client will delete any of its existing DEKs it has received from the owner.

At any time a user can choose to rotate the DEK to any of their posts by generating a new key, re-encrypting the post, updating the DEK in their manifest and sharing it to their group.
This can be beneficial in the case where a user that was removed is known to use a malicious client that never deletes keys. This would stop them from being able to access the content (though the malicious user could still have a local unecrypted copy of the post).

To recap, every user will have a post manifest that contains all their DEKs and objectIDs, they will share this with all their followers securely using an MLS group that represents them and their followers.

This pseudo code represents the structure every user has to store locally to use the application:

```typescript
type PostManifest = Map<ObjectId, AesKey>

type LocalState = {
  ownManifest: PostManifest
  followeeManifests: Map<UserId, PostManifest>
}
```

## Post interaction

All followers of an owner should be able to interact with any posts by the owner and be able to see other followers' interactions, e.g. comments on a post.
To enable this, the follower sends a message to the MLS group, then all other followers and the owner can all see the interaction.
Furthermore the owner can save the interactions alongside the original post so that in the future, new followers can access these interactions.
Additionally all interactions should be signed as well so that an owner couldn't falsly claim that an interaction the owner itself created was created by someone else.

## Key Storage & Multi-device support

All keys should be stored locally, but they also need to be accesible across devices.
The keys can be encrypted locally using a PBKDF and then uploaded. On the other device they would log in to receive the encrypted keys from the server and then input the password to decrypt the ciphertext and have access to the keys.

## Local Search/Aggregation

The client will create an index of all of your content locally, encrypt it like any other post and store the key and objectId as an additional item on the post manifest.
This index would store any derived data, such as total distance, time, etc. along with any metadata that might be tracked. 
Then this index can be used to search for individual files that then can be fetched from storage. The index can also be used for any aggregation, e.g. to find the total distance for a given year. 
If the index grows too large for local search, it could be split and searched separately or sequentially, e.g. split it by date and ask the user if they want to search for content older than 2 years ago.


## Server software

The server software is split into 3 distinct services, an authentication service, a storage service and a message broker service.

### Authentication Service

This service allows users to register and login using the [OPAQUE Protocol](https://opaque-auth.com/). 
Once a user logs in successfully the server will return a JWT that contains the user's id. 
This JWT can be used to access the storage and message broker services.

### Storage Service

This service stores encrypted binary blobs along with an userId marked as the owner and a nonce.
Every blob is indexed by a randomly generated 128 bit value.
The api allows to create or update a blob using a PUT endoint and allows retrieving via a GET endpoint. 
Updating a blob is only possible if the userId in the JWT passed in the request matches the owner of the blob.
Crucially the GET endpoint does not require privileged access, anyone with an account can access it.
This is okay because there is no unencrypted metadata on the file and to access any file you would have to guess a 128 bit value which is all but impossible.
Furthermore the GET endpoint will not expose the owner's id, so without decrypting it you won't know who the owner is or anything about the file you downloaded


### Message Broker Service

This service allows a user to send message to a number of recipients.
The message is stored on the server until all recipients have acknowledged it, or until it expires after some time.
Once a client has received and processed a message, the client should send a request to the server to acknowledge it.
All endpoints on this service are restricted to the user in the JWT passed to the service.
All messages are meant to be encrypted before sending them to this service.


## Future improvement ideas

### Use Content-addressable storage

Instead of generating random 128 bit values as objectIds, the objectIds could be hashes of the content. 
That way the client could always guarantee that the content they fetched is the content someone linked them to and thus would need to trust the server less.
This would require introducing mutable pointers, because updating an object would change the hash and therefore the objectId.
Going further the entire storage layer could be achieved just by using IPFS.


### Federation using ActivityPub

To further reduce reliance on a central server, the message broker service could be expanded to use ActivityPub style message passing so that users from one instance could follow users from another instance and receive their MLS messages.
There are further changes to the other services on the server that would need to be made to enable this.

### Key Transparency
To prevent the server from being able to perform MITM attacks using key substituion, there needs to be a robust key transparency system in place.
Consider something like https://github.com/fedi-e2ee/pkd-server-go or https://github.com/facebook/akd.
