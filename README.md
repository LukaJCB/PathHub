# PathHub


## Server
To run the individual server components locally:

```
docker-compose up -d
pnpm install
pnpm start
```


Additonally once the docker container for `storage` is up and running you will need to log into the minioadmin console to create a bucket.

For `authentication` you will need to generate keys like so:


```
pnpm generate-keys
```

For `message-broker` and `storage` you will need to copy the generated key into the .env files:

```
SIGNATURE_PUBLIC_KEY=MCowBQYDK2VwAyEAZRvKgq5zyOMqtzv8Jbg5aCQPQryVPYSORcBcwGN9Cz8
```

## Client

To compile the client, run `pnpm build` in the `/client` directory.

Then to run the UI, run `pnpm dev` in the `/ui` directory.
