import os
import uuid
import logging
from dotenv import load_dotenv
from io import BytesIO
from sarvamai import SarvamAI
from sarvamai.play import save

# Load environment variables
load_dotenv()

SARVAM_API_KEY = os.getenv("SARVAM_API_KEY")
if not SARVAM_API_KEY:
    raise RuntimeError("SARVAM_API_KEY not set in environment. Please add it to your .env file.")

client = SarvamAI(api_subscription_key=SARVAM_API_KEY)

# Voice model mapping
VOICE_MODEL_MAPPING = {
    "en-IN": {"model": "bulbul:v2", "speaker": "anushka"},
    "hi-IN": {"model": "bulbul:v2", "speaker": "anushka"},
    "bn-IN": {"model": "bulbul:v2", "speaker": "anushka"},
    "te-IN": {"model": "bulbul:v2", "speaker": "anushka"},
    "mr-IN": {"model": "bulbul:v2", "speaker": "anushka"},
    "ta-IN": {"model": "bulbul:v2", "speaker": "anushka"},
    "gu-IN": {"model": "bulbul:v2", "speaker": "anushka"},
}

# Keep all audio files in ./audio_files/
AUDIO_DIR = "audio_files"
os.makedirs(AUDIO_DIR, exist_ok=True)


def text_to_speech(text: str, language: str = "en-IN") -> str | None:
    """
    Converts text to speech using Sarvam AI SDK and saves the audio file locally.
    Returns the web-accessible URL for the audio file.
    """
    try:
        voice_config = VOICE_MODEL_MAPPING.get(language, VOICE_MODEL_MAPPING["en-IN"])
        logging.info(f"Generating TTS for language: {language} with config: {voice_config}")

        audio = client.text_to_speech.convert(
            text=text,
            target_language_code=language,
            model=voice_config["model"],
            speaker=voice_config["speaker"],
            enable_preprocessing=True
        )

        filename = f"{uuid.uuid4()}.wav"
        filepath = os.path.join(AUDIO_DIR, filename)
        save(audio, filepath)

        logging.info(f"Audio saved to {filepath}")
        return f"/audio/{filename}"
    except Exception as e:
        logging.exception("Sarvam TTS SDK Error:")
        return None


def speech_to_text(audio_file_path: str, language_code: str = "hi-IN", model: str = "saarika:v2.5") -> str | None:
    """
    Transcribes speech to text from a given audio file path using Sarvam AI SDK.
    """
    try:
        if not os.path.exists(audio_file_path):
            logging.error(f"ASR: File does not exist: {audio_file_path}")
            return None

        file_size = os.path.getsize(audio_file_path)
        if file_size == 0:
            logging.error(f"ASR: File is empty: {audio_file_path}")
            return None

        logging.info(f"ASR: Transcribing file {audio_file_path} (size: {file_size} bytes), language_code={language_code}, model={model}")

        with open(audio_file_path, "rb") as audio_file:
            response = client.speech_to_text.transcribe(
                file=audio_file,
                language_code=language_code,
                model=model
            )

        transcript = getattr(response, 'transcript', None)
        if not transcript:
            logging.error(f"ASR: No transcript returned. Response: {response}")
        else:
            logging.info(f"ASR: Transcript: {transcript}")

        return transcript
    except Exception:
        logging.exception(f"ASR: Exception during transcription of {audio_file_path}")
        return None


def speech_to_text_bytes(audio_bytes: bytes, language_code: str = "hi-IN", model: str = "saarika:v2.5") -> str | None:
    """
    Transcribes speech to text from in-memory audio bytes using Sarvam AI SDK.
    """
    try:
        audio_file = BytesIO(audio_bytes)
        response = client.speech_to_text.transcribe(
            file=audio_file,
            language_code=language_code,
            model=model
        )

        transcript = getattr(response, 'transcript', None)
        if not transcript:
            logging.error(f"ASR: No transcript returned. Response: {response}")
        else:
            logging.info(f"ASR: Transcript: {transcript}")

        return transcript
    except Exception:
        logging.exception("ASR: Exception during transcription of in-memory audio")
        return None
