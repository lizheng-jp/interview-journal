"""Private single-owner recording API. Put behind authenticated TLS reverse proxy before exposing."""
import os
import math
import time
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from .database import Base, engine, get_db
from .models import Recording, Segment, WorkerLease
from .media import prepare_audio

OWNER = os.getenv('OWNER_ID', 'local-owner')
if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', OWNER):
    raise RuntimeError('OWNER_ID must contain only letters, digits, underscores or hyphens')
LANGUAGES = {'en', 'ja', 'zh', 'auto'}
STORAGE_DIR = Path(os.getenv('STORAGE_DIR', str(Path(__file__).resolve().parents[2] / '.storage' / 'audio'))).resolve()
MAX_UPLOAD = int(os.getenv('MAX_UPLOAD_MB', '100')) * 1024 * 1024
MIME_EXTENSIONS = {
    'audio/webm': '.webm', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a',
    'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
    'audio/ogg': '.ogg', 'audio/aac': '.aac',
}
CATEGORIES = {'behavioral', 'coding', 'system-design', 'english', 'other'}
Base.metadata.create_all(bind=engine)  # initial MVP; use Alembic before public multi-user release
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
app = FastAPI(title='Interview Journal API', docs_url=None, redoc_url=None)
ALLOWED_ORIGINS = {value.strip().rstrip('/') for value in os.getenv('APP_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:13080,http://127.0.0.1:13080').split(',') if value.strip()}

@app.middleware('http')
async def origin_guard(request: Request, call_next):
    # Browser mutations send Origin; reject cross-site forms even behind Basic Auth.
    # Non-browser clients still require the deployment's authentication boundary.
    origin = request.headers.get('origin')
    if request.method not in {'GET', 'HEAD', 'OPTIONS'} and origin and origin.rstrip('/') not in ALLOWED_ORIGINS:
        return JSONResponse({'detail': 'Untrusted request origin'}, status_code=403)
    return await call_next(request)


class PatchRecording(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    category: str | None = None
    language: str | None = Field(default=None, max_length=12)
    tags: str | None = Field(default=None, max_length=300)
    notes: str | None = Field(default=None, max_length=5000)

class SegmentUpdate(BaseModel):
    text: str = Field(max_length=5000)


def get_recording(db: Session, recording_id: str, lock: bool = False) -> Recording:
    statement = select(Recording).where(Recording.id == recording_id, Recording.owner_id == OWNER)
    if lock:
        statement = statement.with_for_update()
    rec = db.scalar(statement)
    if rec is None:
        raise HTTPException(404, 'Recording not found')
    return rec


def response(rec: Recording, include_segments: bool = False) -> dict:
    payload = {
        'id': rec.id, 'title': rec.title, 'category': rec.category, 'language': rec.language,
        'tags': [x for x in rec.tags.split(',') if x], 'notes': rec.notes,
        'duration_seconds': rec.duration_seconds, 'size_bytes': rec.size_bytes,
        'mime_type': rec.mime_type, 'created_at': (rec.created_at if rec.created_at.tzinfo else rec.created_at.replace(tzinfo=timezone.utc)).isoformat(),
        'transcription_status': rec.transcription_status, 'transcription_error': rec.transcription_error,
        'audio_url': f'/api/recordings/{rec.id}/audio',
    }
    if include_segments:
        payload['segments'] = [dict(id=s.id, start=s.start_seconds, end=s.end_seconds, text=s.text) for s in rec.segments]
    return payload

@app.get('/api/health')
def health(db: Session = Depends(get_db)):
    db.execute(select(1))
    lease = db.get(WorkerLease, 1)
    online = bool(lease and lease.expires_at > time.time() and lease.heartbeat_at > time.time() - 60)
    return {'status': 'ok', 'transcription_worker': 'online' if online else 'offline'}

@app.get('/api/categories')
def categories():
    return [{'id': i, 'name': n} for i, n in [
        ('behavioral', 'Behavioral'), ('coding', 'Coding'),
        ('system-design', 'System Design'), ('english', 'English Practice'), ('other', 'Other')]]

@app.get('/api/recordings')
def list_recordings(q: str = '', category: str = '', language: str = '', status: str = '', limit: int = 50, offset: int = 0, db: Session = Depends(get_db)):
    if limit < 1 or limit > 250 or offset < 0:
        raise HTTPException(422, 'Invalid pagination')
    statement = select(Recording).where(Recording.owner_id == OWNER)
    if category and category != 'all':
        statement = statement.where(Recording.category == category)
    if language:
        statement = statement.where(Recording.language == language)
    if status:
        statement = statement.where(Recording.transcription_status == status)
    if q:
        term = f'%{q[:100]}%'
        statement = statement.where(or_(Recording.title.ilike(term), Recording.notes.ilike(term), Recording.tags.ilike(term), Recording.id.in_(select(Segment.recording_id).where(Segment.text.ilike(term)))))
    items = db.scalars(statement.order_by(Recording.created_at.desc(), Recording.id).offset(offset).limit(limit)).all()
    return [response(item) for item in items]

@app.get('/api/stats')
def stats(db: Session = Depends(get_db)):
    rows = db.execute(select(Recording.category, func.count(Recording.id), func.coalesce(func.sum(Recording.duration_seconds), 0)).where(Recording.owner_id == OWNER).group_by(Recording.category)).all()
    return {'total_sessions': sum(x[1] for x in rows), 'total_seconds': round(sum(x[2] for x in rows)), 'by_category': [{'category': c, 'count': n, 'seconds': round(seconds)} for c, n, seconds in rows]}

@app.post('/api/recordings', status_code=201)
async def create_recording(
    file: Annotated[UploadFile, File()], title: Annotated[str, Form()],
    category: Annotated[str, Form()] = 'other', language: Annotated[str, Form()] = 'en',
    tags: Annotated[str, Form()] = '', notes: Annotated[str, Form()] = '',
    duration_seconds: Annotated[float, Form()] = 0,
    db: Session = Depends(get_db),
):
    if category not in CATEGORIES or not title.strip() or len(title) > 160 or len(notes) > 5000 or len(tags) > 300 or language not in LANGUAGES or not math.isfinite(duration_seconds) or duration_seconds < 0 or duration_seconds > 12 * 3600:
        raise HTTPException(422, 'Invalid recording metadata')
    mime = (file.content_type or '').split(';', 1)[0].lower()
    if mime not in MIME_EXTENSIONS:
        raise HTTPException(415, f'Unsupported audio format: {mime}')
    rec_id = str(uuid.uuid4())
    key = f'{OWNER}/{rec_id}{MIME_EXTENSIONS[mime]}'
    path = STORAGE_DIR / key
    path.parent.mkdir(parents=True, exist_ok=True)
    length = 0
    try:
        with path.open('xb') as output:
            while chunk := await file.read(1024 * 1024):
                length += len(chunk)
                if length > MAX_UPLOAD:
                    raise HTTPException(413, f'Audio exceeds {MAX_UPLOAD // 1024 // 1024} MB')
                output.write(chunk)
        if length == 0:
            raise HTTPException(422, 'Empty audio')
        try:
            duration_seconds = await run_in_threadpool(prepare_audio, path)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        record = Recording(id=rec_id, owner_id=OWNER, title=title.strip(), category=category,
                           language=language, tags=','.join(x.strip() for x in tags.split(',') if x.strip()),
                           notes=notes, duration_seconds=duration_seconds, size_bytes=path.stat().st_size,
                           mime_type=mime, storage_key=key)
        db.add(record)
        db.commit()
        db.refresh(record)
        return response(record)
    except Exception:
        db.rollback()
        path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()

@app.get('/api/recordings/{recording_id}')
def detail(recording_id: str, db: Session = Depends(get_db)):
    return response(get_recording(db, recording_id), include_segments=True)

@app.get('/api/recordings/{recording_id}/audio')
def audio(recording_id: str, db: Session = Depends(get_db)):
    record = get_recording(db, recording_id)
    path = STORAGE_DIR / record.storage_key  # value generated by server, never user input
    if not path.is_file():
        raise HTTPException(404, 'Audio unavailable')
    return FileResponse(path, media_type=record.mime_type, filename=f'interview-{record.id}{path.suffix}', content_disposition_type='inline')

@app.patch('/api/recordings/{recording_id}')
def patch(recording_id: str, data: PatchRecording, db: Session = Depends(get_db)):
    rec = get_recording(db, recording_id, lock=True)
    fields = data.model_dump(exclude_unset=True)
    if 'category' in fields and fields['category'] not in CATEGORIES:
        raise HTTPException(422, 'Invalid category')
    if fields.get('language') is not None and fields['language'] not in LANGUAGES:
        raise HTTPException(422, 'Invalid language')
    if fields.get('title') is not None:
        fields['title'] = fields['title'].strip()
        if not fields['title']:
            raise HTTPException(422, 'Title cannot be blank')
    if fields.get('language') not in (None, rec.language):
        if rec.transcription_status == 'processing':
            raise HTTPException(409, 'Wait for transcription to finish before changing language')
        rec.transcription_status = 'pending'
        rec.transcription_error = None
        rec.segments.clear()
    for key, value in fields.items():
        if value is None:
            continue
        setattr(rec, key, ','.join(x.strip() for x in value.split(',') if x.strip()) if key == 'tags' else value)
    db.commit()
    return response(rec, include_segments=True)

@app.patch('/api/recordings/{recording_id}/segments/{segment_id}')
def patch_segment(recording_id: str, segment_id: int, data: SegmentUpdate, db: Session = Depends(get_db)):
    rec = get_recording(db, recording_id, lock=True)
    if rec.transcription_status != 'completed':
        raise HTTPException(409, 'Wait for a completed transcript before editing')
    segment = db.scalar(select(Segment).where(Segment.recording_id == recording_id, Segment.id == segment_id))
    if not segment:
        raise HTTPException(404, 'Segment not found')
    segment.text = data.text
    db.commit()
    return {'ok': True}

@app.post('/api/recordings/{recording_id}/retry-transcription')
def retry(recording_id: str, db: Session = Depends(get_db)):
    rec = get_recording(db, recording_id, lock=True)
    if rec.transcription_status == 'processing':
        raise HTTPException(409, 'Transcription already in progress')
    rec.transcription_status = 'pending'
    rec.transcription_error = None
    db.commit()
    return {'ok': True}

@app.delete('/api/recordings/{recording_id}', status_code=204)
def delete(recording_id: str, db: Session = Depends(get_db)):
    rec = get_recording(db, recording_id, lock=True)
    if rec.transcription_status == 'processing':
        raise HTTPException(409, 'Wait for transcription to finish before deleting')
    key = rec.storage_key
    db.delete(rec)
    db.commit()
    (STORAGE_DIR / key).unlink(missing_ok=True)
