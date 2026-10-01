import ctypes
import json
import math
import signal
import sys


def birth(process):
    value = process.create_time()
    if not math.isfinite(value) or value <= 0:
        raise ValueError('invalid-process-birth')
    micros = round(value * 1000000)
    return f'darwin:{micros // 1000000}:{micros % 1000000:06d}'


def observe(psutil, pid):
    try:
        process = psutil.Process(pid)
        started = birth(process)
        state = process.status()
        terminal = state in (psutil.STATUS_ZOMBIE, psutil.STATUS_DEAD)
        result = {'pid': pid, 'ppid': process.ppid(), 'startTicks': started,
                  'state': 'Z' if state == psutil.STATUS_ZOMBIE else 'X' if state == psutil.STATUS_DEAD else state,
                  'executable': None if terminal else process.exe(), 'argv': [] if terminal else process.cmdline()}
        if not terminal and not result['executable']:
            raise ValueError('process-executable-unconfirmed')
        if birth(psutil.Process(pid)) != started:
            return {'pid': pid, 'status': 'unknown', 'reason': 'identity-changed-during-observation'}
        return {'pid': pid, 'status': 'present', 'identity': result}
    except psutil.ZombieProcess:
        return {'pid': pid, 'status': 'unknown', 'reason': 'zombie-query-incomplete'}
    except psutil.NoSuchProcess:
        return {'pid': pid, 'status': 'absent'}
    except Exception as error:
        return {'pid': pid, 'status': 'unknown', 'reason': type(error).__name__}


def direct_children_reader():
    library = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    query = library.proc_listchildpids
    query.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
    query.restype = ctypes.c_int

    def children(pid):
        buffer = (ctypes.c_int * 4096)()
        ctypes.set_errno(0)
        count = query(pid, buffer, ctypes.sizeof(buffer))
        error = ctypes.get_errno()
        # libproc maps a failed syscall to zero PIDs while preserving errno.
        if count < 0 or (count == 0 and error):
            raise OSError(error, 'direct-child-query-failed')
        if count >= len(buffer):
            raise ValueError('direct-child-query-incomplete')
        return [buffer[index] for index in range(count) if buffer[index] > 0]
    return children


def sample(psutil, children, request):
    targets = request['targets']
    expected = {target['pid']: target.get('startTicks') for target in targets}
    queue = [(target['pid'], None) for target in targets]
    visited = set()
    records = []
    while queue:
        pid, parent = queue.pop(0)
        if pid in visited:
            continue
        if len(visited) >= 4096:
            raise ValueError('fixed-process-observation-incomplete')
        visited.add(pid)
        record = observe(psutil, pid)
        if record['status'] != 'present':
            if pid in expected or record['status'] == 'unknown':
                records.append(record)
            continue
        current = record['identity']
        if expected.get(pid) and current['startTicks'] != expected[pid]:
            records.append({'pid': pid, 'status': 'absent', 'reason': 'original-identity-ended'})
            continue
        if parent:
            checked_parent = observe(psutil, parent['pid'])
            if checked_parent['status'] != 'present' or checked_parent['identity']['startTicks'] != parent['startTicks']:
                status = 'unknown' if checked_parent['status'] == 'unknown' else 'absent'
                records.append({'pid': parent['pid'], 'status': status, 'reason': 'parent-identity-unconfirmed'})
                continue
            if current['ppid'] != parent['pid']:
                continue
            current['firstParentStartTicks'] = parent['startTicks']
        records.append(record)
        if request.get('descend', True) and current['state'] not in ('Z', 'X'):
            try:
                child_pids = children(pid)
                checked = observe(psutil, pid)
                if checked['status'] != 'present' or checked['identity']['startTicks'] != current['startTicks']:
                    status = 'unknown' if checked['status'] == 'unknown' else 'absent'
                    records.append({'pid': pid, 'status': status, 'reason': 'parent-identity-unconfirmed'})
                    continue
                queue.extend((child, current) for child in child_pids if child != request.get('observerPid'))
            except Exception as error:
                records.append({'pid': pid, 'status': 'unknown', 'reason': type(error).__name__})
    return {'version': 1, 'operation': 'sample', 'records': records}


def cleanup(psutil, request):
    results = []
    for target in request['targets']:
        current = observe(psutil, target['pid'])
        action = 'identity-unconfirmed-no-signal'
        if current['status'] == 'absent':
            action = 'already-absent-no-signal'
        elif current['status'] == 'present':
            identity = current['identity']
            if identity['state'] in ('Z', 'X'):
                action = 'already-ended-no-signal'
            elif identity['startTicks'] != target['startTicks'] or identity['executable'] != target['executable']:
                action = 'identity-changed-no-signal'
            else:
                try:
                    process = psutil.Process(target['pid'])
                    if birth(process) != target['startTicks'] or process.exe() != target['executable']:
                        action = 'identity-changed-no-signal'
                    else:
                        process.send_signal(signal.SIGKILL)
                        action = 'SIGKILL-after-product-cleanup-failed'
                except psutil.NoSuchProcess:
                    action = 'already-absent-no-signal'
                except Exception:
                    action = 'signal-unconfirmed'
        results.append({'pid': target['pid'], 'startTicks': target['startTicks'], 'action': action})
    return {'version': 1, 'operation': 'cleanup', 'results': results}


def main():
    import psutil
    if sys.platform != 'darwin' or psutil.__version__ != '7.0.0' or sys.version_info[:3] != (3, 12, 10):
        raise ValueError('fixed-darwin-python-psutil-required')
    request = json.load(sys.stdin)
    if request.get('version') != 1 or request.get('operation') not in ('sample', 'cleanup'):
        raise ValueError('invalid-observer-request')
    targets = request.get('targets')
    if not isinstance(targets, list) or len(targets) > 4096:
        raise ValueError('invalid-observer-targets')
    for target in targets:
        if not isinstance(target, dict) or type(target.get('pid')) is not int or target['pid'] <= 0:
            raise ValueError('invalid-observer-pid')
    request['observerPid'] = __import__('os').getpid()
    result = sample(psutil, direct_children_reader(), request) if request['operation'] == 'sample' else cleanup(psutil, request)
    json.dump(result, sys.stdout, ensure_ascii=True, separators=(',', ':'))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        json.dump({'version': 1, 'error': type(error).__name__}, sys.stdout)
        sys.exit(1)
