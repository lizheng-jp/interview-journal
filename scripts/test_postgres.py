"""Run tests against ONLY the isolated localhost development PostgreSQL."""
import os
from pathlib import Path
import sys
import pytest
root = Path(__file__).resolve().parents[1]
values = dict(x.split('=',1) for x in (root / '.env').read_text().splitlines() if x and not x.startswith('#'))
os.environ['TEST_DATABASE_URL'] = 'postgresql+psycopg://interview:' + values['LOCAL_POSTGRES_PASSWORD'] + '@127.0.0.1:' + values.get('LOCAL_DB_PORT','15432') + '/interview'
sys.path.insert(0,str(root / 'backend'))
raise SystemExit(pytest.main([str(root / 'backend/tests'),'-q']))
