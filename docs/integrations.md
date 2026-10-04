# Integration status

| Surface | Implemented and verified |
| --- | --- |
| Email/password sessions | Better Auth; automated sign-in and real Chromium signup/logout/login flows |
| MCP OAuth | Explicit JWT issuer, resource-bound access, controller subject match, PKCE, consent, discovery, revocation; test-client and browser flows |
| OAuth dynamic registration | Explicitly disabled by default; anonymous native registration tested when deliberately enabled |
| Personal token | Personal controller compatibility mode; hashed storage and live connection checks |
| Native Grok Bot | User creates it outside Sentinel; actual native-client connection was not available for this review |
| Nessie sandbox | Provider adapter, observations, protected funds, mandates and purchase worker; isolated fixtures, live key required |
| xAI realtime voice | Ephemeral credential gateway, PCM streaming UI, bounded server tools and lifecycle; isolated fixtures, live key/microphone required |
| Business teams | Membership/invitation/owner/finance/member domain controls; no outgoing messaging service |
| GitHub source and CI | Ignored secrets/data, lockfile, Actions checks and deployment instructions; repository has not been created remotely |
| Container hosting | Node 24 image and one-web/one-worker Compose configuration; Docker was unavailable for runtime verification |

The financial action implemented here is a sandbox merchant purchase. It does not connect real Capital One customer accounts or make production bank payments. Voice reads shared work rather than the external Bot's private memory. These boundaries remain visible in the app and documentation.
