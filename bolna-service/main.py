from fastapi import FastAPI, HTTPException

from models import SessionRequest, SessionResponse
from orchestrator import run_session

app = FastAPI(title="call-agent media service")


@app.get("/health")
async def health() -> dict[str, str]:
    """Returns a liveness response without contacting providers."""
    return {"status": "ok"}


@app.post("/v1/sessions", response_model=SessionResponse)
async def create_session(request: SessionRequest) -> SessionResponse:
    """/** usage: runs one audio question through STT, LLM, and TTS. req.body: {audioBase64, audioContentType, contact, question, context, personality, isFirstCall}. res.body: {sessionId, transcript, answer, audioBase64, audioContentType} */"""
    try:
        return await run_session(request)
    except Exception as error:
        raise HTTPException(status_code=502, detail="Media provider request failed") from error
