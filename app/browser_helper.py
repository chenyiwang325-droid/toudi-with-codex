"""Chrome-native Codex bridge. No TouDi App, HTTP server or personal file access."""
import argparse
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile

HOST='com.toudi.filling.codex'
EXTENSION_ID='edfgnahdkpobmkhckjhadadnlbhpbpmd'
ORIGIN='chrome-extension://'+EXTENSION_ID+'/'
MAX_MESSAGE=512*1024
VERSION='0.2.0'


def validate_request(request):
    if not isinstance(request,dict) or request.get('protocol')!=1 or type(request.get('requestId')) is not int:
        raise ValueError('本机连接请求无效。')
    if request.get('op')=='status':
        if set(request)-{'protocol','requestId','op'}:raise ValueError('不支持的连接请求。')
        return request
    if request.get('op')!='map' or set(request)-{'protocol','requestId','op','model','fields','allowedFacts'} or request.get('model')!='gpt-6-luna':
        raise ValueError('本机工具只支持 GPT-6 Luna 字段核对，不执行其他操作。')
    fields=request.get('fields');facts=request.get('allowedFacts')
    if not isinstance(fields,list) or len(fields)>500 or not isinstance(facts,list) or len(facts)>1500:raise ValueError('字段核对范围无效。')
    def checked(items,key,allowed):
        seen=set()
        for item in items:
            if not isinstance(item,dict) or set(item)-allowed or not isinstance(item.get(key),str) or not item[key] or item[key] in seen:raise ValueError('核对请求包含无效或重复的字段。')
            seen.add(item[key])
            for name,value in item.items():
                if name in {'options','aliases'}:continue
                if not isinstance(value,str) or len(value)>1000:raise ValueError('字段说明无效。')
            if key=='id':
                if item.get('type') not in {'text','textarea','email','tel','date','month','number','select','radio','combobox'}:raise ValueError('此类字段不交给模型核对。')
                opts=item.get('options',[])
                if not isinstance(opts,list) or len(opts)>1000 or any(not isinstance(o,dict) or set(o)-{'value','text'} or any(not isinstance(v,str) or len(v)>2000 for v in o.values()) for o in opts):raise ValueError('网页选项无效。')
            else:
                aliases=item.get('aliases',[])
                if not isinstance(aliases,list) or len(aliases)>80 or any(not isinstance(a,str) or len(a)>1000 for a in aliases):raise ValueError('资料别名无效。')
                if item.get('module') not in {'personal','education','internship','project','language'}:raise ValueError('资料模块无效。')
    checked(fields,'id',{'id','label','module','groupLabel','recordHint','type','options'})
    checked(facts,'key',{'key','label','module','recordId','recordLabel','recordHint','aliases'})
    return request


def operation(request):
    validate_request(request)
    if request['op']=='status':
        from codex_connection import codex_status
        return {**codex_status(refresh=True),'helperVersion':VERSION,'independent':True}
    from codex_mapping import map_with_codex
    profile={'facts':[dict(f,manual=False) for f in request['allowedFacts']]}
    scan={'fields':request['fields']}
    plan={'rows':[{'fieldId':f['id'],'status':'missing'} for f in request['fields']]}
    mappings,provider=map_with_codex(profile,scan,plan,model='gpt-6-luna')
    return {'mappings':mappings,'provider':provider,'helperVersion':VERSION}


def read_exact(stream,length):
    chunks=[]
    while length:
        data=stream.read(length)
        if not data:return None
        chunks.append(data);length-=len(data)
    return b''.join(chunks)


def serve(origin,stream_in=None,stream_out=None):
    if origin.rstrip('/')!=ORIGIN.rstrip('/'):return 1
    incoming=stream_in or sys.stdin.buffer;outgoing=stream_out or sys.stdout.buffer
    if os.name=='nt' and stream_in is None:
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(),os.O_BINARY);msvcrt.setmode(sys.stdout.fileno(),os.O_BINARY)
    while True:
        header=read_exact(incoming,4)
        if header is None:return 0
        length=struct.unpack('=I',header)[0]
        if not 1<=length<=MAX_MESSAGE:return 1
        raw=read_exact(incoming,length)
        if raw is None:return 1
        ident=None
        try:
            request=json.loads(raw);ident=request.get('requestId') if isinstance(request,dict) else None
            result={'requestId':ident,'value':operation(request)}
        except ValueError as exc:result={'requestId':ident,'error':str(exc)}
        except Exception:result={'requestId':ident,'error':'本机 Codex 核对未完成；原计划保留，可继续本地填写。'}
        encoded=json.dumps(result,ensure_ascii=False).encode('utf-8')
        outgoing.write(struct.pack('=I',len(encoded))+encoded);outgoing.flush()


def installation_home():
    if sys.platform=='darwin':return Path.home()/'Library/Application Support/TouDiBrowser'
    if os.name=='nt':return Path(os.environ.get('LOCALAPPDATA',str(Path.home()/'AppData/Local')))/'TouDiBrowser'
    return Path.home()/'.local/share/toudi-browser'


def manifest_file():
    if sys.platform=='darwin':return Path.home()/'Library/Application Support/Google/Chrome/NativeMessagingHosts'/(HOST+'.json')
    if os.name=='nt':return installation_home()/(HOST+'.json')
    return Path.home()/'.config/google-chrome/NativeMessagingHosts'/(HOST+'.json')


def install(home=None,manifest=None):
    if not getattr(sys,'frozen',False):raise ValueError('请运行打包后的浏览器连接工具安装程序。')
    home=Path(home or installation_home());manifest=Path(manifest or manifest_file())
    if home.is_symlink() or manifest.is_symlink():raise ValueError('安装目录或注册文件不能为符号链接。')
    home.mkdir(parents=True,exist_ok=True,mode=0o700)
    source=Path(sys.executable).resolve().parent
    target=home/('helper-'+VERSION)
    # Validate bundled resources before replacing an older installed copy.
    if not (source/'_internal').is_dir():raise ValueError('连接工具资源不完整，请重新解压完整下载包。')
    staging=Path(tempfile.mkdtemp(prefix='.install-',dir=home))
    try:
        shutil.copytree(source,staging/'helper')
        old=home/('helper-'+VERSION+'-previous')
        if old.exists():shutil.rmtree(old)
        if target.exists():target.rename(old)
        (staging/'helper').rename(target)
        manifest.parent.mkdir(parents=True,exist_ok=True)
        value={'name':HOST,'description':'TouDi browser Codex bridge','path':str(target/Path(sys.executable).name),'type':'stdio','allowed_origins':[ORIGIN]}
        fd,temp=tempfile.mkstemp(prefix='.toudi-host-',dir=manifest.parent)
        with os.fdopen(fd,'w',encoding='utf-8') as stream:json.dump(value,stream,indent=2)
        os.chmod(temp,0o600);os.replace(temp,manifest)
        if os.name=='nt':
            import winreg
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER,'Software\\Google\\Chrome\\NativeMessagingHosts\\'+HOST) as key:winreg.SetValueEx(key,'',0,winreg.REG_SZ,str(manifest))
        if old.exists():shutil.rmtree(old)
    finally:shutil.rmtree(staging,ignore_errors=True)
    return {'installed':True,'helperVersion':VERSION,'independent':True,'host':HOST}


def main(argv=None):
    args=list(sys.argv[1:] if argv is None else argv)
    if args and args[0].startswith('chrome-extension://'):return serve(args[0])
    parser=argparse.ArgumentParser(description='TouDi 浏览器 Codex 连接工具')
    parser.add_argument('--install',action='store_true');parser.add_argument('--status',action='store_true')
    parser.add_argument('--install-home');parser.add_argument('--manifest')
    options=parser.parse_args(args)
    try:
        if options.status:
            print(json.dumps({'registered':manifest_file().is_file(),'helperVersion':VERSION,'independent':True}));return 0
        value=install(options.install_home,options.manifest)
        print(json.dumps(value))
        if not args and sys.platform=='darwin':subprocess.run(['osascript','-e','display dialog "浏览器连接已安装。返回 Chrome 插件的资料与设置，点击检查连接即可。日常无需打开 TouDi App。" with title "TouDi 浏览器连接" buttons {"完成"} default button "完成"'],capture_output=True)
        return 0
    except (ValueError,OSError):
        if not args and sys.platform=='darwin':subprocess.run(['osascript','-e','display dialog "安装未完成，请检查完整下载包和用户目录权限。" with title "TouDi 浏览器连接" buttons {"确定"} default button "确定"'],capture_output=True)
        else:print(json.dumps({'error':'浏览器连接安装未完成，请检查完整下载包和用户目录权限。'}))
        return 1


if __name__=='__main__':raise SystemExit(main())
