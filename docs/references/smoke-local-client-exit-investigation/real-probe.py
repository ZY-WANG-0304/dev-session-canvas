#!/usr/bin/env python3
"""Own every experiment process and reap adopted descendants; no external process signals."""
import ctypes
import json
import os
from pathlib import Path
import subprocess
import sys

if len(sys.argv) > 1 and sys.argv[1] == 'leaf':
    os.read(3, 1)
    sys.exit(0)

if len(sys.argv) > 1 and sys.argv[1] == 'root':
    leaf = subprocess.Popen([sys.executable, __file__, 'leaf'], pass_fds=(3,),
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(json.dumps({'leafPid': leaf.pid}), flush=True)
    # Only the leaf reads fd3. The root stays live until the actual helper kills it.
    leaf.wait()
    sys.exit(0)

if len(sys.argv) not in (3, 4):
    sys.exit('usage: python3 real-probe.py /absolute/path/to/node normal|race [fixed]')
node_path, scenario = sys.argv[1:3]
mode = sys.argv[3] if len(sys.argv) == 4 else 'original'
if mode not in ('original', 'fixed'):
    sys.exit('mode must be original or fixed')
if scenario not in ('normal', 'race'):
    sys.exit('scenario must be normal or race')
libc = ctypes.CDLL(None, use_errno=True)
if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
    raise OSError(ctypes.get_errno(), 'prctl subreaper failed')
node = subprocess.Popen([node_path, str(Path(__file__).with_name('real-probe.mjs')), __file__, scenario, mode],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
for line in node.stdout:
    message = json.loads(line)
    if message.get('request') == 'reap':
        # waitpid only accepts our own children; this PID was adopted after the root's SIGKILL.
        pid, status = os.waitpid(message['pid'], 0)
        response = {'response': 'reaped', 'pid': pid, 'exitCode': os.waitstatus_to_exitcode(status)}
        node.stdin.write(json.dumps(response) + '\n')
        node.stdin.flush()
    else:
        print(json.dumps(message), flush=True)
result = node.wait()
reaped = []
while True:
    try:
        pid, status = os.waitpid(-1, 0)
        reaped.append({'pid': pid, 'exitCode': os.waitstatus_to_exitcode(status)})
    except ChildProcessError:
        break
print(json.dumps({'scenario': scenario, 'remainingAdoptedChildrenReaped': reaped, 'nodeExitCode': result}), flush=True)
sys.exit(result)
