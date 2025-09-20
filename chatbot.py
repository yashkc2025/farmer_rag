"""
KhetSense AI chatbot integration using Google Gemini 2.0 Flash (google.genai).
Supports:
- Multimodal input (image + text)
- Contextual RAG integration
- Consistent persona + language adaptation
"""
import os
import logging
from typing import Optional
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Access environment variables
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
SARVAM_API_KEY = os.getenv('SARVAM_API_KEY')

# Validate required environment variables
if not GEMINI_API_KEY or not SARVAM_API_KEY:
    raise ValueError("Missing required environment variables. Please check your .env file.")
from google import genai

from rag_retrieve import retrieve_top_k

# -------------------------
# Gemini client init
# -------------------------
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise RuntimeError("GEMINI_API_KEY not set in environment.")

client = genai.Client(api_key=api_key)

# -------------------------
# System prompt
# -------------------------
_system_prompt = (
    "You are KhetSense AI, a friendly and knowledgeable AI-powered assistant for Indian farmers. "
    "You are provided context based on kisan call center data - use this context to answer the user's questions and give genuine chat responses for valid questions. "
    "Always detect the language of the user's latest question (English, Hindi, or Hinglish) "
    "and reply in that same language. "
    "Keep your answers short, practical, and under 3 sentences. Use simple words. "
    "If the user uploads an image, briefly describe it and give one clear suggestion. "
    "If unsure, ask one clarifying question OR suggest calling the Kisan Call Centre at 1800 180 1551. "
    "Avoid bullet points, lists, or markdown formatting unless absolutely necessary."
)

MAX_IMAGE_SIZE = 4 * 1024 * 1024  # 4 MB


def get_system_prompt() -> str:
    """Expose system prompt safely."""
    return _system_prompt


def is_available() -> bool:
    """Returns True if chatbot backend is configured and available."""
    return client is not None


def ask(history: list[dict], use_rag: bool = True) -> str:
    """
    Handles text-only queries with optional RAG context.
    history: list of {"role": "user"/"agent", "content": str}
    """
    if not is_available():
        raise RuntimeError("Chatbot service unavailable.")

    contents = []

    # Step 1: Add system prompt (+ optional RAG context)
    if use_rag and history:
        latest_question = next(
            (h["content"] for h in reversed(history) if h["role"] == "user"), ""
        )
        top_chunks = retrieve_top_k(latest_question, k=5)
        rag_context = "\n".join(top_chunks)
        contents.append({
            "role": "user",
            "parts": [{"text": _system_prompt + "\n\nUse this context:\n" + rag_context}]
        })
        logging.info("🔍 Retrieved RAG context with %d chunks")
        for i, chunk in enumerate(top_chunks, 1):
            logging.info(f"{i}. {chunk[:80]}...")
    else:
        contents.append({
            "role": "user",
            "parts": [{"text": _system_prompt}]
        })

    # Step 2: Add conversation history
    for entry in history:
        role = "user" if entry["role"] == "user" else "model" if entry["role"] == "agent" else "system"
        if role != "system":  # skip system role from history
            contents.append({
                "role": role,
                "parts": [{"text": entry["content"]}]
            })

    # Step 3: Call Gemini
    try:
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=contents
        )
        return response.text.strip() if hasattr(response, 'text') else str(response)
    except Exception as e:
        logging.exception("Gemini API error:")
        raise RuntimeError(f"Gemini error: {str(e)}")


def ask_with_image(
    image_bytes: Optional[bytes],
    message: str,
    mime_type: str = "image/png",
    use_rag: bool = True
) -> str:
    """
    Handles queries with optional image + text and integrates RAG.
    """
    if not is_available():
        raise RuntimeError("Chatbot service unavailable.")

    try:
        # Prepare system prompt and user message
        prompt_with_system = f"{_system_prompt}\n\nDescribe this image and respond to: {message}"
        
        # Create parts array with system prompt and image
        parts = [{"text": prompt_with_system}]
        if image_bytes:
            if len(image_bytes) > MAX_IMAGE_SIZE:
                raise ValueError("Image is too large. Please upload an image smaller than 4MB.")
            parts.append({"inline_data": {"mime_type": mime_type, "data": image_bytes}})

        # Step 1: Image + message goes to Gemini
        img_response = client.models.generate_content(
            model="gemini-2.0-flash",  # Using vision model for image
            contents=[{"role": "user", "parts": parts}]
        )
        image_description = img_response.text.strip()

        # Step 2: Combine image description + message
        full_combined_prompt = f"Based on the image analysis: {image_description}\n\nUser's question: {message}"
        logging.info("Image described as: %s", full_combined_prompt)

        # Step 3: Get RAG context
        if use_rag:
            logging.info("Getting RAG context...")
            top_chunks = retrieve_top_k(message, k=5)  # Using original message for better matching
            rag_context = "\n".join(top_chunks)
            logging.info("🔍 Retrieved %d relevant chunks", len(top_chunks))
            
            # Combine everything: system prompt + RAG + image analysis + question
            full_combined_prompt = (
                f"{_system_prompt}\n\n"
                f"Relevant farming information:\n{rag_context}\n\n"
                f"{full_combined_prompt}"
            )
        else:
            full_combined_prompt = f"{_system_prompt}\n\n{full_combined_prompt}"

        # Step 4: Final call to Gemini for complete response
        final_response = client.models.generate_content(
            model="gemini-2.0-flash",  # Using standard model for text response
            contents=[{
                "role": "user",
                "parts": [{"text": full_combined_prompt}]
            }]
        )

        return final_response.text.strip() if hasattr(final_response, 'text') else str(final_response)

    except Exception as e:
        logging.exception("Gemini image+text error:")
        raise RuntimeError(f"Gemini error: {str(e)}")


# -------------------------
# Optional test run
# -------------------------
def main():
    """Quick test if running directly."""
    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents="Explain how AI helps agriculture in one sentence",
    )
    logging.info(response.text)


if __name__ == "__main__":
    main()