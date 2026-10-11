"""Single CPU transcription worker. Opt-in deployment; separate from API service."""
import logging
import os
import time
from pathlib import Path
from sqlalchemy import select
from .database import Base, SessionLocal, engine
from .models import Recording, Segment

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)
STORAGE = Path(os.getenv('STORAGE_DIR', str(Path(__file__).resolve().parents[2] / '.storage' / 'audio')))
MODEL_NAME = os.getenv('WHISPER_MODEL', 'base')


def run():
    from faster_whisper import WhisperModel
    # Deliberately lazy: the API stays responsive even if the model is unavailable.
    model = WhisperModel(MODEL_NAME, device='cpu', compute_type='int8', cpu_threads=int(os.getenv('WHISPER_CPU_THREADS', '1')), num_workers=1)
    Base.metadata.create_all(bind=engine)
    # On a restarted single-worker deployment, reclaim any jobs left in progress.
    with SessionLocal.begin() as db:
        for interrupted in db.scalars(select(Recording).where(Recording.transcription_status == 'processing')).all():
            interrupted.transcription_status = 'pending'
    log.info('worker ready with model=%s', MODEL_NAME)
    while True:
        rec_id = None
        with SessionLocal.begin() as db:
            stmt = select(Recording).where(Recording.transcription_status == 'pending')
            if engine.dialect.name == 'postgresql':
                stmt = stmt.with_for_update(skip_locked=True)
            rec = db.scalar(stmt.order_by(Recording.created_at.asc()).limit(1))
            if rec:
                rec_id = rec.id
                rec.transcription_status = 'processing'
        if rec_id is None:
            time.sleep(4)
            continue
        try:
            with SessionLocal() as db:
                rec = db.get(Recording, rec_id)
                filename, lang = STORAGE / rec.storage_key, rec.language
            segments, _ = model.transcribe(str(filename), language=None if lang == 'auto' else lang,
                                            vad_filter=True, beam_size=3)
            new_segments = [Segment(recording_id=rec_id, start_seconds=round(s.start, 2), end_seconds=round(s.end, 2), text=s.text.strip()) for s in segments]
            with SessionLocal.begin() as db:
                rec = db.get(Recording, rec_id)
                if rec is not None and rec.transcription_status == 'processing':
                    rec.segments.clear()
                    rec.segments.extend(new_segments)
                    rec.transcription_status = 'completed'
                    rec.transcription_error = None
            log.info('transcribed %s (%d segments)', rec_id, len(new_segments))
        except Exception as exc:
            log.exception('transcription failed for %s', rec_id)
            with SessionLocal.begin() as db:
                rec = db.get(Recording, rec_id)
                if rec is not None:
                    rec.transcription_status = 'failed'
                    rec.transcription_error = str(exc)[:500]

if __name__ == '__main__':
    run()
