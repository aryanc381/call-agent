# Call agent

Personal voice-call agent. See [the delivery plan](plans/voice-call-agent-phase-1-3.md) for architecture and scope.

## Local development

```sh
cp .env.example .env
pnpm install
pnpm dev
```

Set a non-default `PERSONAL_API_KEY` and the voice prompt in `AGENT_PERSONALITY` in `.env` before starting the service. Each saved contact needs only `name` and `phoneNumber`. Send plain-language per-call context (for example, how Aryan knows them and what the agent should know) when you queue the call. The backend health check is available at `http://localhost:3000/health`; dependency readiness is available at `http://localhost:3000/ready`.

Create a contact, then queue a call with only its contact ID. A BullMQ worker picks it up and dials it; there is no task prompt to construct:

```sh
curl -X POST http://localhost:3000/v1/api/calls \
  -H 'X-API-Key: your-key' \
  -H 'Idempotency-Key: a-unique-id' \
  -H 'Content-Type: application/json' \
  -d '{"contactId":"your-contact-id","context":"This is Aryan’s friend Maya. They met at college; ask how her new role is going."}'
```

To start the local MongoDB and Redis dependencies with the backend:

```sh
docker compose up --build
```
