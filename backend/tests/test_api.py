import time
from sqlalchemy import select
from app import main
from app.models import Recording, Segment, WorkerLease
from conftest import wav_bytes


def test_crud_search_playback_and_stats(client, upload):
    r = upload()
    assert r.status_code == 201, r.text
    rec = r.json()
    rid = rec['id']
    assert rec['duration_seconds'] == 1  # ignores forged client duration
    assert rec['created_at'].endswith('+00:00')
    assert rec['transcription_status'] == 'pending'
    assert len(client.get('/api/recordings?q=Redis').json()) == 1
    assert client.get('/api/recordings?category=coding').json() == []
    assert client.get('/api/recordings?language=ja').json() == []
    assert client.get(f'/api/recordings/{rid}').json()['segments'] == []
    audio = client.get(f'/api/recordings/{rid}/audio')
    assert audio.content == wav_bytes()
    partial = client.get(f'/api/recordings/{rid}/audio', headers={'Range':'bytes=0-19'})
    assert partial.status_code == 206
    assert partial.content == wav_bytes()[:20]
    assert partial.headers['content-range'].startswith('bytes 0-19/')
    updated = client.patch(f'/api/recordings/{rid}', json={'title':'  Caching trade-offs  ', 'notes':'Improve STAR', 'tags':'leadership, backend', 'category':'behavioral'})
    assert updated.json()['title'] == 'Caching trade-offs'
    stats = client.get('/api/stats').json()
    assert stats['total_sessions'] == 1 and stats['total_seconds'] == 1
    assert client.delete(f'/api/recordings/{rid}').status_code == 204
    assert client.get(f'/api/recordings/{rid}/audio').status_code == 404
    assert not any(client.storage.rglob('*.wav'))


def test_invalid_audio_and_metadata(client, upload, monkeypatch):
    for bad in [{'title':' '}, {'category':'invalid'}, {'language':'xx'}, {'duration_seconds':'nan'}, {'duration_seconds':'inf'}, {'notes':'x'*5001}, {'tags':'x'*301}]:
        assert upload(**bad).status_code == 422
    for data, mime, code in [(b'not audio','audio/webm',422), (b'','audio/wav',422), (b'danger','application/octet-stream',415)]:
        assert client.post('/api/recordings', data={'title':'Bad'}, files={'file':('x.webm',data,mime)}).status_code == code
    monkeypatch.setattr(main, 'MAX_UPLOAD', 10)
    assert upload().status_code == 413
    assert not list(client.storage.rglob('*.wav'))
    assert client.get('/api/recordings').json() == []


def test_filters_and_pagination(client, upload):
    for category in main.CATEGORIES:
        assert upload(category=category, language='ja').status_code == 201
    assert len(client.get('/api/recordings?language=ja').json()) == 5
    assert len(client.get('/api/recordings?category=english').json()) == 1
    assert len(client.get('/api/recordings?status=pending&limit=2&offset=2').json()) == 2
    assert client.get('/api/recordings?limit=0').status_code == 422
    assert client.get('/api/stats').json()['total_sessions'] == 5


def test_patch_language_segments_and_retry(client, upload):
    rid = upload().json()['id']
    with client.maker.begin() as db:
        rec = db.get(Recording,rid)
        rec.transcription_status = 'completed'
        segment = Segment(recording_id=rid,start_seconds=0,end_seconds=1,text='A distributed cache')
        db.add(segment)
        db.flush()
        sid = segment.id
    assert len(client.get('/api/recordings?q=distributed').json()) == 1
    assert client.patch(f'/api/recordings/{rid}/segments/{sid}', json={'text':'A shared cache'}).status_code == 200
    assert client.get(f'/api/recordings/{rid}').json()['segments'][0]['text'] == 'A shared cache'
    assert client.patch(f'/api/recordings/{rid}', json={'title':'  '}).status_code == 422
    assert client.patch(f'/api/recordings/{rid}', json={'language':'xx'}).status_code == 422
    changed = client.patch(f'/api/recordings/{rid}', json={'language':'zh'}).json()
    assert changed['language']=='zh' and changed['transcription_status']=='pending' and changed['segments']==[]
    with client.maker.begin() as db:
        db.get(Recording,rid).transcription_status = 'processing'
    for method, url, data in [('post','retry-transcription',None),('patch','',{'language':'ja'}),('delete','',None)]:
        endpoint = f'/api/recordings/{rid}' + ('/'+url if url else '')
        assert getattr(client,method)(endpoint,**({'json':data} if data else {})).status_code == 409


def test_owner_boundary_and_health(client, upload):
    rid = upload().json()['id']
    with client.maker.begin() as db:
        db.get(Recording,rid).owner_id = 'someone-else'
    assert client.get('/api/recordings').json()==[]
    assert client.get('/api/stats').json()['total_sessions']==0
    for suffix in ['', '/audio']:
        assert client.get(f'/api/recordings/{rid}{suffix}').status_code==404
    assert client.patch(f'/api/recordings/{rid}',json={'title':'x'}).status_code==404
    assert client.delete(f'/api/recordings/{rid}').status_code==404
    assert client.get('/api/health').json()['transcription_worker']=='offline'
    with client.maker.begin() as db:
        db.add(WorkerLease(id=1,token='x',expires_at=time.time()+100,heartbeat_at=time.time()))
    assert client.get('/api/health').json()['transcription_worker']=='online'


def test_browser_origin_guard(client):
    form={'title':'Origin test'}
    clip={'file':('clip.wav',wav_bytes(),'audio/wav')}
    assert client.post('/api/recordings',data=form,files=clip,headers={'Origin':'https://untrusted.example'}).status_code==403
    assert client.post('/api/recordings',data=form,files=clip,headers={'Origin':'null'}).status_code==403
    assert client.post('/api/recordings',data=form,files=clip,headers={'Origin':'http://localhost:13080'}).status_code==201
