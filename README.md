# Call agent

Personal voice-call agent. See [the delivery plan](plans/voice-call-agent-phase-1-3.md) for architecture and scope.

## Local development

```sh
pnpm install
pnpm dev
```

The backend health check is available at `http://localhost:3000/health`.

To start the local MongoDB and Redis dependencies with the backend:

```sh
docker compose up --build
```
