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
    turn_instruction = (
        "Start the call with greeting, then ask task_question exactly once."
        if request.isFirstCall
        else "The task_question was already asked. Never greet again and never repeat it, even when the caller transcript is unclear. Respond only to the latest caller transcript using the conversation history; ask a short clarification about that transcript when needed."
    )
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
            "task_question": request.question if request.isFirstCall else None,
            "completion_criteria": request.completionCriteria,
            "greeting": request.greeting,
            "is_first_call": request.isFirstCall,
            "turn_instruction": turn_instruction,
            "conversation_history": [
                {"role": message.role, "content": message.content}
                for message in request.conversationHistory
            ],
            "latest_caller_transcript": transcript,
        },
        ensure_ascii=False,
    )


def _decision(raw: str) -> tuple[str, bool]:
    """Keeps usable model replies while requiring explicit JSON to finish a call."""
    clean = raw.strip()
    candidates = [clean]
    if clean.startswith("```") and clean.endswith("```"):
        candidates.append(clean.split("\n", 1)[-1].rsplit("```", 1)[0].strip())
    object_start = clean.find("{")
    object_end = clean.rfind("}")
    if object_start >= 0 and object_end > object_start:
        candidates.append(clean[object_start : object_end + 1])

    for candidate in candidates:
        try:
            result = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if not isinstance(result, dict) or not isinstance(result.get("answer"), str):
            continue
        answer = result["answer"].strip()
        if answer:
            intent_complete = result.get("intentComplete")
            if not isinstance(intent_complete, bool):
                logger.warning("stage=llm missing_completion_flag; continuing_call")
                intent_complete = False
            return answer, intent_complete

    control_only = clean.lower().replace("_", "").replace(" ", "").startswith(("intent:", "intentcomplete:"))
    if clean and not control_only and not (clean.startswith("{") or clean.startswith("```")):
        logger.warning("stage=llm non_json_reply; continuing_call")
        return clean, False

    logger.warning("stage=llm unusable_reply; using safe clarification")
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
