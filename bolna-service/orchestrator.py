import base64
import json
import logging
from uuid import uuid4

from models import SessionRequest, SessionResponse
from providers.cartesia import encode, synthesize
from providers.cloudflare import complete, transcribe

logger = logging.getLogger("call-agent.media")


def _prompt(request: SessionRequest, transcript: str) -> str:
    """Serializes task context and caller turn as data for the LLM."""
    return json.dumps(
        {
            "agent_style": request.personality,
            "caller": {
                "name": request.contact.name,
                "relationship_to_aryan": request.contact.relation,
                "relationship_description": request.contact.relationDescription,
                "closeness": request.contact.closeness,
            },
            "situation": request.context,
            "question": request.question,
            "completion_criteria": request.completionCriteria,
            "greeting": request.greeting,
            "is_first_call": request.isFirstCall,
            "conversation_history": [
                {"role": message.role, "content": message.content}
                for message in request.conversationHistory
            ],
            "latest_caller_transcript": transcript,
        },
        ensure_ascii=False,
    )


def _decision(raw: str) -> tuple[str, bool]:
    """Accepts only a valid answer and boolean completion decision."""
    try:
        result = json.loads(raw)
        if (
            not isinstance(result, dict)
            or not isinstance(result.get("answer"), str)
            or not result["answer"].strip()
            or not isinstance(result.get("intentComplete"), bool)
        ):
            raise ValueError("invalid decision shape")
        return result["answer"].strip(), result["intentComplete"]
    except (json.JSONDecodeError, ValueError, TypeError):
        logger.warning("stage=llm invalid_decision; using safe clarification")
        return "Sorry, I didn't catch that. Could you say that again?", False


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
    raw_decision = await complete(_prompt(request, transcript))
    answer, intent_complete = _decision(raw_decision)
    if not transcript.strip():
        intent_complete = False
    logger.info("stage=llm complete answer_chars=%s", len(answer))
    logger.info("stage=tts start")
    audio, content_type = await synthesize(answer)
    logger.info("stage=tts complete audio_bytes=%s", len(audio))
    return SessionResponse(
        sessionId=str(uuid4()),
        transcript=transcript,
        answer=answer,
        intentComplete=intent_complete,
        audioBase64=encode(audio),
        audioContentType=content_type,
    )
