"""Local-only real CPU Whisper smoke. Requires three synthetic en/ja/zh .aiff fixtures.
Run with backend/.venv/bin/python scripts/speech_smoke.py. Never use on production.
Writes results under ignored .storage; retains clearly labeled fixtures for browser QA.
"""
import json
import os
import time
import wave
from pathlib import Path
import av
import httpx

ROOT = Path(__file__).resolve().parents[1]
values = dict(x.split('=',1) for x in (ROOT / '.env').read_text().splitlines() if x and not x.startswith('#'))
os.environ['DATABASE_URL'] = 'postgresql+psycopg://interview:' + values['LOCAL_POSTGRES_PASSWORD'] + '@127.0.0.1:15432/interview'
os.environ['STORAGE_DIR'] = str(ROOT / '.storage/smoke/audio')
os.environ['WHISPER_DOWNLOAD_ROOT'] = str(ROOT / '.storage/models')
# Import after configuring the dedicated LOCAL database, never the production overlay.
import sys
sys.path.insert(0, str(ROOT / 'backend'))
from app import worker
from app.models import Recording
from sqlalchemy import select

fixture_dir = ROOT / '.storage/smoke'
report = []
with httpx.Client(base_url='http://127.0.0.1:13080',timeout=120) as api:
    assert api.get('/api/health').json()['transcription_worker']=='offline'
    with worker.SessionLocal() as db:
        assert not db.scalar(select(Recording.id).where(Recording.transcription_status=='pending')), 'Clean up earlier pending TEST fixtures first'
    for lang in ['en','ja','zh']:
        pcm = fixture_dir / f'{lang}.wav'
        with av.open(str(fixture_dir / f'{lang}.aiff')) as source, wave.open(str(pcm),'wb') as output:
            output.setnchannels(1);output.setsampwidth(2);output.setframerate(16000)
            resampler=av.AudioResampler(format='s16',layout='mono',rate=16000)
            for frame in source.decode(audio=0):
                for converted in resampler.resample(frame):
                    output.writeframes(converted.to_ndarray().tobytes())
            for converted in resampler.resample(None):
                output.writeframes(converted.to_ndarray().tobytes())
        with pcm.open('rb') as audio:
            response=api.post('/api/recordings',data={'title':f'Synthetic speech smoke — {lang}', 'language':lang,'category':'english','tags':'synthetic,smoke-test','notes':'macOS text-to-speech fixture. Pipeline validation only; not an accuracy benchmark.'},files={'file':(pcm.name,audio,'audio/wav')})
        response.raise_for_status()
        rec=response.json()
        # The opt-in host worker consumes copies of the exact uploaded bytes from its own storage.
        target=worker.STORAGE / 'local-owner' / (rec['id']+'.wav')
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(api.get(rec['audio_url']).content)
        report.append({'id':rec['id'],'language':lang,'audio_seconds':rec['duration_seconds']})
    started=time.monotonic()
    worker.run(limit=3)
    elapsed=time.monotonic()-started
    for result in report:
        rec=api.get('/api/recordings/'+result['id']).json()
        assert rec['transcription_status']=='completed',rec
        assert rec['segments'], f'No speech detected in {result["language"]}'
        assert all(0<=s['start']<s['end']<=rec['duration_seconds']+1 for s in rec['segments'])
        result['segments']=len(rec['segments'])
        result['text']=' '.join(s['text'] for s in rec['segments'])
        result['status']=rec['transcription_status']
        assert api.get(rec['audio_url'],headers={'Range':'bytes=0-19'}).status_code==206
    assert api.get('/api/health').json()['transcription_worker']=='offline'
(fixture_dir / 'results.json').write_text(json.dumps({'model':'base','device':'cpu','compute_type':'int8','cpu_threads':1,'worker_seconds':round(elapsed,2),'synthetic_fixtures':report},ensure_ascii=False,indent=2))
print((fixture_dir / 'results.json').read_text())
