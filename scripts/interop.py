#!/usr/bin/env python3
"""Real TCP contract tests against all servers, then all 9 client/server pairs."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from dev import ROOT, LANGUAGES, command


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def main():
    output = ROOT / '.run'
    output.mkdir(exist_ok=True)
    results = []
    for server_language in LANGUAGES:
        port = free_port()
        env = os.environ.copy()
        env.update(GRPC_ADDR=f'127.0.0.1:{port}', GRPC_HOST='127.0.0.1', GRPC_PORT=str(port),
                   GRPC_TARGET=f'127.0.0.1:{port}', DEMO_DELAY_MS='0', FIXTURES_PATH=str(ROOT / 'fixtures/orders.json'))
        log_path = output / f'{server_language}-server.log'
        with log_path.open('w') as log:
            server = subprocess.Popen(command('server', server_language), cwd=ROOT / server_language, env=env,
                                      stdout=log, stderr=subprocess.STDOUT)
            try:
                end = time.monotonic() + 45
                while True:
                    if server.poll() is not None: raise RuntimeError(f'{server_language} exited. See {log_path}')
                    ready = subprocess.run(['node', 'dist/src/healthcheck.js'], cwd=ROOT / 'typescript', env=env,
                                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
                    if ready.returncode == 0: break
                    if time.monotonic() >= end: raise RuntimeError(f'{server_language} did not become ready. See {log_path}')
                    time.sleep(0.2)
                print(f'Contract tests -> {server_language}', flush=True)
                with (output / f'{server_language}-contract.log').open('w') as contract_log:
                    subprocess.run(['npm', 'run', 'contract'], cwd=ROOT / 'typescript', env=env, check=True,
                                   stdout=contract_log, stderr=subprocess.STDOUT, timeout=60)
                for client_language in LANGUAGES:
                    result = subprocess.run(command('client', client_language), cwd=ROOT / client_language, env=env,
                                            capture_output=True, text=True, timeout=45)
                    path = output / f'{client_language}-to-{server_language}.log'
                    path.write_text(result.stdout + result.stderr, encoding='utf-8')
                    if result.returncode != 0 or 'DEMO_OK' not in result.stdout:
                        raise RuntimeError(f'{client_language} -> {server_language} failed. See {path}')
                    print(f'PASS {client_language} -> {server_language}', flush=True)
                    results.append({'client': client_language, 'server': server_language, 'passed': True})
            finally:
                server.terminate()
                try: server.wait(timeout=10)
                except subprocess.TimeoutExpired: server.kill(); server.wait(timeout=5)
    (output / 'interop-results.json').write_text(json.dumps(results, indent=2) + '\n', encoding='utf-8')
    print('PASS: 3 wire-contract suites and 9 client/server combinations', flush=True)


if __name__ == '__main__':
    try: main()
    except (RuntimeError, subprocess.SubprocessError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
