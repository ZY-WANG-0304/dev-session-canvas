#!/usr/bin/python3
"""Controlled PTY process: replies originate here, never in the browser/ACK."""
import os,sys,time,select,tty,termios,json
if '--version' in sys.argv:
    print('codex-cli 0.0.0-diagnostic');sys.exit(0)
with open('probe-pid.json','w') as file: json.dump({'pid':os.getpid()},file)
original=termios.tcgetattr(sys.stdin.fileno())
sequence=0
block=0
started=time.monotonic()
last_tick=0
try:
    tty.setraw(sys.stdin.fileno())
    os.write(1,b'DSC_PROBE_READY\r\n')
    while time.monotonic()-started < 600:
        if select.select([sys.stdin],[],[],0.01)[0]:
            data=os.read(0,4096)
            for byte in data:
                if byte==3: sys.exit(0)
                sequence+=1
                os.write(1,('REPLY_%06d_%02x\r\n'%(sequence,byte)).encode())
        now=time.monotonic()
        if now-last_tick>=0.05:
            last_tick=now
            try:
                with open('load.json') as file: enabled=json.load(file)['enabled']
            except (FileNotFoundError,ValueError): enabled=False
            if enabled:
                block+=1
                os.write(1,('\x1b[32mLOAD_%08d '%block+'x'*60+'\x1b[0m\r\n').encode()*12)
finally:
    termios.tcsetattr(sys.stdin.fileno(),termios.TCSANOW,original)
