from typing import Literal

from pydantic import BaseModel, Field


class Contact(BaseModel):
    name: str = Field(min_length=1)
    context: str = Field(min_length=1)


class ConversationMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class SessionRequest(BaseModel):
    audioBase64: str | None = None
    audioContentType: str | None = None
    contact: Contact
    personality: str = Field(min_length=1)
    conversationHistory: list[ConversationMessage] = Field(default_factory=list)


class SessionResponse(BaseModel):
    sessionId: str
    transcript: str
    answer: str
    audioBase64: str
    audioContentType: str
