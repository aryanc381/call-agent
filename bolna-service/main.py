import logging

from fastapi import FastAPI, HTTPException

from models import SessionRequest, SessionResponse
from orchestrator import run_session

app = FastAPI(title="call-agent media service")
logger = logging.getLogger("call-agent.media")


@app.get("/health")
async def health() -> dict[str, str]:
    """Returns a liveness response without contacting providers."""
    logger.info("health check passed")
    return {"status": "ok"}


@app.post("/v1/sessions", response_model=SessionResponse)
async def create_session(request: SessionRequest) -> SessionResponse:
    """Runs a greeting or audio turn through STT, LLM, and TTS."""
    logger.info("session request received audio_bytes=%s content_type=%s", len(request.audioBase64 or ""), request.audioContentType)
    try:
        result = await run_session(request)
        logger.info("session completed session_id=%s transcript_chars=%s answer_chars=%s audio_chars=%s", result.sessionId, len(result.transcript), len(result.answer), len(result.audioBase64))
        return result
    except Exception as error:
        logger.exception("session failed error_type=%s", type(error).__name__)
        raise HTTPException(status_code=502, detail="Media provider request failed") from error
