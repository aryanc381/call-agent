import base64
import logging

import httpx

from config import settings

logger = logging.getLogger("call-agent.media")


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.cloudflare_api_token}"}


async def transcribe(audio: bytes, content_type: str) -> str:
    """Transcribes audio with Cloudflare's documented Grok STT endpoint."""
    data_uri = f"data:{content_type};base64,{base64.b64encode(audio).decode()}"
    url = f"https://api.cloudflare.com/client/v4/accounts/{settings.cloudflare_account_id}/ai/run"
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(url, headers={**_headers(), "Content-Type": "application/json"}, json={"model": settings.cloudflare_stt_model, "input": {"file": data_uri}})
        logger.info("provider=cloudflare stage=stt status=%s", response.status_code)
        if response.is_error:
            logger.error("provider=cloudflare stage=stt error=%s", response.text[:500])
        response.raise_for_status()
    payload = response.json()
    result = payload.get("result")
    if not isinstance(result, dict) or not isinstance(result.get("text"), str):
        logger.error(
            "provider=cloudflare stage=stt invalid_response state=%s payload_keys=%s result_keys=%s",
            payload.get("state"),
            sorted(payload.keys()),
            sorted(result.keys()) if isinstance(result, dict) else [],
        )
        raise RuntimeError("Cloudflare STT returned no transcript")
    return result["text"]


async def complete(prompt: str) -> str:
    """Generates a concise answer through Cloudflare's OpenAI-compatible API."""
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/"
        f"{settings.cloudflare_account_id}/ai/v1/chat/completions"
    )
    body = {
        "model": settings.cloudflare_ai_model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(url, headers=_headers(), json=body)
        logger.info("provider=cloudflare stage=llm status=%s", response.status_code)
        if response.is_error:
            logger.error("provider=cloudflare stage=llm error=%s", response.text[:500])
        response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"].strip()
