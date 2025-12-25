# Authentication Flows

## Registration


### Initial key generation 
The user enters a username and password and the client generates a password-key from the password using scrypt. Then, the client generates a AES-256 master key, this master-key will be used as a root key to encrypt many other secrets. 
The master key is encrypted using the password-key, resulting in an encrypted master-key that can be safely stored on the server.
The client also generates an AES-256 recovery-key and displays it to the user.
The master-key is then encrypted using the recovery-key and the recovery-key is encrypted using the master-key. 
Finally the client generates an Ed25519 key pair.

### OPAQUE Registration

The client uses the password to create an OPAQUE registration request and sends it to the server.
The server responds and the client uses the response to create the OPAQUE registration record.
The record is then uploaded to the server along with:
1. The password-key encrypted master-key
2. The nonce used to encrypt the master-key with the password-key
3. The recovery-key encrypted master-key
4. The nonce used to encrypt the master-key with the recovery-key
5. The master-key encrypyed recovery-key
6. The nonce used to encrypt the recovery-key with the master-key
7. The chosen username
8. The Ed25519 public key

### MLS Group Initialization



### Manifest Initialization



## Login 

The client prompts the user to input their username and password.
It then creates an OPAQUE start login and sends it to the server.
The server responds with the OPAQUE start login result, which the client can use to create the OPAQUE finish login request.
The finish login request is sent to the server and the server will authenticate the request.
After successful authentication, the server returns:
1. The password-key encrypted master-key
2. A JWT for accessing the other APIs
3. An objectId for the users' manifest

The client then uses the password to regenerate the password-key and decrypt the master-key.
It then uses the fetches the manifest and uses the master-key to decrypt it.
The client can then setup the MLS groups using that information???


## Forgot Password

If a user has forgotten their password, they can use their recovery-key to regain access to the master-key.
Once the master-key is decrypted, the user will input a new password. 
Next a new password-key is derived using the password and scrypt.
The password-key is then encrypted using the master-key and the master-key is encrypted using the password-key.


## Change Password




# View Flows

## Viewing the main timeline

The user should have all the current post manifests of the people they follow.
Each post manifest includes a list of post metadata records, herefore called a post meta.
The client should display the first ~30 manifests' posts as post previews ordered by their date descending.

If a user's post manifest includes an older manifest that has a date that is newer than other user's newest posts, then the older manifest should be fetched and its post previews displayed.
This will ensure that a user's posts aren't missed just because they are on an older manifest.

### Viewing a post preview

A post preview is a collection of the post's aggregated data and metadata.
It includes the post's title, it's upload date, total number of likes and comments, as well as a sample of the actual likes and comments.
All this data should be included in a given post meta, so there should be no need to fetch extra data remotely to render a post preview.

### Viewing a post

Once a user chooses to expand a post, they will be shown the post view, here the user will be able to see all the data.
Thus, the client needs to fetch the actual post from the remote storage.
The client knows where to fetch and decrypt the data from the objectId and post-secret included in the post meta.


## Viewing someone's profile

When a user chooses to view another user's profile, they will be shown the profile view.
The profile view contains a user's totals, the totals are an aggregation of all of that user's post meta's.
Furthermore the profile view should also display the user's latest posts as post previews ordered by their date descending.


## Searching for a post

Since the user has all of their followee's current post metas through their post manifests, all titles can be searched.


## Aggregating posts

A user can use any data that is part of the post meta to perform custom aggregations.

# Application Flows


## Follow request

A user that wants to follow another user must send the user an MLS proposal message with `new_member_proposal` SenderType.
When that user receives such a proposal, they can then either reject it, or create a new commit that adds the new member.
The client then sends out the commit as well as the welcome message.
Then it also sends the latest version of the manifest to the group as an application message. (TODO could it be sent as part of the groupInfo?)


## Creating a new post

Once a user submits a post, the client will generate a post meta for the post.
They then add the post meta onto their current post manifest and update the totals.
Next the client generates a new post-secret and encrypts the content with it. 
(TODO Consider re-using post-secrets when inside the same epoch, perhaps the post-secret could just be the MLS exporter secret?)
The encrypted content is then uploaded to the remote storage and a unique objectId for that post is returned.
The owner then uses their MLS group to send the post meta to the group.

Once another user receives the post meta, they add it to the sender's post manifest.

## Interacting with a post

A user can submit a comment or a like on a post.
To do so, the client takes the comment or like, records the current timestamp, the commenter's userID and the postID and signs it.
(TODO should the postId be separate from the objectId?)
The combined record is then sent to the owner's MLS group.

When the owner receives the comment or like, they should amend the record to the post meta.
(TODO where do the full comments/likes get stored? As their own objectId?)

When any other user receives the comment or like, they need to store it.
(TODO how to store them?)
All comments or likes need to be stored until there is a new epoch for that group. 
At that point it can be guaranteed that the group owner has added all interactions to their manifest.

### Interacting with an old post

If someone comments on an old post (i.e. a post that is not within the current manifest) the entire post manifest will be updated and thus re-encrypted.

todo somewhere we need to compare the current group secret with the StorageIdentifier for a post. 
 If they are different, the key needs to be rotated and the rotation needs to cascade all the way up.
 i.e. if a comment is added to an old post, the comments need to be encrypted with a new key and then
 the PostManifestPage needs to be re-encrypted with a new key as well and that key needs to be updated in the postManifest


## Removing someone as a follower

To remove someone as a follower the client will create a new MLS commit containing a Remove proposal.
The user that was removed will receive the message and the client will remove all the manifests and keys for that user.
All other followers process the commit and enter into the new epoch.


