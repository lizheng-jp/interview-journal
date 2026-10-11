# MVP verification — 2026-10-11

Evidence is from the actual local code, isolated Docker/PostgreSQL application and browser. Production verification was limited to read-only inspection.

| Check | Result | Scope |
| --- | --- | --- |
| API + worker mechanics, SQLite | 8 passed | Real audio payload validation, CRUD, metadata, filters, search, pagination, byte-range playback, aggregate duration, owner boundary, browser origin guard, worker lease/failure/retry; model is a test double |
| Same API + worker checks, PostgreSQL 16 | 8 passed | Dedicated local Docker database, temporary schema per test; no production DB writes |
| GitHub Actions | Passed | [Run 38138631463](https://github.com/lizheng-jp/interview-journal/actions/runs/38138631463), tested implementation commit `49aba18`: Linux amd64 Docker build, SQLite 8 passed, PostgreSQL 8 passed, Chromium 4 passed; optional real-transcript browser case skipped in CI |
| TypeScript | Passed | `tsc --noEmit` |
| Next.js production build | Passed | `next build --webpack`; standalone Docker image also built and ran |
| Web/API/PostgreSQL Compose | Passed | Only new local services; API/web ready and worker default offline |
| Browser flow | 5 passed | Chromium real MediaRecorder using a synthetic microphone; capture/pause/resume/preview/upload, metadata/language editing, filtering/search, real audio playback, byte ranges and deletion |
| Browser recovery | Included in five above | Upload failure keeps preview and retry works; microphone-denial path returns to ready |
| Responsive UI | Included in five above | 1440px desktop and 390px mobile screenshots; no horizontal overflow |
| Real transcript UI | Included in five above | Actual Whisper transcript: timestamp seek, active highlight, correction persisted to DB and transcript search |
| Real multilingual speech | 3 completed | macOS synthetic English/Japanese/Chinese voice fixtures; real `faster-whisper` multilingual base, CPU INT8, one thread; nonempty timestamped segments and byte-range playback |
| Optional Docker transcription | Passed | Image built; real English auto-detect job completed with two segments; one-off worker exited and API reports offline |
| Dependency audit | Passed | npm production audit: zero findings at verification time; pip dependency check passed |

## Real speech results and limits

| Synthetic input | Audio duration | Segments | Status |
| --- | ---: | ---: | --- |
| English | 10.121 seconds | 2 | completed |
| Japanese | 12.918 seconds | 3 | completed |
| Chinese | 14.719 seconds | 1 | completed |

The local host worker processed these three fixtures in approximately 5.06 seconds with a previously downloaded model. This is a **Mac local smoke measurement**, not a Lightsail benchmark or accuracy result. Japanese `協力` was transcribed as `強力`; Chinese `在` as `再`. The app supports manual corrections. No WER/CER dataset, human speech, noisy recording evaluation or production resource benchmark was run.

The browser initially exposed Chrome WebM files with an infinite duration. Upload now remuxes WebM without re-encoding to add seek/duration metadata. The successful browser regression explicitly checks a finite duration and advancing playback. The backend calculates durations from decoded samples rather than client-supplied form values. Corrupt/non-audio/empty/oversized uploads are rejected and their partial files removed.

## Reproduce real speech locally

On macOS, generate three explicitly synthetic fixtures (do not use private recordings for CI):

```sh
mkdir -p .storage/smoke
say -v 'Samantha (English (US))' -o .storage/smoke/en.aiff 'In my last project, I improved the deployment pipeline. I added automated tests and made releases easier to review. I learned to explain technical trade offs clearly.'
say -v 'Kyoko (Japanese (Japan))' -o .storage/smoke/ja.aiff '前のプロジェクトでは、デプロイの仕組みを改善しました。自動テストを追加して、リリースの確認を簡単にしました。チームで協力して問題を解決しました。'
say -v Tingting -o .storage/smoke/zh.aiff '在上一个项目中，我改进了部署流程，添加了自动化测试，让发布过程更容易检查。我学会了清楚地解释技术方案，并且和团队一起解决问题。'
backend/.venv/bin/pip install -r backend/requirements-worker.txt
backend/.venv/bin/python scripts/speech_smoke.py
```

Voice availability/names vary by macOS installation. The script is deliberately restricted to the isolated localhost PostgreSQL/app, refuses an existing pending queue and leaves clearly labeled synthetic fixtures for browser QA. It stores results only under ignored `.storage/`. It runs the actual opt-in worker and verifies status, segments, timestamp bounds and playback. To run the optional browser transcript case:

```sh
cd frontend
E2E_TRANSCRIPT_ID=LOCAL_COMPLETED_ENGLISH_FIXTURE_ID npm run test:e2e
```

Delete those synthetic fixtures through the app after review. CI skips this optional transcript case; it runs four ordinary browser cases and mocked worker mechanics without Whisper downloads. The linked GitHub Actions run passed for implementation commit `49aba18`. The subsequent documentation-only commit records that evidence; its `[skip ci]` marker avoids repeating unchanged application tests.

## Not yet verified or completed

- Public Lightsail deployment, TLS/authenticated endpoint, dedicated production PostgreSQL role and Caddy site: awaiting confirmation.
- Safari/iOS actual microphone capture, interrupted mobile/background recording, real user microphone quality.
- Production peak-load isolation, CPU transcription resource benchmark, long-duration/noisy speech and transcript accuracy.
- Independent backups and restore exercise, retention/quota policy, versioned schema migrations for future changes.
- Multi-user accounts/authorization and AI evaluation/career memory are outside phase one.
