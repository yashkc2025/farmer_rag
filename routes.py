from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form, Request
from pydantic import BaseModel
from typing import Optional
import os
import uuid
import logging
from fastapi.responses import JSONResponse
from cachetools import TTLCache

from chatbot import is_available, ask, ask_with_image, get_system_prompt
from sarvam import speech_to_text, text_to_speech, speech_to_text_bytes  # updated import

router = APIRouter(
    prefix="/api",
    tags=["KhetSense AI"]
)

SUPPORTED_LANGUAGES = {
    "en-IN", "hi-IN", "bn-IN", "te-IN", "mr-IN", "ta-IN", "gu-IN"
}

# In-memory session chat history
chat_sessions = {}


def add_history(history, role, content):
    history.append({"role": role, "content": content})
    return history

# -------------------------
# Utility endpoints
# -------------------------

@router.post("/save-audio")
async def save_audio(audio: UploadFile = File(...)):
    recordings_dir = "audio_files/recordings"   # ✅ updated path
    os.makedirs(recordings_dir, exist_ok=True)

    filename = f"{uuid.uuid4()}.wav"
    file_path = os.path.join(recordings_dir, filename)

    with open(file_path, "wb") as f:
        f.write(await audio.read())

    logging.info(f"Audio file saved: {file_path}")
    return {"message": "Audio saved", "file_path": file_path}


@router.get("/health")
async def health_check():
    return {"status": "ok"}


# -------------------------
# Chat endpoints
# -------------------------

@router.post("/chat")
async def chat(
    message: str = Form(...),
    session_id: Optional[str] = Form(None),
    location: Optional[str] = Form(None)
):
    """Text-only chat endpoint using Gemini with RAG integration."""
    if not is_available():
        raise HTTPException(status_code=503, detail="Chatbot service unavailable.")

    try:
        # Initialize or get session
        if not session_id:
            session_id = str(uuid.uuid4())
        history = chat_sessions.get(session_id, [])
        
        logging.info(f"[SESSION: {session_id}] Processing message. History length: {len(history)}")

        # Add location context if provided
        full_message = f"Context: The user is in {location}. Question: {message}" if location else message
        
        # Add user message to history
        add_history(history, "user", full_message)
        
        # Get response using RAG and chat history
        reply = ask(history, use_rag=True)  # RAG is handled inside ask()
        
        # Add bot response to history
        add_history(history, "agent", reply)
        
        # Update session
        chat_sessions[session_id] = history
        
        logging.info(f"[SESSION: {session_id}] Response generated successfully")
        return {
            "response": reply,
            "session_id": session_id
        }
        
    except Exception as e:
        logging.exception("Chat error:")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat/image")
async def chat_with_image_endpoint(
    image: UploadFile = File(...),
    message: str = Form(...),
    session_id: Optional[str] = Form(None),
    location: Optional[str] = Form(None)
):
    """Chat endpoint for image + text using Gemini with RAG integration."""
    if not is_available():
        raise HTTPException(status_code=503, detail="Chatbot service unavailable.")

    try:
        # Initialize or get session
        if not session_id:
            session_id = str(uuid.uuid4())
        history = chat_sessions.get(session_id, [])

        logging.info(f"[SESSION: {session_id}] Processing image message")
        
        # Read image
        image_bytes = await image.read()
        
        # Build context with location and message
        context_items = []
        if location:
            context_items.append(f"User's Location: {location}")
        context_items.append(f"User's Question: {message}")
        full_message = "\n".join(context_items)

        # Get response using image, context, and RAG
        reply = ask_with_image(
            image_bytes=image_bytes,
            message=full_message,
            mime_type=image.content_type or "image/png",
            use_rag=True  # This will:
                         # 1. Process image to text
                         # 2. Combine with question
                         # 3. Get relevant RAG chunks
                         # 4. Generate response
        )

        # Update history with the interaction
        add_history(history, "user", f"[Image uploaded] {message}")
        add_history(history, "agent", reply)
        chat_sessions[session_id] = history

        logging.info(f"[SESSION: {session_id}] Image response generated successfully")
        return {
            "response": reply,
            "session_id": session_id
        }
    except Exception as e:
        logging.error(f"Image chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat/reset")
async def reset_chat(session_id: str = Form(...)):
    if session_id in chat_sessions:
        del chat_sessions[session_id]
        return {"message": "Session reset", "session_id": session_id}
    return {"message": "Session not found", "session_id": session_id}


# -------------------------
# Speech endpoints
# -------------------------

class SpeakRequest(BaseModel):
    text: str
    language: Optional[str] = "en-IN"
    voice: Optional[str] = "female"


@router.post("/speak")
async def speak_endpoint(request_body: SpeakRequest, request: Request):
    """Text-to-Speech endpoint."""
    from fastapi.concurrency import run_in_threadpool
    try:
        if request_body.language not in SUPPORTED_LANGUAGES:
            raise HTTPException(status_code=400, detail="Unsupported language selected.")
        relative_audio_url = await run_in_threadpool(text_to_speech, request_body.text, request_body.language)
        if relative_audio_url is None:
            raise HTTPException(status_code=500, detail="TTS failed using Sarvam SDK")
        absolute_audio_url = f"{str(request.base_url).rstrip('/')}{relative_audio_url}"
        return {"audio_url": absolute_audio_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/transcribe")
async def transcribe_endpoint(audio: UploadFile = File(...), language: str = Form("en-IN")):
    """Speech-to-Text endpoint."""
    from fastapi.concurrency import run_in_threadpool
    if language not in SUPPORTED_LANGUAGES:
        raise HTTPException(status_code=400, detail="Unsupported language selected.")
    try:
        audio_bytes = await audio.read()
        transcript = await run_in_threadpool(speech_to_text_bytes, audio_bytes, language)
    except Exception as e:
        logging.error(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")
    if transcript is None:
        raise HTTPException(status_code=500, detail="ASR failed using Sarvam SDK.")
    return {"transcript": transcript}


@router.post("/audio-chat")
async def audio_chat(
    audio: UploadFile = File(...),
    language: str = Form("en-IN"),
    session_id: Optional[str] = Form(None),
    location: Optional[str] = Form(None)
):
    """End-to-end audio chat: transcribe → Gemini → respond."""
    from fastapi.concurrency import run_in_threadpool
    if language not in SUPPORTED_LANGUAGES:
        raise HTTPException(status_code=400, detail="Unsupported language selected.")
    try:
        audio_bytes = await audio.read()
        transcript = await run_in_threadpool(speech_to_text_bytes, audio_bytes, language)
        if not transcript:
            raise HTTPException(status_code=500, detail="ASR failed using Sarvam SDK.")
        if not session_id:
            session_id = str(uuid.uuid4())
        history = chat_sessions.get(session_id, [])
        if not any(h["role"] == "system" for h in history):
            add_history(history, "system", get_system_prompt())
        contextual_message = f"Context: The user is in {location}. Question: {transcript}" if location else transcript
        add_history(history, "user", contextual_message)
        reply = await run_in_threadpool(ask, history)
        add_history(history, "agent", reply)
        chat_sessions[session_id] = history
        return {
            "transcript": transcript,
            "response": reply,
            "session_id": session_id
        }
    except Exception as e:
        logging.exception(f"Audio chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))