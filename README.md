# Call agent

Personal voice-call agent. See [the delivery plan](plans/voice-call-agent-phase-1-3.md) for architecture and scope.

## Local development

```sh
cp .env.example .env
pnpm install
pnpm dev
```

Set a non-default `PERSONAL_API_KEY` in `.env` before starting the service. The backend health check is available at `http://localhost:3000/health`; dependency readiness is available at `http://localhost:3000/ready`.

To start the local MongoDB and Redis dependencies with the backend:

```sh
docker compose up --build
```
