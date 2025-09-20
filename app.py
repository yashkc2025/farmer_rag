import os
import logging
import shutil
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse

# Import router directly (since routes.py is in the same folder now)
from routes import router  

# Configure logging for the whole app
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[logging.StreamHandler()],
)

# Load environment variables from .env file
load_dotenv()

app = FastAPI(
    title="KhetSense API",
    description="API for KhetSense AI-Powered Farmer Assistant with RAG-based agricultural support, Image disease detection, multi-modal chat capabilities",
    version="1.0.0",
)

# Enable CORS for all origins (for development)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Directories for audio files
audio_output_dir = "audio_files"
recordings_dir = os.path.join(audio_output_dir, "recordings")


def reset_audio_folder():
    """Helper to clear and recreate audio folders safely."""
    try:
        shutil.rmtree(audio_output_dir)
    except FileNotFoundError:
        pass  # Folder already gone, safe to ignore
    except Exception as e:
        logging.error(f"Failed to remove {audio_output_dir}: {e}")

    os.makedirs(audio_output_dir, exist_ok=True)
    os.makedirs(recordings_dir, exist_ok=True)
    logging.info("♻️ Audio folder reset")


@app.on_event("startup")
def clear_audio_folder():
    """Clear old audio files when app starts fresh."""
    reset_audio_folder()
    logging.info("🧹 Cleared old audio files at startup")


# ✅ Manual reset endpoint (can be called from frontend on refresh)
@app.post("/reset-audio")
def reset_audio():
    reset_audio_folder()
    return JSONResponse(content={"status": "success", "message": "Audio folder reset"})


# Mount the directory to serve audio files
app.mount("/audio", StaticFiles(directory=audio_output_dir), name="audio")

# Include all routes
app.include_router(router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
