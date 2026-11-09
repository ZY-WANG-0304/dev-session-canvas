import errno
import fcntl
import json
import os
import pathlib
import platform
import select
import signal
import socket
import subprocess
import sys
import tempfile


def try_lock(filename):
    descriptor = os.open(filename, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return descriptor
    except BlockingIOError:
        os.close(descriptor)
        return None


def start_holder(filename):
    source = (
        "import fcntl, os, sys; "
        "descriptor = os.open(sys.argv[1], os.O_CREAT | os.O_RDWR, 0o600); "
        "fcntl.flock(descriptor, fcntl.LOCK_EX); "
        "print('locked', flush=True); sys.stdin.buffer.read(1); os.close(descriptor)"
    )
    child = subprocess.Popen(
        [sys.executable, "-c", source, str(filename)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        assert select.select([child.stdout], [], [], 5)[0], "holder did not start"
        assert child.stdout.readline().strip() == "locked"
        return child
    except BaseException:
        child.kill()
        child.communicate(timeout=5)
        raise


def stop_holder(child):
    if child.poll() is None:
        child.kill()
    child.communicate(timeout=5)


def main():
    assert sys.platform == "linux", "This probe validates Linux only"
    results = {"platform": platform.platform(), "python": platform.python_version()}
    results["ephemeral_range"] = pathlib.Path(
        "/proc/sys/net/ipv4/ip_local_port_range"
    ).read_text().strip()
    with socket.socket() as listener, socket.socket() as client:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        client.connect(listener.getsockname())
        connection, address = listener.accept()
        with connection, socket.socket() as contender:
            contender.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                contender.bind(client.getsockname())
                contender.listen()
            except OSError as error:
                assert error.errno == errno.EADDRINUSE
                results["tcp_client_port_blocks_listener"] = True
            else:
                raise AssertionError("Expected EADDRINUSE")
    with tempfile.TemporaryDirectory(prefix="dsc-lock-research-") as directory:
        filename = pathlib.Path(directory) / "commit.lock"
        child = start_holder(filename)
        try:
            assert try_lock(filename) is None
            results["flock_excludes_competitor"] = True
            child.send_signal(signal.SIGSTOP)
            waited_pid, status = os.waitpid(child.pid, os.WUNTRACED)
            assert waited_pid == child.pid and os.WIFSTOPPED(status)
            assert try_lock(filename) is None
            results["paused_holder_keeps_lock"] = True
            child.kill()
            child.wait(timeout=5)
            assert child.returncode == -signal.SIGKILL
            descriptor = try_lock(filename)
            assert descriptor is not None
            os.close(descriptor)
            results["sigkill_releases_without_unlink"] = filename.exists()
            assert results["sigkill_releases_without_unlink"]
        finally:
            stop_holder(child)
        child = start_holder(filename)
        try:
            child.stdin.write("x")
            child.stdin.flush()
            assert child.wait(timeout=5) == 0
            descriptor = try_lock(filename)
            assert descriptor is not None
            os.close(descriptor)
            results["normal_close_releases"] = True
        finally:
            stop_holder(child)
        child = start_holder(filename)
        try:
            old_inode = filename.stat().st_ino
            filename.unlink()
            descriptor = try_lock(filename)
            assert descriptor is not None
            try:
                assert filename.stat().st_ino != old_inode
                assert child.poll() is None
                results["unlink_recreate_breaks_shared_lock_identity"] = True
            finally:
                os.close(descriptor)
        finally:
            stop_holder(child)
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
