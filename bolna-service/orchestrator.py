import base64
import json
import logging
from uuid import uuid4

from models import SessionRequest, SessionResponse
from providers.cartesia import encode, synthesize
from providers.cloudflare import complete, transcribe

logger = logging.getLogger("call-agent.media")


def _prompt(request: SessionRequest, transcript: str) -> str:
    """Packages the personality, contact context, and conversation for the LLM."""
    return json.dumps({"personality": request.personality, "contact": {"name": request.contact.name, "context": request.contact.context}, "conversation": [{"role": message.role, "content": message.content} for message in request.conversationHistory], "latest_contact_message": transcript}, ensure_ascii=False)


def _normalise(text: str) -> str:
    """Normalizes text before checking whether the model copied the caller."""
    return " ".join(text.casefold().split()).strip(".,!?;:")


async def run_session(request: SessionRequest) -> SessionResponse:
    """Transcribes one turn, generates a natural reply, and voices it."""
    transcript = ""
    if request.audioBase64:
        if not request.audioContentType:
            raise ValueError("Audio content type is required with audio")
        transcript = await transcribe(base64.b64decode(request.audioBase64, validate=True), request.audioContentType)
    prompt = _prompt(request, transcript)
    answer = await complete(prompt)
    if transcript.strip() and _normalise(answer) == _normalise(transcript):
        logger.warning("stage=llm copied_caller; retrying once")
        answer = await complete(
            f"{prompt}\n\nThe previous response copied the latest contact message. "
            "Reply as the assistant with a useful, short response. Do not quote or repeat the contact."
        )
        if _normalise(answer) == _normalise(transcript):
            logger.warning("stage=llm copied_caller_after_retry; using clarification")
            answer = "Sorry, I didn't catch that properly. Could you say that again?"
    audio, content_type = await synthesize(answer)
    return SessionResponse(sessionId=str(uuid4()), transcript=transcript, answer=answer, audioBase64=encode(audio), audioContentType=content_type)
