from pydantic import BaseModel, Field


class Contact(BaseModel):
    name: str = Field(min_length=1)
    relation: str = Field(min_length=1)
    relationDescription: str = Field(min_length=1)
    closeness: str = Field(min_length=1)


class SessionRequest(BaseModel):
    audioBase64: str = Field(min_length=1)
    audioContentType: str = Field(min_length=1)
    contact: Contact
    question: str = Field(min_length=1)
    context: str = Field(min_length=1)
    personality: str = Field(min_length=1)
    isFirstCall: bool


class SessionResponse(BaseModel):
    sessionId: str
    transcript: str
    answer: str
    audioBase64: str
    audioContentType: str
