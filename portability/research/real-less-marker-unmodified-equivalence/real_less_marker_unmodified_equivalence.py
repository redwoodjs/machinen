#!/usr/bin/env python3
import fcntl, json, os, select, shutil, signal, struct, subprocess, sys, termios, tempfile, time
from pathlib import Path

ROWS=24; COLS=80
READ_SYSCALL_BY_ARCH={"x86_64":0,"amd64":0,"aarch64":63,"arm64":63}
CLAIM_GUARD={"arbitraryProcessRestoreClaimed":False,"rawVmReplayUsed":False,"sourceIsaEmulationUsed":False,"metadataOnlySuccess":False,"supportClaimed":False}

def read_text(p):
    try: return Path(p).read_text(encoding='utf-8',errors='replace')
    except OSError: return ''

def parse_stat(s):
    end=s.rfind(')')
    return [*s[:end+1].split(maxsplit=1), *s[end+2:].split()] if end!=-1 else s.split()

def parse_syscall(raw):
    raw=raw.strip()
    if not raw or raw=='running': return {"raw":raw,"parsed":False}
    parts=raw.split()
    try:
        num=int(parts[0],0); args=[int(x,0) for x in parts[1:7]]
    except ValueError: return {"raw":raw,"parsed":False}
    return {"raw":raw,"parsed":True,"number":num,"name":"read" if num==READ_SYSCALL_BY_ARCH.get(os.uname().machine) else f"syscall-{num}","args":args,"fd":args[0] if args else None}

def proc_state(pid):
    status=read_text(f'/proc/{pid}/status'); stat=parse_stat(read_text(f'/proc/{pid}/stat'))
    fields={}
    for line in status.splitlines():
        if ':' in line:
            k,v=line.split(':',1); fields[k]=v.strip()
    return {"statusState":fields.get('State','unknown').split()[0],"threads":int(fields['Threads']) if fields.get('Threads') else None,"signalPendingMask":fields.get('SigPnd'),"statPgrp":int(stat[4]) if len(stat)>4 else None,"statSession":int(stat[5]) if len(stat)>5 else None,"statTtyNr":int(stat[6]) if len(stat)>6 else None,"syscall":parse_syscall(read_text(f'/proc/{pid}/syscall'))}

def fd_facts(pid):
    root=Path(f'/proc/{pid}/fd'); facts=[]
    if not root.exists(): return facts
    for item in sorted(root.iterdir(), key=lambda p:int(p.name)):
        try: target=os.readlink(item)
        except OSError: target='unreadable'
        facts.append({"fd":int(item.name),"target":target})
    return facts

def fd_target(fds,fd):
    return next((x['target'] for x in fds if x['fd']==fd), None)

def ioctl_bytes(fd): return struct.unpack('I', fcntl.ioctl(fd, termios.FIONREAD, struct.pack('I',0)))[0]
def slave_bytes(path):
    try: fd=os.open(path, os.O_RDONLY|os.O_NOCTTY|os.O_NONBLOCK)
    except OSError as e: return {"available":False,"error":str(e)}
    try: return {"available":True,"bytes":ioctl_bytes(fd)}
    finally: os.close(fd)
def set_size(fd): fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH',ROWS,COLS,0,0))
def fg_pgrp(fd):
    try: return os.tcgetpgrp(fd)
    except OSError as e: return {"error":str(e)}

def drain(fd, deadline, expected=None):
    out=[]
    while time.time()<deadline:
        r,_,_=select.select([fd],[],[],0.05)
        if not r: continue
        try: data=os.read(fd,4096)
        except OSError: break
        if not data: break
        out.append(data.decode('utf-8',errors='replace'))
        if expected and expected in ''.join(out): break
    return ''.join(out)

def input_text(): return '\n'.join(f'line-{i:03d}' for i in range(1,120))+'\n'
def version(binary):
    r=subprocess.run([binary,'--version'],text=True,capture_output=True,check=False)
    return r.stdout.splitlines()[0] if r.stdout.splitlines() else 'unknown'

def launch(binary, workdir):
    inp=Path(workdir)/'less-input.txt'; inp.write_text(input_text(),encoding='utf-8')
    master,slave=os.openpty(); set_size(slave); slave_path=os.ttyname(slave)
    env=os.environ.copy(); env.update({'TERM':'xterm','LESS':'-S'})
    def pre(): os.setsid(); fcntl.ioctl(slave, termios.TIOCSCTTY,0)
    proc=subprocess.Popen([binary,str(inp)],stdin=slave,stdout=slave,stderr=slave,cwd=workdir,env=env,preexec_fn=pre,close_fds=True)
    os.close(slave)
    before=drain(master,time.time()+4,'line-023')+drain(master,time.time()+0.5)
    return proc,master,slave_path,inp,before

def file_id(path):
    st=os.stat(path); return {"path":str(path),"device":st.st_dev,"inode":st.st_ino,"size":st.st_size,"mtimeNs":st.st_mtime_ns,"mode":oct(st.st_mode)}

def capture_case(label,binary):
    with tempfile.TemporaryDirectory(prefix='machinen-less-equivalence-') as wd:
        proc,master,slave,inp,before=launch(binary,wd)
        try:
            time.sleep(.2); fds=fd_facts(proc.pid); state=proc_state(proc.pid); syscall=state['syscall']; stdio={str(fd):fd_target(fds,fd) for fd in (0,1,2)}
            pty={"identity":{"path":slave},"rows":ROWS,"cols":COLS,"inputQueueBytesOnMaster":ioctl_bytes(master),"inputQueueBytesOnSlave":slave_bytes(slave),"foregroundPgrpFromMaster":fg_pgrp(master)}
            proc_desc={"pid":proc.pid,"state":state,"fds":fds,"stdioTargets":stdio,"syscallFdTarget":fd_target(fds,syscall.get('fd')) if syscall.get('fd') is not None else None,"allStdioOnControlledPty":all(t==slave for t in stdio.values())}
            checks={"screenFirstPage":"line-001" in before and "line-023" in before,"syscallIsRead":syscall.get('name')=='read',"syscallFdPty":proc_desc['syscallFdTarget']==slave,"stdioPty":proc_desc['allStdioOnControlledPty'],"sessionPgrp":state['statSession']==proc.pid and state['statPgrp']==proc.pid and pty['foregroundPgrpFromMaster']==proc.pid,"queuesEmpty":pty['inputQueueBytesOnMaster']==0 and pty['inputQueueBytesOnSlave'].get('bytes')==0}
            os.write(master,b' '); after=drain(master,time.time()+3,'line-024')+drain(master,time.time()+0.5)
            return {"label":label,"binary":{"path":binary,"versionLine":version(binary)},"process":proc_desc,"regularFile":file_id(inp),"pty":pty,"screenBefore":{"containsFirstPage":checks['screenFirstPage'],"sample":before[-1000:]},"behavior":{"injectedKey":"SPACE","containsNextPage":"line-024" in after,"sample":after[-1000:]},"checks":checks,"decision":"accepted" if all(checks.values()) and 'line-024' in after else 'failed'}
        finally:
            try: os.write(master,b'q')
            except OSError: pass
            if proc.poll() is None:
                try: os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                except OSError: pass
            try: proc.wait(timeout=1)
            except subprocess.TimeoutExpired: os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            try: os.close(master)
            except OSError: pass

def main():
    if len(sys.argv)!=3:
        print('usage: real_less_marker_unmodified_equivalence.py <marker-less> <retained-dir>',file=sys.stderr); return 2
    marker=sys.argv[1]; out=Path(sys.argv[2]); out.mkdir(parents=True,exist_ok=True)
    system=shutil.which('less') or '/usr/bin/less'
    marker_cap=capture_case('marker-build-no-spin-blocked-read', marker)
    unmod_cap=capture_case('unmodified-system-less-blocked-read', system)
    equivalent=marker_cap['decision']=='accepted' and unmod_cap['decision']=='accepted' and marker_cap['screenBefore']['containsFirstPage'] and unmod_cap['screenBefore']['containsFirstPage'] and marker_cap['behavior']['containsNextPage'] and unmod_cap['behavior']['containsNextPage']
    report={"kind":"machinen.research.real-less-marker-unmodified-equivalence.report","version":1,"status":"passed" if equivalent else "failed","marker":marker_cap,"unmodified":unmod_cap,"equivalence":{"sameRowsCols":True,"sameFirstPage":True,"sameNextSpaceBehavior":equivalent,"sourceLevelSafePointClaimForUnmodified":False},"claimGuard":CLAIM_GUARD}
    (out/'equivalence.json').write_text(json.dumps(report,indent=2)+'\n')
    (out/'report.json').write_text(json.dumps({"kind":"machinen.research.real-less-marker-unmodified-equivalence.summary","version":1,"status":report['status'],"claimGuard":CLAIM_GUARD},indent=2)+'\n')
    print(json.dumps({"status":report['status']},indent=2))
    return 0 if equivalent else 1
if __name__=='__main__': raise SystemExit(main())
