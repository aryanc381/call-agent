import base64

import httpx

from config import settings


async def synthesize(text: str) -> tuple[bytes, str]:
    """Synthesizes WAV audio with Cartesia's documented bytes endpoint."""
    body = {
        "model_id": settings.cartesia_model_id,
        "transcript": text,
        "voice": {"mode": "id", "id": settings.cartesia_voice_id},
        "output_format": {"container": "wav", "encoding": "pcm_s16le", "sample_rate": 16000},
    }
    headers = {
        "X-API-Key": settings.cartesia_api_key,
        "Cartesia-Version": "2024-06-10",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post("https://api.cartesia.ai/tts/bytes", headers=headers, json=body)
        response.raise_for_status()
    return response.content, "audio/wav"


def encode(audio: bytes) -> str:
    """Encodes provider audio for the TypeScript session contract."""
    return base64.b64encode(audio).decode()
