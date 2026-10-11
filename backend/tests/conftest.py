import io
import math
import os
import struct
import uuid
import wave
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from app.database import Base, get_db
from app import main, worker


def wav_bytes(seconds=1):
    out = io.BytesIO()
    with wave.open(out, 'wb') as clip:
        clip.setnchannels(1)
        clip.setsampwidth(2)
        clip.setframerate(16000)
        clip.writeframes(b''.join(struct.pack('<h', int(6000 * math.sin(2 * math.pi * 440 * i / 16000))) for i in range(int(16000 * seconds))))
    return out.getvalue()

@pytest.fixture
def client(tmp_path, monkeypatch):
    url = os.getenv('TEST_DATABASE_URL', f"sqlite:///{tmp_path / 'test.db'}")
    pg = url.startswith('postgresql')
    schema = 'test_' + uuid.uuid4().hex
    raw_engine = create_engine(url, connect_args={} if pg else {'check_same_thread': False})
    if pg:
        with raw_engine.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA {schema}'))
        engine = raw_engine.execution_options(schema_translate_map={None: schema})
    else:
        engine = raw_engine
    Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine, expire_on_commit=False)
    def db():
        with maker() as session:
            yield session
    main.app.dependency_overrides[get_db] = db
    storage = tmp_path / 'audio'
    storage.mkdir()
    monkeypatch.setattr(main, 'STORAGE_DIR', storage)
    monkeypatch.setattr(worker, 'STORAGE', storage)
    monkeypatch.setattr(worker, 'SessionLocal', maker)
    monkeypatch.setattr(worker, 'engine', engine)
    with TestClient(main.app) as test_client:
        test_client.maker = maker
        test_client.storage = storage
        yield test_client
    main.app.dependency_overrides.clear()
    if pg:
        with raw_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA {schema} CASCADE'))
    raw_engine.dispose()

@pytest.fixture
def upload(client):
    def create(**metadata):
        values = {'title':'System design cache', 'category':'system-design', 'language':'en', 'tags':'cache, Redis', 'duration_seconds':'999'} | metadata
        return client.post('/api/recordings', data=values, files={'file':('clip.wav', wav_bytes(), 'audio/wav')})
    return create
