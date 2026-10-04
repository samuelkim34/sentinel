# Grok realtime voice

Voice is an xAI conversation over the Bot registration's shared Sentinel state. Native Grok Bots remain external agents. Voice can explain stored work and send explicit human instructions; it has no access to the native Bot's private chat or unreported reasoning.

## Transport and audio

The server authenticates the human, verifies an active tool-tested connection, checks the task/registration binding, and reserves one active session atomically. It requests a short-lived credential from `POST https://api.x.ai/v1/realtime/client_secrets`, with a bounded provider deadline. Failure closes the reservation so the user can retry. The long-lived `XAI_API_KEY` never goes to the browser.

The browser opens `wss://api.x.ai/v1/realtime?model=...` using the ephemeral credential in the `xai-client-secret.<token>` subprotocol. `XAI_VOICE_MODEL` defaults to `grok-voice-latest`. AudioContext is resumed on user interaction, input is resampled to 24 kHz and encoded as little-endian PCM16, and 20 ms frames are sent. Streaming resampling retains fractional sample position between chunks, including 44.1 kHz input.

Mute changes the microphone tracks and synchronously stops outgoing frames; it also clears queued input. Playback drops superseded response audio and limits its scheduled queue. Disconnect, provider failure, expiry, navigation, unmount and logout stop tracks, audio nodes and the socket and end the server session. Starting is guarded against concurrent clicks and late provider results.

## Tools and permissions

| Tool | Effect |
| --- | --- |
| `get_agent_state`, `get_context` | Read persisted registration, granted wallets, tasks, instructions and proposal states |
| `get_task` | Read a task bound to this Bot |
| `queue_instruction` | Append an instruction to that task |
| `create_task` | Create explicit work only for the human's controlled Bot; purchase tasks need a valid mandate |
| `pause_registration` | Pause eligible unsubmitted work |
| `draft_authority_change` | Save exact proposed mandate terms for owner review |

The server rechecks membership, registration/connection state, session expiry, hashed voice token, function allowlist and strict arguments on every call. Roles and targets come from the bound session, not model-supplied claims. A call ID and request hash provide replay behavior; changed arguments under the same ID are rejected. The mutation and result journal share one transaction.

Function calls in one completed model response are processed as a batch. Every call receives its output/error, then one `response.create` continues the conversation. A failing tool does not suppress the others.

Authority drafts are scoped to the Bot/account, expire, and can be confirmed once. Their review panel uses the ordinary owner/password checks. Voice itself has no approval, raw bank, payment execution or permission escalation tool.

## Privacy and lifecycle

One active voice session per user is allowed; defaults are 15-minute sessions and 5-minute ephemeral connect credentials. Limits are 10 session starts/hour and 30 new tool calls/minute. The UI contains at most 100 recent transcript entries. Microphone audio is not stored by Sentinel.

Transcript retention is off by default. When opted in, final user/assistant text may be saved through the session-bound transcript route. Turning it off deletes existing stored text and prevents new storage in active sessions. Provider-side handling follows the xAI service independently.

Backend session/tool behavior, failure cleanup, replay/rollback, task isolation, retention, resampling and parallel outputs were tested using isolated fixtures. A live xAI WebSocket, actual microphone playback, and the installed native Grok app were not exercised. Validate them using your key and microphone on HTTPS or loopback.
