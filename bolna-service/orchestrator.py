import base64
import logging
from uuid import uuid4

from models import SessionRequest, SessionResponse
from providers.cartesia import encode, synthesize
from providers.cloudflare import complete, transcribe

logger = logging.getLogger("call-agent.media")


def _prompt(request: SessionRequest, transcript: str) -> str:
    """Builds the fixed call context and current conversation for the LLM."""
    history = "\n".join(
        f"{message.role}: {message.content}" for message in request.conversationHistory
    )
    first_turn = not request.conversationHistory
    instruction = (
        f"Start with this greeting, then ask the call question: {request.greeting}."
        if first_turn
        else "Respond to the latest caller message without repeating an already answered question."
    )
    return (
        f"You are {request.personality} AI calling on Aryan's behalf. "
        f"The caller is Aryan's {request.contact.relation} ({request.contact.relationDescription}, {request.contact.closeness}). "
        f"Situation: {request.context}. Call question: {request.question}. "
        f"{instruction} Be brief, natural, respectful, and do not invent details.\n"
        f"Conversation history:\n{history}\nCaller transcript: {transcript}"
    )


async def run_session(request: SessionRequest) -> SessionResponse:
    """Runs STT, response generation, and TTS for one audio session."""
    transcript = ""
    if request.audioBase64:
        if not request.audioContentType:
            raise ValueError("Audio content type is required with audio")
        audio = base64.b64decode(request.audioBase64, validate=True)
        logger.info("stage=stt input_bytes=%s", len(audio))
        transcript = await transcribe(audio, request.audioContentType)
        logger.info("stage=stt complete transcript_chars=%s", len(transcript))
    else:
        logger.info("stage=stt skipped greeting=true")
    logger.info("stage=llm start")
    answer = await complete(_prompt(request, transcript))
    logger.info("stage=llm complete answer_chars=%s", len(answer))
    logger.info("stage=tts start")
    audio, content_type = await synthesize(answer)
    logger.info("stage=tts complete audio_bytes=%s", len(audio))
    return SessionResponse(
        sessionId=str(uuid4()),
        transcript=transcript,
        answer=answer,
        audioBase64=encode(audio),
        audioContentType=content_type,
    )
