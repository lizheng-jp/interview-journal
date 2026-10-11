from pathlib import Path
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import pytest

from app.database import Base, get_db
from app import main

@pytest.fixture
def client(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}", connect_args={'check_same_thread': False})
    Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine, expire_on_commit=False)
    def db():
        with maker() as session:
            yield session
    main.app.dependency_overrides[get_db] = db
    monkeypatch.setattr(main, 'STORAGE_DIR', tmp_path / 'audio')
    (tmp_path / 'audio').mkdir()
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()
    engine.dispose()

def create(client):
    return client.post('/api/recordings', data={'title':'System design cache', 'category':'system-design','language':'en','tags':'cache, Redis','duration_seconds':'62.5'}, files={'file':('clip.webm',b'fake-ogg-content','audio/webm')})

def test_crud_and_search(client, tmp_path):
    r = create(client)
    assert r.status_code == 201, r.text
    data = r.json()
    assert data['title'] == 'System design cache'
    assert data['transcription_status'] == 'pending'
    rid = data['id']
    assert len(client.get('/api/recordings?q=Redis').json()) == 1
    assert len(client.get('/api/recordings?category=coding').json()) == 0
    assert client.get(f'/api/recordings/{rid}').json()['segments'] == []
    audio = client.get(f'/api/recordings/{rid}/audio')
    assert audio.content == b'fake-ogg-content'
    assert client.patch(f'/api/recordings/{rid}', json={'title':'Caching trade-offs'}).json()['title']=='Caching trade-offs'
    assert client.get('/api/stats').json()['total_sessions'] == 1
    assert client.delete(f'/api/recordings/{rid}').status_code == 204
    assert client.get(f'/api/recordings/{rid}/audio').status_code == 404
    assert not any((tmp_path / 'audio').rglob('*.webm'))

def test_validation(client):
    assert client.post('/api/recordings',data={'title':'Bad','category':'other'}, files={'file':('x.exe',b'danger','application/octet-stream')}).status_code==415
    assert client.post('/api/recordings',data={'title':'Bad','category':'invalid'}, files={'file':('x.webm',b'audio','audio/webm')}).status_code==422
    assert client.get('/api/recordings/../../etc/passwd').status_code in (404, 307)
