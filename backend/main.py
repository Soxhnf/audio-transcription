from fastapi import FastAPI, UploadFile, File
import whisper
import shutil
import os
from fastapi.middleware.cors import CORSMiddleware
from pydub import AudioSegment

app = FastAPI()

# === CORS ===
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === Whisper model ===
model = whisper.load_model("base")

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    file_path = f"{UPLOAD_DIR}/{file.filename}"

    # Save uploaded file
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Convert to WAV for better compatibility
    wav_path = file_path.rsplit(".", 1)[0] + ".wav"
    audio = AudioSegment.from_file(file_path)
    audio.export(wav_path, format="wav")

    # Transcribe
    result = model.transcribe(wav_path)

    return {"text": result["text"]}
