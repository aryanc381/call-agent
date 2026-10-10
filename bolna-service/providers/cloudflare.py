import base64

import httpx

from config import settings


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.cloudflare_api_token}"}


async def transcribe(audio: bytes, content_type: str) -> str:
    """Transcribes audio with Cloudflare's documented Grok STT endpoint."""
    data_uri = f"data:{content_type};base64,{base64.b64encode(audio).decode()}"
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/"
        f"{settings.cloudflare_account_id}/ai/run?model={settings.cloudflare_stt_model}"
    )
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(url, headers=_headers(), json={"file": data_uri})
        response.raise_for_status()
    payload = response.json()
    result = payload.get("result", payload)
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
        response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"].strip()
