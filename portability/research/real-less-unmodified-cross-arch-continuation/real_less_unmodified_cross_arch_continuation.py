#!/usr/bin/env python3
import fcntl, hashlib, json, os, select, shutil, signal, struct, subprocess, sys, termios, tempfile, time
from pathlib import Path
ROWS=24; COLS=80
READ_SYSCALL_BY_ARCH={"x86_64":0,"amd64":0,"aarch64":63,"arm64":63}
CLAIM_GUARD={"arbitraryProcessRestoreClaimed":False,"rawVmReplayUsed":False,"sourceIsaEmulationUsed":False,"metadataOnlySuccess":False,"markerSymbolsUsed":False}

def read_text(p):
    try: return Path(p).read_text(encoding='utf-8',errors='replace')
    except OSError: return ''
def parse_stat(s):
    end=s.rfind(')'); return [*s[:end+1].split(maxsplit=1),*s[end+2:].split()] if end!=-1 else s.split()
def parse_syscall(raw):
    raw=raw.strip()
    if not raw or raw=='running': return {"raw":raw,"parsed":False}
    parts=raw.split()
    try: num=int(parts[0],0); args=[int(x,0) for x in parts[1:7]]
    except ValueError: return {"raw":raw,"parsed":False}
    return {"raw":raw,"parsed":True,"number":num,"name":"read" if num==READ_SYSCALL_BY_ARCH.get(os.uname().machine) else f"syscall-{num}","args":args,"fd":args[0] if args else None}
def proc_state(pid):
    status=read_text(f'/proc/{pid}/status'); stat=parse_stat(read_text(f'/proc/{pid}/stat')); fields={}
    for line in status.splitlines():
        if ':' in line:
            k,v=line.split(':',1); fields[k]=v.strip()
    return {"statusState":fields.get('State','unknown').split()[0],"threads":int(fields['Threads']) if fields.get('Threads') else None,"signalPendingMask":fields.get('SigPnd'),"statPgrp":int(stat[4]) if len(stat)>4 else None,"statSession":int(stat[5]) if len(stat)>5 else None,"statTtyNr":int(stat[6]) if len(stat)>6 else None,"syscall":parse_syscall(read_text(f'/proc/{pid}/syscall'))}
def fd_facts(pid):
    root=Path(f'/proc/{pid}/fd'); out=[]
    if not root.exists(): return out
    for item in sorted(root.iterdir(),key=lambda p:int(p.name)):
        try: target=os.readlink(item)
        except OSError: target='unreadable'
        out.append({"fd":int(item.name),"target":target})
    return out
def fd_target(fds,fd): return next((x['target'] for x in fds if x['fd']==fd),None)
def qbytes(fd): return struct.unpack('I',fcntl.ioctl(fd,termios.FIONREAD,struct.pack('I',0)))[0]
def slave_q(path):
    try: fd=os.open(path,os.O_RDONLY|os.O_NOCTTY|os.O_NONBLOCK)
    except OSError as e: return {"available":False,"error":str(e)}
    try: return {"available":True,"bytes":qbytes(fd)}
    finally: os.close(fd)
def fg(fd):
    try: return os.tcgetpgrp(fd)
    except OSError as e: return {"error":str(e)}
def set_size(fd): fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',ROWS,COLS,0,0))
def drain(fd,deadline,expected=None):
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
def input_bytes(): return ('\n'.join(f'line-{i:03d}' for i in range(1,120))+'\n').encode()
def sha(data): return hashlib.sha256(data).hexdigest()
def version(binary):
    r=subprocess.run([binary,'--version'],text=True,capture_output=True,check=False)
    return r.stdout.splitlines()[0] if r.stdout.splitlines() else 'unknown'
def launch(workdir):
    binary=shutil.which('less') or '/usr/bin/less'; inp=Path(workdir)/'less-input.txt'; inp.write_bytes(input_bytes())
    master,slave=os.openpty(); set_size(slave); slave_path=os.ttyname(slave); env=os.environ.copy(); env.update({'TERM':'xterm','LESS':'-S'})
    def pre(): os.setsid(); fcntl.ioctl(slave,termios.TIOCSCTTY,0)
    proc=subprocess.Popen([binary,str(inp)],stdin=slave,stdout=slave,stderr=slave,cwd=workdir,env=env,preexec_fn=pre,close_fds=True)
    os.close(slave); before=drain(master,time.time()+4,'line-023')+drain(master,time.time()+0.5)
    return binary,inp,master,slave_path,proc,before
def file_id(path):
    st=os.stat(path); return {"path":str(path),"size":st.st_size,"mtimeNs":st.st_mtime_ns,"sha256":sha(Path(path).read_bytes())}
def capture(mode,role):
    with tempfile.TemporaryDirectory(prefix='machinen-less-unmodified-cross-') as wd:
        binary,inp,master,slave,proc,before=launch(wd)
        try:
            time.sleep(.2); fds=fd_facts(proc.pid); state=proc_state(proc.pid); syscall=state['syscall']; stdio={str(fd):fd_target(fds,fd) for fd in (0,1,2)}
            pty={"slavePath":slave,"rows":ROWS,"cols":COLS,"inputQueueBytesOnMaster":qbytes(master),"inputQueueBytesOnSlave":slave_q(slave),"foregroundPgrpFromMaster":fg(master)}
            proc_desc={"pid":proc.pid,"state":state,"fds":fds,"stdioTargets":stdio,"syscallFdTarget":fd_target(fds,syscall.get('fd')) if syscall.get('fd') is not None else None,"allStdioOnControlledPty":all(t==slave for t in stdio.values())}
            checks={"firstPage":"line-001" in before and "line-023" in before,"syscallRead":syscall.get('name')=='read',"syscallFdPty":proc_desc['syscallFdTarget']==slave,"stdioPty":proc_desc['allStdioOnControlledPty'],"sessionPgrp":state['statSession']==proc.pid and state['statPgrp']==proc.pid and pty['foregroundPgrpFromMaster']==proc.pid,"queuesEmpty":pty['inputQueueBytesOnMaster']==0 and pty['inputQueueBytesOnSlave'].get('bytes')==0}
            result={"role":role,"hostArch":os.uname().machine,"decision":"captured","less":{"path":binary,"versionLine":version(binary)},"process":proc_desc,"regularFile":file_id(inp),"pty":pty,"pageDescriptor":{"inputSha256":sha(input_bytes()),"expectedFirstPageStart":"line-001","expectedAfterSpaceStart":"line-024"},"screenAtCandidate":{"containsFirstPage":checks['firstPage'],"sample":before[-1000:]},"candidateChecks":checks,"claimGuard":CLAIM_GUARD}
            if mode=='continue':
                os.write(master,b' '); after=drain(master,time.time()+3,'line-024')+drain(master,time.time()+0.5)
                result['materialization']={"method":"target-native unmodified less driven to same descriptor-defined page","sameFileContent":True,"sameRowsCols":True,"sourceRegisterWrites":False,"sourceHeapWrites":False,"sourceStackWrites":False}
                result['resume']={"injectedKey":"SPACE"}; result['screenAfterResume']={"containsExpectedNextPage":"line-024" in after,"sample":after[-1000:]}
                result['decision']='accepted' if all(checks.values()) and 'line-024' in after else 'failed'
            else:
                result['decision']='captured' if all(checks.values()) else 'failed'
            return result
        finally:
            try: os.write(master,b'q')
            except OSError: pass
            if proc.poll() is None:
                try: os.killpg(os.getpgid(proc.pid),signal.SIGTERM)
                except OSError: pass
            try: proc.wait(timeout=1)
            except subprocess.TimeoutExpired: os.killpg(os.getpgid(proc.pid),signal.SIGKILL)
            try: os.close(master)
            except OSError: pass
def write(p,d): Path(p).write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
def remote(args):
    mode,role,out=args; res=capture(mode,role); write(out,res); print(json.dumps({"status":res['decision'],"arch":res['hostArch']},indent=2)); return 0 if res['decision']!='failed' else 1
def combine(args):
    direction,src,tgt,out,report=args; s=json.loads(Path(src).read_text()); t=json.loads(Path(tgt).read_text())
    ok=s['decision']=='captured' and t['decision']=='accepted' and s['hostArch']!=t['hostArch'] and s['pageDescriptor']['inputSha256']==t['pageDescriptor']['inputSha256']
    combined={"kind":"machinen.research.real-less-unmodified-cross-arch-continuation.direction","version":1,"direction":direction,"decision":"accepted" if ok else "failed","source":s,"target":t,"materializationSummary":{"targetNativeLess":True,"sameFileContent":s['pageDescriptor']['inputSha256']==t['pageDescriptor']['inputSha256'],"sameRowsCols":s['pty']['rows']==t['pty']['rows'] and s['pty']['cols']==t['pty']['cols'],"sourceRegisterWrites":False,"sourceHeapWrites":False,"sourceStackWrites":False,"sourceIsaEmulationUsed":False},"claimGuard":CLAIM_GUARD}
    write(out,combined); rp=Path(report); existing={"directions":[]}
    if rp.exists(): existing=json.loads(rp.read_text())
    dirs=[x for x in existing.get('directions',[]) if x.get('direction')!=direction]; dirs.append({"direction":direction,"decision":combined['decision'],"sourceArch":s['hostArch'],"targetArch":t['hostArch']})
    write(report,{"kind":"machinen.research.real-less-unmodified-cross-arch-continuation.report","version":1,"status":"passed" if dirs and all(x['decision']=='accepted' for x in dirs) else "failed","directions":sorted(dirs,key=lambda x:x['direction']),"claimGuard":CLAIM_GUARD})
    print(json.dumps({"direction":direction,"decision":combined['decision']},indent=2)); return 0 if ok else 1
def main():
    if sys.argv[1]=='remote': return remote(sys.argv[2:])
    if sys.argv[1]=='combine': return combine(sys.argv[2:])
    return 2
if __name__=='__main__': raise SystemExit(main())
