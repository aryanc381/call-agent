import base64
from uuid import uuid4

from models import SessionRequest, SessionResponse
from providers.cartesia import encode, synthesize
from providers.cloudflare import complete, transcribe


def _prompt(request: SessionRequest, transcript: str) -> str:
    """Builds the small, bounded prompt used for one call question."""
    return (
        f"You are a {request.personality} personal calling assistant. "
        f"Contact: {request.contact.name}, {request.contact.relation}, "
        f"{request.contact.relationDescription}, {request.contact.closeness}. "
        f"Question: {request.question}. Context: {request.context}. "
        f"First call: {request.isFirstCall}. Conversation transcript: {transcript}. "
        "Answer briefly, confirm the answer, and do not invent details."
    )


async def run_session(request: SessionRequest) -> SessionResponse:
    """Runs STT, response generation, and TTS for one audio session."""
    transcript = await transcribe(base64.b64decode(request.audioBase64), request.audioContentType)
    answer = await complete(_prompt(request, transcript))
    audio, content_type = await synthesize(answer)
    return SessionResponse(
        sessionId=str(uuid4()),
        transcript=transcript,
        answer=answer,
        audioBase64=encode(audio),
        audioContentType=content_type,
    )
