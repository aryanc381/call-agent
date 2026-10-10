# Voice call agent — phases 1–3

Build a standalone personal voice-call agent that places a one-question call, handles related context, confirms the answer, and notifies Aryan of the result.

Repository: https://github.com/aryanc381/call-agent

## Scope and ownership

`call-agent` is a new standalone repository under `personal/`. Circuit, Circuit UI, and OMS UI are out of scope and receive no changes.

The repository contains two services:

- TypeScript backend: task APIs, MongoDB, Redis queue, Vobiz integration, audio bridge, task state, and notifications.
- Minimal Python Bolna service: live conversation/media orchestration only.

## Functional features

- Create and manage contacts with name, phone number, relation, and closeness.
- Create a call task with a contact, relation, question, context, personality, and first-call flag.
- Queue each task; exactly one worker claims and executes it.
- Initiate and track an outbound Vobiz call.
- Run the live conversation through Bolna, Cloudflare Grok STT, Cloudflare Workers AI, and Cartesia.
- Persist connected/completed/failed state, transcript, confirmed answer, duration, and provider errors.
- Send Aryan a success or failure notification.
- Prevent duplicate calls from duplicate task submissions or worker races.

Excluded: no-answer handling, retries, voicemail, callbacks, recordings, dashboard/metrics UI, and Circuit integration. Dashboard work is deferred to a later plan.

## Models

```text
MongoDB
├── contacts #NEW
│   ├── _id
│   ├── name
│   ├── phoneNumber                         # unique E.164 phone number
│   ├── relation
│   │   ├── relationship                    # mother | father | sibling | friend | colleague | other
│   │   └── closeness                       # inner_circle | close | familiar | formal
│   ├── createdAt
│   └── updatedAt
│
└── call_tasks #NEW
    ├── _id
    ├── idempotencyKey                      # unique
    ├── contactId                           # ObjectId → contacts._id
    ├── request
    │   ├── relation                        # snapshot used by this call's agent input
    │   │   ├── relationship
    │   │   ├── description
    │   │   └── closeness
    │   ├── question
    │   ├── context                         # related background, no FAQ list
    │   ├── personality
    │   └── isFirstCall
    ├── status                              # queued | processing | dialing | connected | completed | failed
    ├── processing                          # null once terminal
    │   ├── workerId
    │   ├── claimToken
    │   ├── claimedAt
    │   └── leaseExpiresAt
    ├── provider
    │   ├── vobizCallId
    │   ├── bolnaCallId
    │   └── startedAt
    ├── result
    │   ├── confirmedAnswer
    │   ├── transcript[]
    │   │   ├── speaker                     # agent | contact
    │   │   ├── text
    │   │   ├── startedAtMs
    │   │   └── endedAtMs
    │   ├── durationSeconds
    │   ├── endedAt
    │   ├── failureReason
    │   └── providerError                   # private debugging detail
    ├── notification
    │   └── status                          # pending | success | failure
    ├── createdAt
    └── updatedAt
```

```text
contacts
├── #WRITE create contacts
├── #READ   find contacts
└── #MODIFY change contact data

call_tasks
├── #WRITE  create a queued task
├── #READ   fetch task status/result
└── #MODIFY atomically claim, track call state, save result, update notification
```

Indexes: `contacts.phoneNumber` unique; `call_tasks.idempotencyKey` unique; `call_tasks.status + createdAt`; `call_tasks.contactId`; sparse unique `call_tasks.provider.vobizCallId`.

## Agent session input

The TypeScript worker combines the task and referenced contact phone number, then sends Bolna:

```json
{
  "contact": {
    "name": "Mom",
    "relation": "mother",
    "relationDescription": "Aryan's mother",
    "closeness": "inner_circle"
  },
  "question": "Can you bring a cake when you come home?",
  "context": "It is Aryan's birthday today and there is a small celebration at home.",
  "personality": "Warm, brief, respectful and conversational.",
  "isFirstCall": true
}
```

The conversation rule is: short first-call intro, ask the primary question, use only related context for follow-ups, confirm the answer, and end the call.

## File tree

```text
call-agent/
├── .github/
│   └── workflows/
│       └── pull-request.yml                       #NEW — TypeScript/Python PR checks
├── backend/                                        #NEW — TypeScript control plane
│   ├── src/
│   │   ├── server.ts                                # HTTP + WebSocket server
│   │   ├── config.ts                                # environment validation
│   │   ├── routes/
│   │   │   ├── contacts.route.ts                    # contact API
│   │   │   └── call-tasks.route.ts                  # task API
│   │   ├── webhooks/
│   │   │   └── vobiz.webhook.ts                     # Vobiz status callbacks
│   │   ├── realtime/
│   │   │   └── vobiz-bolna.bridge.ts                # Vobiz audio ↔ Bolna audio
│   │   ├── models/
│   │   │   ├── contact.model.ts                     # contacts collection
│   │   │   └── call-task.model.ts                   # call_tasks collection
│   │   ├── services/
│   │   │   ├── contact.service.ts
│   │   │   ├── call-task.service.ts
│   │   │   ├── vobiz.service.ts                     # Vobiz calls
│   │   │   ├── bolna-client.service.ts              # Bolna session connector
│   │   │   └── notification.service.ts              # result notification
│   │   ├── queue/
│   │   │   └── call-task.queue.ts                   # BullMQ
│   │   ├── workers/
│   │   │   └── call-task.worker.ts                  # task claim/execution
│   │   └── types/
│   │       ├── contact.ts
│   │       ├── call-task.ts
│   │       └── bolna-session.ts                     # TS ↔ Python contract
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
├── bolna-service/                                  #NEW — minimal Python media plane
│   ├── main.py                                     # session WebSocket/API entrypoint
│   ├── session.py                                  # audio in/out and final result
│   ├── bolna-orchestrator.py                       # Bolna VAD/conversation loop
│   ├── providers/
│   │   ├── stt.py                                 # Cloudflare Grok STT
│   │   ├── llm.py                                 # Cloudflare Workers AI
│   │   └── tts.py                                 # Cartesia
│   ├── config.py                                  # provider configuration
│   ├── requirements.txt
│   └── Dockerfile
├── docker-compose.yml                              #NEW — backend, Bolna, MongoDB, Redis
├── .env.example                                   #NEW — variable names only
├── .gitignore                                     #NEW
└── README.md                                      #NEW — setup and architecture
```

## Routes

| Method | Path | Auth | Request | Success | Failure |
|---|---|---|---|---|---|
| POST | `/contacts` | Personal API key | `{ name, phoneNumber, relation: { relationship, closeness } }` | `201 { contact }` | `400`, `409` |
| GET | `/contacts` | Personal API key | — | `200 { contacts }` | `401` |
| GET | `/contacts/:contactId` | Personal API key | — | `200 { contact }` | `401`, `404` |
| POST | `/call-tasks` | Personal API key | `{ contactId, relation, question, context, personality, isFirstCall }` and `Idempotency-Key` | `202 { task }` | `400`, `401`, `404`, `409` |
| GET | `/call-tasks/:taskId` | Personal API key | — | `200 { task }` | `401`, `404` |
| POST | `/webhooks/vobiz` | Vobiz signature | provider-defined signed status payload | `204` | `401`, `404` |

The Vobiz adapter normalizes its provider payload into internal state; no other code depends on Vobiz field names.

## Services and rules

| Owner | Function | Arguments | Return | Side effects |
|---|---|---|---|---|
| Contact service | `createContact`, `listContacts`, `getContact` | contact input / ID | contact(s) | MongoDB read/write |
| Task service | `createCallTask` | task input, idempotency key | queued task | saves task, adds queue job |
| Task service | `claimCallTask` | task ID, worker ID | claimed task / null | atomic lease claim |
| Task service | `updateCallStatus`, `completeCallTask`, `failCallTask` | task ID and state/result | task | lifecycle/result persistence |
| Vobiz service | `createCall` | phone number, stream URL, task ID | provider call ID | outbound call |
| Bolna client | `startSession` | agent session input | session ID | starts media session |
| Media bridge | `bridgeAudio` | Vobiz and Bolna sockets | void | bidirectional audio frames |
| Notification service | `sendTaskResult` | terminal task | delivery status | sends result and updates notification status |

Only the worker can initiate a call. API input is validated before persistence. A duplicate idempotency key returns the existing task and must never enqueue or call twice. A terminal task cannot be initiated again. Vobiz webhook signatures are verified before processing.

## E2E smoke path

```text
[Create contact]
  name + phoneNumber + relation + closeness
        │
        v
POST /contacts ───────────────────────────────► contacts saved in MongoDB

[Create call task]
  contactId + relation + question + context + personality + isFirstCall
        │
        v
POST /call-tasks ─────────────────────────────► call_tasks.status = queued
        │
        v
Redis queue ──────────────────────────────────► TS worker claims task
                                                     │
                                                     v
                                          Read contact phoneNumber
                                                     │
                                                     v
                                          Start Bolna session
                                                     │
                                                     v
                                   Vobiz dials contact phoneNumber
                                                     │
                                                     v
                                           Call connected
                                                     │
                                                     v
                      Intro → question → related context → confirmation
                                                     │
                                                     v
                    completed + transcript + confirmedAnswer persisted
                                                     │
                                                     v
                          notification.success → Aryan gets result

[Invalid API key] ───────────────► 401; no write and no queue job
[Invalid contact/task input] ────► 400; no write and no queue job
[Unknown contactId] ─────────────► 404; no task and no queue job
[Same Idempotency-Key] ──────────► existing task; no second job/call
[Vobiz cannot connect] ──────────► failed + failureReason + notification.failure
```

Human E2E testing is required for the real Vobiz phone call in Phase 3.

## Architecture

```mermaid
flowchart TD
  A[Personal client] --> B[TypeScript API]
  B --> C[(MongoDB: contacts and call_tasks)]
  B --> D[(Redis queue)]
  D --> E[TypeScript worker]
  E --> F[Vobiz call and audio bridge]
  F <--> G[Python Bolna service]
  G --> H[Cloudflare Grok STT]
  G --> I[Cloudflare Workers AI]
  G --> J[Cartesia]
  F --> K[Contact phone]
  E --> C
  E --> L[Notification to Aryan]
```

## Delivery phases

### Phase 1 — TypeScript backend

Outcome: MongoDB models, personal API, Redis/BullMQ queue, atomic task claims, lifecycle persistence, and notification state.

Prerequisites: MongoDB and Redis configuration.

Verification: API tests cover contact/task creation, validation, and duplicate idempotency behavior.

#### Pull-request CI

Phase 1 also establishes GitHub Actions PR CI in `.github/workflows/pull-request.yml`. The workflow runs on every pull request targeting `main` and has independent, path-aware checks for both service directories:

- `backend/**` (TypeScript): install with the lockfile, then run formatting, linting, type checking, and unit/API tests.
- `bolna-service/**` (Python): install from `requirements.txt`, then run formatting/linting, type checking, and tests.

Changes outside a service directory skip that service's expensive setup while still reporting a successful, explicit skipped check. Both checks must be required GitHub branch-protection status checks before merging a PR. The CI workflow itself is tested by opening a PR that changes each service directory.

### Phase 2 — Bolna media service

Outcome: a minimal Python service accepts generic audio and agent session input; Bolna conducts the VAD/STT/LLM/TTS loop and returns audio, transcript, and confirmed answer. A local TypeScript audio client tests this without Vobiz.

Prerequisites: locked TypeScript ↔ Python session contract.

Verification: browser microphone or audio file → Bolna → transcript, generated voice, and confirmed answer.

### Phase 3 — Vobiz integration

Outcome: TypeScript initiates Vobiz calls, verifies provider callbacks, bridges live Vobiz audio to Bolna, persists terminal results, and notifies Aryan.

Prerequisites: Phases 1–2 plus Vobiz outbound-call, media-stream, and webhook documentation/credentials.

Verification: human E2E call results in either a completed task and accurate notification or a failed task and failure notification.

## Agent orchestration

```mermaid
flowchart LR
  P1[Phase 1: TypeScript backend] --> P2[Phase 2: Bolna media service]
  P2 --> P3[Phase 3: Vobiz integration]
```

One sequential execution wave is required because each phase depends on the preceding phase's contract. No subagents are planned.

## Integration and rollout rules

- Consult official Bolna documentation before any Bolna integration.
- Reuse Bolna's existing OpenAI-compatible provider implementation for Cloudflare Workers AI when the documented interface supports it.
- Do not fork or rewrite Bolna orchestration unless official/documented integration paths cannot support the selected providers.
- Keep Python limited to the Bolna media plane. It must not own MongoDB, Redis, task lifecycle, Vobiz call creation, or notifications.
- Vobiz owns PSTN connectivity; exact media-frame mapping and webhook fields must be verified against its documentation before Phase 3.
- Store provider secrets in deployment secrets/environment variables only; never commit them.
