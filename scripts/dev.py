#!/usr/bin/env python3
"""Run all examples from any working directory. Requires Python 3.10+."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / '.tools' / 'bin'
LANGUAGES = ('go', 'java', 'typescript')


def run(args, cwd=ROOT, env=None):
    print('+', ' '.join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), cwd=cwd, env=env, check=True)


def tool_env():
    env = os.environ.copy()
    env['PATH'] = str(TOOLS) + os.pathsep + env['PATH']
    return env


def maven():
    return [str(ROOT / 'java' / ('mvnw.cmd' if os.name == 'nt' else 'mvnw')), '-B', '-ntp']


def generate():
    (ROOT / 'go/gen').mkdir(parents=True, exist_ok=True)
    run(['protoc', '-I', 'proto', '--go_out=go/gen', '--go_opt=paths=source_relative',
         '--go-grpc_out=go/gen', '--go-grpc_opt=paths=source_relative', 'proto/shop/v1/shop.proto'], env=tool_env())


def setup():
    for name in ('go', 'java', 'node', 'npm', 'protoc'):
        if not shutil.which(name):
            raise RuntimeError(f'{name} is required. See README.md prerequisites.')
    TOOLS.mkdir(parents=True, exist_ok=True)
    env = tool_env()
    env['GOBIN'] = str(TOOLS)
    run(['go', 'install', 'google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.12'], ROOT / 'go', env)
    run(['go', 'install', 'google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.6.2'], ROOT / 'go', env)
    run(['go', 'mod', 'download'], ROOT / 'go', env)
    run(['npm', 'ci'], ROOT / 'typescript')


def build():
    generate()
    for command in ('server', 'client'):
        suffix = '.exe' if os.name == 'nt' else ''
        run(['go', 'build', '-o', f'bin/{command}{suffix}', f'./cmd/{command}'], ROOT / 'go')
    run(maven() + ['package', '-DskipTests'], ROOT / 'java')
    run(['npm', 'run', 'build'], ROOT / 'typescript')


def test():
    generate()
    run(['go', 'test', '-race', './...'], ROOT / 'go')
    run(maven() + ['test'], ROOT / 'java')
    env = os.environ.copy()
    env.pop('GRPC_TARGET', None)
    env.pop('DEMO_DELAY_MS', None)
    run(['npm', 'test'], ROOT / 'typescript', env)


def command(mode, language):
    if language == 'go':
        return [str(ROOT / f'go/bin/{mode}') + ('.exe' if os.name == 'nt' else '')]
    if language == 'java':
        return ['java', '-jar', str(ROOT / 'java/target/grpc-java-1.0.0.jar')] + (['--spring.profiles.active=client'] if mode == 'client' else [])
    return ['node', 'dist/src/client.js' if mode == 'client' else 'dist/src/main.js']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['setup', 'build', 'test', 'interop', 'server', 'client'])
    parser.add_argument('language', nargs='?', choices=LANGUAGES)
    parser.add_argument('--target', help='Client target, e.g. localhost:50052')
    args = parser.parse_args()
    if args.action in ('setup', 'build', 'test'):
        globals()[args.action]()
    elif args.action == 'interop':
        run([sys.executable, ROOT / 'scripts/interop.py'])
    else:
        if not args.language: parser.error('server/client requires a language')
        env = os.environ.copy()
        if args.target: env['GRPC_TARGET'] = args.target
        run(command(args.action, args.language), ROOT / args.language, env)


if __name__ == '__main__':
    try:
        main()
    except (subprocess.CalledProcessError, RuntimeError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
