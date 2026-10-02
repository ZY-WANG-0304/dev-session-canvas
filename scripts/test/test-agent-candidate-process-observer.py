import ctypes
import errno
import pathlib
import runpy
import signal
import types
from unittest.mock import patch


api = runpy.run_path(str(pathlib.Path(__file__).resolve().parents[2] / 'tests/vscode-smoke/agent-candidate-process-observer.py'))


class NoSuchProcess(Exception):
    pass


class ZombieProcess(NoSuchProcess):
    pass


class AccessDenied(Exception):
    pass


def fixture():
    table = {
        10: {'birth': 1700000000.123456, 'ppid': 1, 'exe': '/host', 'argv': ['/host']},
        11: {'birth': 1700000001.654321, 'ppid': 10, 'exe': '/node', 'argv': ['/node', '/agent.js']},
        12: {'birth': 1700000002.000001, 'ppid': 11, 'exe': '/codex', 'argv': ['/codex']},
    }
    signals = []

    class Process:
        def __init__(self, pid):
            self.pid = pid
            if pid not in table:
                raise NoSuchProcess()
            if isinstance(table[pid], Exception):
                raise table[pid]
            self.value = table[pid]

        def create_time(self):
            return self.value['birth']

        def ppid(self):
            return self.value['ppid']

        def status(self):
            return self.value.get('state', 'running')

        def exe(self):
            return self.value['exe']

        def cmdline(self):
            return self.value['argv']

        def send_signal(self, value):
            signals.append((self.pid, value))

    psutil = types.SimpleNamespace(Process=Process, NoSuchProcess=NoSuchProcess, ZombieProcess=ZombieProcess,
                                   STATUS_ZOMBIE='zombie', STATUS_DEAD='dead')
    return table, signals, psutil


table, signals, psutil = fixture()
root = api['observe'](psutil, 10)['identity']
assert root['startTicks'] == 'darwin:1700000000:123456'
queried = []


def children(pid):
    queried.append(pid)
    return {10: [11, 90], 11: [12]}.get(pid, [])


result = api['sample'](psutil, children, {'targets': [{'pid': 10, 'startTicks': root['startTicks']}], 'observerPid': 90})
assert [record['pid'] for record in result['records']] == [10, 11, 12]
assert result['records'][1]['identity']['firstParentStartTicks'] == root['startTicks']
assert queried == [10, 11, 12]
assert signals == []

table[11] = AccessDenied()
assert api['observe'](psutil, 11)['status'] == 'unknown'
assert api['observe'](psutil, 99)['status'] == 'absent'
reused = api['sample'](psutil, children, {'targets': [{'pid': 10, 'startTicks': 'darwin:1:000000'}]})
assert reused['records'] == [{'pid': 10, 'status': 'absent', 'reason': 'original-identity-ended'}]

table, signals, psutil = fixture()


def reparent_during_query(pid):
    table[10]['birth'] += 10
    return [11]


changed = api['sample'](psutil, reparent_during_query, {'targets': [{'pid': 10}]})
assert [record['pid'] for record in changed['records']] == [10, 10]
assert changed['records'][-1]['status'] == 'absent'

table, signals, psutil = fixture()
table[11]['ppid'] = 20
unrelated = api['sample'](psutil, lambda pid: [11] if pid == 10 else [], {'targets': [{'pid': 10}]})
assert [record['pid'] for record in unrelated['records']] == [10]

table, signals, psutil = fixture()
target = api['observe'](psutil, 12)['identity']
request = {'targets': [target]}
assert api['cleanup'](psutil, request)['results'][0]['action'] == 'SIGKILL-after-product-cleanup-failed'
assert signals == [(12, signal.SIGKILL)]
signals.clear()
table[12]['exe'] = '/different-executable'
assert api['cleanup'](psutil, request)['results'][0]['action'] == 'identity-changed-no-signal'
table[12]['exe'] = '/codex'
table[12]['birth'] += 1
assert api['cleanup'](psutil, request)['results'][0]['action'] == 'identity-changed-no-signal'
table[12] = AccessDenied()
assert api['cleanup'](psutil, request)['results'][0]['action'] == 'identity-unconfirmed-no-signal'
table[12] = {'birth': 1700000002.000001, 'ppid': 11, 'exe': '', 'argv': []}
assert api['cleanup'](psutil, request)['results'][0]['action'] == 'identity-unconfirmed-no-signal'
assert signals == []

table, signals, psutil = fixture()
reply = {'count': 0, 'errno': errno.EIO}


def query_children(pid, buffer, size):
    assert pid == 10
    assert size == ctypes.sizeof(ctypes.c_int) * 4096
    if reply['errno'] is not None:
        ctypes.set_errno(reply['errno'])
    buffer[0] = 11
    return reply['count']


with patch.object(ctypes, 'CDLL', return_value=types.SimpleNamespace(proc_listchildpids=query_children)) as library:
    direct_children = api['direct_children_reader']()
    library.assert_called_once_with('/usr/lib/libproc.dylib', use_errno=True)
    failed = api['sample'](psutil, direct_children, {'targets': [{'pid': 10}]})
    assert failed['records'][-1] == {'pid': 10, 'status': 'unknown', 'reason': 'OSError'}, \
        'libproc maps syscall errors to zero plus errno, not a complete empty child list'
    reply.update(count=0, errno=None)
    ctypes.set_errno(errno.EIO)
    assert direct_children(10) == [], 'a successful empty query must not inherit stale errno'
    reply.update(count=1, errno=None)
    assert direct_children(10) == [11], 'proc_listchildpids returns a PID count, not bytes'
    reply.update(count=-1, errno=errno.EACCES)
    try:
        direct_children(10)
        raise AssertionError('negative child-query result must not pass')
    except OSError as error:
        assert error.errno == errno.EACCES
assert signals == []

print('Darwin Agent identity helper: 6 controlled identity/lineage/cleanup cases passed; no Darwin API or native signals.')
