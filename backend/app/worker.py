"""Opt-in CPU INT8 worker. A renewable singleton lease prevents duplicate work."""
import argparse
import logging
import os
import threading
import time
import uuid
from pathlib import Path
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from .database import Base, SessionLocal, engine
from .models import Recording, Segment, WorkerLease

log = logging.getLogger(__name__)
STORAGE = Path(os.getenv('STORAGE_DIR', str(Path(__file__).resolve().parents[2] / '.storage' / 'audio')))
MODEL_NAME = os.getenv('WHISPER_MODEL', 'base')
LEASE_SECONDS = 120


def acquire_lease(token: str) -> bool:
    with SessionLocal() as db:
        try:
            db.add(WorkerLease(id=1))
            db.commit()
        except IntegrityError:
            db.rollback()
        result = db.execute(update(WorkerLease).where(WorkerLease.id == 1, WorkerLease.expires_at < time.time()).values(token=token, expires_at=time.time() + LEASE_SECONDS, heartbeat_at=0))
        db.commit()
        return result.rowcount == 1


def renew(token: str, ready: bool = True) -> bool:
    with SessionLocal.begin() as db:
        values = {'expires_at': time.time() + LEASE_SECONDS}
        if ready:
            values['heartbeat_at'] = time.time()
        return db.execute(update(WorkerLease).where(WorkerLease.id == 1, WorkerLease.token == token).values(**values)).rowcount == 1


def process_next(model, token: str) -> bool:
    with SessionLocal.begin() as db:
        lease = db.get(WorkerLease, 1)
        if not lease or lease.token != token or lease.expires_at < time.time():
            raise RuntimeError('Worker lease lost')
        statement = select(Recording).where(Recording.transcription_status == 'pending').order_by(Recording.created_at).limit(1)
        if engine.dialect.name == 'postgresql':
            statement = statement.with_for_update(skip_locked=True)
        rec = db.scalar(statement)
        if not rec:
            return False
        rec_id, filename, lang = rec.id, STORAGE / rec.storage_key, rec.language
        rec.transcription_status = 'processing'
    try:
        segments, _ = model.transcribe(str(filename), language=None if lang == 'auto' else lang, vad_filter=True, beam_size=3)
        result = [Segment(recording_id=rec_id, start_seconds=round(s.start, 2), end_seconds=round(s.end, 2), text=s.text.strip()) for s in segments]
        with SessionLocal.begin() as db:
            lease = db.get(WorkerLease, 1)
            rec = db.get(Recording, rec_id)
            if rec and rec.transcription_status == 'processing' and lease.token == token and lease.expires_at > time.time():
                rec.segments.clear()
                rec.segments.extend(result)
                rec.transcription_status = 'completed'
                rec.transcription_error = None
        log.info('Transcribed %s (%d segments)', rec_id, len(result))
    except Exception:
        log.exception('Transcription failed for %s', rec_id)
        with SessionLocal.begin() as db:
            lease = db.get(WorkerLease, 1)
            rec = db.get(Recording, rec_id)
            if rec and lease.token == token and lease.expires_at > time.time():
                rec.transcription_status = 'failed'
                rec.transcription_error = 'Transcription failed. Check worker logs and retry.'
    return True


def run(once: bool = False, limit: int = 0):
    Base.metadata.create_all(bind=engine)
    token = str(uuid.uuid4())
    if not acquire_lease(token):
        raise RuntimeError('Another worker holds the lease; wait until it stops or its lease expires')
    stop = threading.Event()
    ready = threading.Event()
    def heartbeat():
        while not stop.wait(20):
            if not renew(token, ready.is_set()):
                stop.set()
    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    try:
        from faster_whisper import WhisperModel
        model = WhisperModel(MODEL_NAME, download_root=os.getenv('WHISPER_DOWNLOAD_ROOT'), device='cpu', compute_type='int8', cpu_threads=int(os.getenv('WHISPER_CPU_THREADS', '1')), num_workers=1)
        ready.set()
        renew(token)
        # Only the holder of a fresh lease may reclaim an interrupted job.
        with SessionLocal.begin() as db:
            db.execute(update(Recording).where(Recording.transcription_status == 'processing').values(transcription_status='pending'))
        log.info('Worker ready: model=%s cpu int8', MODEL_NAME)
        count = 0
        while not stop.is_set():
            found = process_next(model, token)
            count += int(found)
            if once or (limit and count >= limit):
                break
            if not found:
                stop.wait(4)
    finally:
        stop.set()
        thread.join(timeout=2)
        with SessionLocal.begin() as db:
            db.execute(update(WorkerLease).where(WorkerLease.token == token).values(expires_at=0, heartbeat_at=0))

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser()
    parser.add_argument('--once', action='store_true', help='Process at most one job, then stop')
    parser.add_argument('--limit', type=int, default=0, help='Stop after this many jobs; zero polls indefinitely')
    args = parser.parse_args()
    run(args.once, args.limit)
