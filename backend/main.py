import argparse
from contextlib import asynccontextmanager
import hmac
import os
from pathlib import Path
import socket
import sys
from fastapi import FastAPI, Depends, Header, HTTPException
from fastapi.responses import PlainTextResponse
import uvicorn
from models import Command, CredentialInput, PlanValidation, Explanation
from store import Store, Conflict
from credentials import Credentials


def create_app(root: Path, token: str):
    store = Store(root / 'workspace')
    credentials = Credentials(root)

    def auth(authorization: str = Header(default='')):
        if not token or not hmac.compare_digest(authorization, 'Bearer ' + token):
            raise HTTPException(401, '未授权')

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, dependencies=[Depends(auth)])

    @app.get('/health')
    def health():
        return {'ok': True, 'version': '0.0.2'}

    @app.get('/workspace')
    def workspace():
        return store.public()

    @app.post('/command')
    def command(body: Command):
        try:
            return store.commit(body)
        except Conflict as e:
            raise HTTPException(409, str(e))
        except (ValueError, KeyError, FileNotFoundError) as e:
            raise HTTPException(422, str(e))

    @app.post('/validate-plan')
    def validate_plan(body: PlanValidation):
        return body.plan.model_dump()

    @app.post('/validate-explanation')
    def validate_explanation(body: Explanation):
        return body.model_dump()

    @app.get('/history')
    def history():
        return store.history()

    @app.get('/export', response_class=PlainTextResponse)
    def export():
        return store.markdown()

    @app.get('/settings')
    def settings():
        return credentials.read()

    @app.put('/settings')
    def settings_save(body: CredentialInput):
        return credentials.save(body.api_key.strip(), body.model)

    @app.delete('/settings')
    def settings_delete():
        return credentials.delete()

    @app.get('/internal/credentials')
    def secret():
        return credentials.read(reveal=True)

    return app


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', required=True)
    args = parser.parse_args()
    token = os.environ.get('COGNITION_LOCAL_TOKEN', '')
    if not token:
        sys.exit('Missing local session token')
    app = create_app(Path(args.data_dir), token)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(('127.0.0.1', 0))
    sock.listen(128)
    print('COGNITION_PORT=' + str(sock.getsockname()[1]), flush=True)
    uvicorn.Server(uvicorn.Config(app, access_log=False, log_level='warning')).run(sockets=[sock])
