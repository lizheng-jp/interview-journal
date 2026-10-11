from types import SimpleNamespace
from app import worker
from app.models import Recording, WorkerLease


def test_worker_success_and_lease(client, upload):
    rid = upload(language='ja').json()['id']
    assert worker.acquire_lease('first')
    assert not worker.acquire_lease('second')
    assert worker.renew('first')
    assert not worker.renew('second')
    class Model:
        def transcribe(self, path, **options):
            assert options['language']=='ja'
            assert options['vad_filter'] is True
            return iter([SimpleNamespace(start=0.1,end=0.9,text=' 日本語の面接 ') ]),None
    assert worker.process_next(Model(),'first')
    rec = client.get(f'/api/recordings/{rid}').json()
    assert rec['transcription_status']=='completed'
    assert rec['segments'][0]['text']=='日本語の面接'
    assert rec['segments'][0]['start']==0.1
    assert not worker.process_next(Model(),'first')


def test_worker_failure_retry_and_reclaim(client, upload):
    rid = upload(language='auto').json()['id']
    worker.acquire_lease('old')
    class BrokenModel:
        def transcribe(self,path,**options):
            assert options['language'] is None
            raise RuntimeError('secret path should never reach client')
    worker.process_next(BrokenModel(),'old')
    rec = client.get(f'/api/recordings/{rid}').json()
    assert rec['transcription_status']=='failed'
    assert 'secret' not in rec['transcription_error']
    assert client.post(f'/api/recordings/{rid}/retry-transcription').status_code==200
    with client.maker.begin() as db:
        db.get(WorkerLease,1).expires_at=0
    assert worker.acquire_lease('new')
    assert not worker.renew('old')
