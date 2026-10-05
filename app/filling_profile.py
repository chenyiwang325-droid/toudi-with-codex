"""Conservative local filling facts and plans; never reads web-supplied paths or writes forms."""
from decimal import Decimal, InvalidOperation
import datetime
import copy
import hashlib
import json
import re
import unicodedata
from pathlib import Path

PROFILES=[{'id':'general','label':'个人与教育通用'}, {'id':'state','label':'央国企／专业口径'}, {'id':'ai-product','label':'AI 产品口径'}]
ALIASES={
 '姓名':['姓名','name','full name','candidate name'], '性别':['性别','gender','sex'],
 '出生日期':['出生日期','生日','date of birth','birth date','birthday'],
 '证件类型':['证件类型','证件类别','identity document type'], '证件号码':['证件号码','身份证号','身份证号码','id number','identity number'],
 '国籍':['国籍','nationality'], '民族':['民族','ethnicity'], '政治面貌':['政治面貌','political status'],
 '身高cm':['身高cm','身高','height','height cm'], '体重kg':['体重kg','体重','weight','weight kg'],
 '婚姻状况':['婚姻状况','marital status'], '当前户籍所在地':['当前户籍所在地','户籍所在地','户口所在地','户籍','household registration'],
 '当前户籍类型':['当前户籍类型','户籍类型','户口类型'], '生源地':['生源地','生源所在地','student origin'],
 '籍贯':['籍贯','native place'], '现居地':['现居地','现居住地','居住地','current residence','current city'],
 '家庭地址':['家庭地址','home address'], '电子邮箱':['电子邮箱','邮箱','email','email address','e-mail'],
 '手机':['手机','手机号码','手机号','mobile','mobile phone','phone number','telephone'],
 '学历':['学历','education level','qualification'], '学位':['学位','degree'], '学历类型':['学历类型','学习形式','education type'],
 '学校':['学校','学校名称','毕业院校','院校','university','school','institution','school name','university name'],
 '学院':['学院','院系','faculty','college'], '专业':['专业','专业名称','major','field of study'],
 '开始日期':['开始日期','开始时间','入学时间','入学日期','项目开始时间','项目开始日期','start date','from'], '结束日期':['结束日期','结束时间','毕业时间','毕业日期','项目结束时间','项目结束日期','end date','to'],
 'GPA':['GPA','平均绩点','绩点','grade point average'], '年级排名':['年级排名','专业排名','class rank'],
 '英语四级':['英语四级','四级成绩','cet4','cet-4'], '英语六级':['英语六级','六级成绩','cet6','cet-6'],
 '六级获证日期':['六级获证日期','六级考试日期'],
 '单位':['单位','公司','公司名称','实习单位','雇主','company','company name','employer','employer name'], '部门':['部门','department'],
 '职务':['职务','职位','岗位','position','job title'], '工作地点':['工作地点','实习地点','work location'],
 '开始':['开始','开始时间','开始日期','实习开始时间','start date','from'],
 '结束':['结束','结束时间','结束日期','实习结束时间','end date','to'],
 '职责':['职责','工作职责','工作内容','实习内容','responsibilities','description'],
 '职责_199字版':['职责','工作职责','工作内容','实习内容','responsibilities','职责199字版'],
 '职责_229字完整版':['职责','工作职责','工作内容','实习内容','responsibilities','职责229字完整版'],
 '名称':['项目名称','project name'], '角色':['项目角色','role'], '时间':['项目时间','project dates'],
 '简述':['项目描述','项目简述','project description'], '最高学历':['最高学历','highest education','highest qualification'],
 '最高学位':['最高学位','highest degree'],
}
MANUAL_TERMS=('验证码','verification code','captcha','协议','同意','承诺','agreement','consent','签名','signature','家庭成员','父亲','母亲','亲属','紧急联系人','证明人','上传','upload','照片','photo','father','mother','family','emergency contact','referee','reference contact')
SENSITIVE_TERMS=('姓名','name','手机','电话','phone','邮箱','email','证件','身份证','id number','家庭地址','home address')
MODULES={'教育':'education','education':'education','学历':'education','实习':'internship','工作':'internship','internship':'internship','employment':'internship','项目':'project','project':'project','个人':'personal','personal':'personal','基本':'personal','语言':'language','language':'language','work':'internship','projects':'project'}


def normalized(value):
    return re.sub(r'[\s\W_]+','',unicodedata.normalize('NFKC',str(value)).casefold())


def sensitive_label(label): return any(term in str(label).casefold() for term in SENSITIVE_TERMS)


def manual_label(label): return any(term in str(label).casefold() for term in MANUAL_TERMS)


def precision(value):
    text=str(value).strip()
    if re.fullmatch(r'\d{4}[-/.年]\d{1,2}月?',text):return 'month'
    if re.fullmatch(r'\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?',text):return 'day'
    return None


def ongoing_end(fact):
    return fact.get('module') in ('project','internship') and fact.get('label') in ('结束','结束日期') and normalized(fact.get('value','')) in ('至今','present','ongoing','current')


def validate_date_policy(fact):
    if 'ongoing' in fact and not isinstance(fact['ongoing'],bool):raise ValueError('ongoing must be boolean')
    if fact.get('ongoing') and not ongoing_end(fact):raise ValueError('ongoing is only valid for a present project/work end date')
    if fact.get('dateFallback') not in (None,'','today'):raise ValueError('unknown ongoing date fallback')
    if fact.get('dateFallback') and not (fact.get('ongoing') and ongoing_end(fact)):raise ValueError('date fallback requires an ongoing end date')


def sort_facts(facts):
    """Order complete records by start date without changing stable fact/record IDs."""
    groups={}; modules={'personal':0,'education':1,'internship':2,'project':3,'language':4}
    for fact in facts:groups.setdefault((fact['module'],fact.get('recordId','')),[]).append(fact)
    def start_date(group):
        for label in ('开始日期','开始','时间'):
            value=next((str(f['value']) for f in group if f['label']==label),'')
            match=re.match(r'^(\d{4})[-/.年](\d{1,2})(?:[-/.月](\d{1,2})(?!\d))?',value)
            if match:
                year,month,day=match.groups()
                try:return datetime.date(int(year),int(month),int(day or 1)).toordinal()
                except ValueError:pass
        return 0
    return [fact for key,group in sorted(groups.items(),key=lambda item:(modules.get(item[0][0],5),-start_date(item[1]))) for fact in group]


def source_file(workspace):
    root=Path(workspace).resolve()
    for relative in ('填报资料/资料.json','网申信息库.json'):
        path=root/relative
        if any(p.is_symlink() for p in [path,*path.parents] if p!=root.parent): raise ValueError('symlink filling profile denied')
        if path.is_file(): return path,relative
    return None,None


def load_profile(workspace,profile_id='general'):
    if profile_id not in {p['id'] for p in PROFILES}: raise ValueError('unknown profile id')
    path,source_name=source_file(workspace)
    if path is None:return {'sourceVersion':'missing','sourceName':None,'profileId':profile_id,'profiles':copy.deepcopy(PROFILES),'facts':[],'rules':[],'warnings':['尚未提供填报资料，未创建示例或推测个人信息。'],'supplements':[]}
    raw=path.read_bytes(); data=json.loads(raw)
    if not isinstance(data,dict):raise ValueError('filling profile root must be an object')
    result={'sourceVersion':hashlib.sha256(raw).hexdigest(),'sourceName':source_name,'profileId':profile_id,'profiles':copy.deepcopy(PROFILES),'facts':[],'rules':[],'warnings':[],'supplements':[]}
    saved=data.get('savedAt') or data.get('_保存日期') or data.get('updatedAt')
    if not saved:
        date=re.search(r'\d{4}-\d{2}-\d{2}',str(data.get('_说明','')))
        saved=date.group(0) if date else None
    result['sourceSavedAt']=str(saved) if saved else None
    result['warnings'].append('资料保存日期：'+str(saved) if saved else '资料未注明保存日期；使用前请核对时效。')
    if source_name=='填报资料/资料.json':
        if data.get('schemaVersion')!=1 or not isinstance(data.get('facts'),list) or not isinstance(data.get('rules',[]),list): raise ValueError('formal filling profile requires schemaVersion 1, facts and rules')
        if any(not isinstance(rule,str) for rule in data.get('rules',[])) or not isinstance(data.get('supplements',[]),list) or any(not isinstance(item,dict) for item in data.get('supplements',[])):raise ValueError('invalid formal rules or supplements')
        result['rules']=copy.deepcopy(data.get('rules',[])); result['supplements']=copy.deepcopy(data.get('supplements',[]))
        seen=set()
        for fact in data['facts']:
            if not isinstance(fact,dict) or not all(isinstance(fact.get(k),str) for k in ('key','label','module')) or not fact['key'] or not isinstance(fact.get('value'),(str,int,float)) or isinstance(fact.get('value'),bool):raise ValueError('invalid fact')
            if fact['module'] not in {'education','internship','project','personal','language'}:raise ValueError('fact module must be education/internship/project/personal/language')
            if fact['key'] in seen:raise ValueError('duplicate fact key')
            seen.add(fact['key'])
            profiles=fact.get('profiles',['general','state','ai-product'])
            if not isinstance(profiles,list) or any(p not in {p['id'] for p in PROFILES} for p in profiles):raise ValueError('invalid fact profiles')
            if fact['module']=='internship' and 'general' in profiles:raise ValueError('internships require explicit state/ai-product profiles')
            if profile_id not in profiles:continue
            current=copy.deepcopy(fact); current.setdefault('recordId','');current.setdefault('recordLabel','');current.setdefault('recordHint','');current.setdefault('aliases',ALIASES.get(fact['label'],[fact['label']]))
            if not isinstance(current['aliases'],list) or any(not isinstance(a,str) for a in current['aliases']):raise ValueError('invalid aliases')
            current['sensitive']=bool(current.get('sensitive') or sensitive_label(current['label']));current['manual']=bool(current.get('manual') or manual_label(current['label']) or current.get('companyScope') or current.get('_专属') or str(current['label']).startswith('_专属'))
            current.setdefault('precision',precision(current['value']));validate_date_policy(current);result['facts'].append(current)
        result['facts']=sort_facts(result['facts'])
        return result
    rules=data.get('_使用规则',[])
    if not isinstance(rules,list) or any(not isinstance(rule,str) for rule in rules):raise ValueError('invalid profile rules')
    result['rules']=copy.deepcopy(rules)
    def add(module,record_id,record_label,hint,field,value,manual=False):
        if field.startswith('_'):return
        if value is None or value=='':return
        if not isinstance(value,(str,int,float)) or isinstance(value,bool):return
        result['facts'].append({'key':module+'.'+record_id+'.'+field,'label':field,'value':value,'module':module,'recordId':record_id,'recordLabel':record_label,'recordHint':hint,'aliases':copy.deepcopy(ALIASES.get(field,[field])),'sensitive':sensitive_label(field),'manual':bool(manual or manual_label(field)),'precision':precision(value)})
    personal=data.get('基本信息',{})
    if not isinstance(personal,dict):raise ValueError('invalid personal facts')
    for field,value in personal.items():
        if field.startswith('_'):continue
        add('personal','personal','基本信息','个人',field,value,manual_label(field) or field=='家庭地址')
    education=data.get('教育经历',[])
    if not isinstance(education,list) or any(not isinstance(row,dict) for row in education):raise ValueError('invalid education facts')
    levels={'博士':6,'博士研究生':6,'硕士':5,'硕士研究生':5,'研究生':4,'本科':3,'大学本科':3,'专科':2,'大专':2,'高中':1}
    ranked=[]
    for index,row in enumerate(education):
        record='education-'+str(index); hint=' '.join(str(row.get(k,'')) for k in ('学历','学位','学校'))
        if row.get('学历') in levels:ranked.append((levels[row['学历']],index,row))
        for field,value in row.items():
            if field=='主修课程及成绩':result['supplements'].append({'label':field,'module':'education','recordId':record,'sourceName':source_name,'sourceKey':'教育经历/'+str(index)+'/'+field});continue
            add('education',record,str(row.get('学历','教育经历')),hint,field,value)
    if ranked:
        highest=max(rank for rank,_,_ in ranked); matches=[row for rank,_,row in ranked if rank==highest]
        if len(matches)==1:
            row=matches[0]
            for label,field in [('最高学历','学历'),('最高学位','学位')]:add('personal','highest','最高教育','最高教育',label,row.get(field))
        else:result['warnings'].append('最高教育经历有多个同等级记录，需要人工确认。')
    for field,value in data.get('语言能力',{}).items():
        if not field.startswith('_') and field!='备注':add('language','language','语言能力','语言',field,value)
    if profile_id!='general':
        records=list(data.get('实习经历_央国企口径',[]))
        if profile_id=='ai-product':records+=list(data.get('实习经历_仅AI产品口径_央国企不用',[]))
        for index,row in enumerate(records):
            if not isinstance(row,dict):raise ValueError('invalid internship facts')
            hint=str(row.get('单位',''));record='internship-'+str(index)
            for field,value in row.items():add('internship',record,hint,hint,field,value)
        for index,row in enumerate(data.get('项目经历',[])):
            if not isinstance(row,dict):raise ValueError('invalid project facts')
            for field,value in row.items():add('project','project-'+str(index),str(row.get('名称','项目')),str(row.get('名称','')),field,value,field=='时间')
    # Policies are explicit source metadata, never inferred from a stale end date.
    for fact in result['facts']:
        if ongoing_end(fact):
            fact['ongoing']=True
            index=int(fact['recordId'].rsplit('-',1)[1])
            rows=data.get('项目经历',[]) if fact['module']=='project' else records
            fallback=rows[index].get('_结束日期兜底')
            if fallback:fact['dateFallback']=fallback
            validate_date_policy(fact)
    for field in ('社会及校园活动','奖惩情况_200字版','奖惩情况_带日期版','研究成果_297字版','研究成果_完整版见','专利','IT技能'):
        if field in data:result['supplements'].append({'label':field,'module':'supplement','sourceName':source_name,'sourceKey':field})
    if '家庭成员' in data:result['warnings'].append('家庭成员信息需要人工填写，不自动匹配。')
    if '报名信息_中行' in data:result['warnings'].append('公司专属报名资料不泛化到其他网站；相关字段需要人工确认。')
    if '证件照' in data:result['warnings'].append('附件和照片由用户手动上传。')
    result['facts']=sort_facts(result['facts'])
    return result


def profile_summary(profile):
    counts={}
    for fact in profile.get('facts',[]):counts[fact['module']]=counts.get(fact['module'],0)+1
    return {'sourceVersion':profile['sourceVersion'],'sourceName':profile['sourceName'],'sourceSavedAt':profile.get('sourceSavedAt'),'profileId':profile['profileId'],'profiles':copy.deepcopy(profile['profiles']),'counts':counts,'fieldNames':sorted({f['label'] for f in profile['facts']}),'rules':copy.deepcopy(profile['rules']),'warnings':copy.deepcopy(profile['warnings']),'supplements':[{'label':s.get('label'),'module':s.get('module')} for s in profile.get('supplements',[])]}


def export_profile_pack(workspace):
    """Explicit private export. Never use this result in public source or fixtures."""
    packs=[load_profile(workspace, p['id']) for p in PROFILES]
    if packs[0]['sourceVersion']=='missing':raise ValueError('没有已确认的填报资料可导出')
    if len({p['sourceVersion'] for p in packs})!=1:raise ValueError('资料在导出期间发生变化，请重试')
    facts={}
    for profile in packs:
        for original in profile['facts']:
            fact=copy.deepcopy(original);fact.pop('profiles',None)
            if fact['key'] in facts:
                previous={k:v for k,v in facts[fact['key']].items() if k!='profiles'}
                if previous!=fact:raise ValueError('同一资料键在不同口径中内容不一致，需要明确分开')
                facts[fact['key']]['profiles'].append(profile['profileId'])
            else:
                fact['profiles']=[profile['profileId']];facts[fact['key']]=fact
    return {'schemaVersion':1,'kind':'toudi-filling-profile','name':'个人填报资料',
            'savedAt':packs[0].get('sourceSavedAt'),'sourceName':packs[0]['sourceName'],
            'sourceVersion':packs[0]['sourceVersion'],'profiles':copy.deepcopy(PROFILES),
            'facts':sort_facts(list(facts.values())),'rules':packs[0]['rules'],
            'warnings':list(dict.fromkeys(w for p in packs for w in p['warnings'])),
            'supplements':[{'label':s.get('label'),'module':s.get('module')} for s in packs[0]['supplements']]}


def mask(value,label):
    text=str(value)
    if '邮箱' in label or 'email' in label.casefold():return (text[:1]+'***@***') if '@' in text else '***'
    if any(term in label for term in ('手机','电话')) and len(text)>7:return text[:3]+'****'+text[-4:]
    if '姓名' in label or 'name' in label.casefold():return text[:1]+'***'
    return '***'


def module_hint(field):
    text=str(field.get('module','')).casefold()
    for alias,module in MODULES.items():
        if alias in text:return module
    return None


def semantic_label(field):
    label=str(field.get('label',''))
    # Explicit education qualifiers are hard record constraints, never DOM ordering.
    qualifiers=re.findall(r'博士研究生|硕士研究生|博士|硕士|本科|专科',label)
    if qualifiers:
        label=re.sub(r'博士研究生|硕士研究生|博士|硕士|本科|专科','',label)
    return normalized(label),qualifiers


def record_matches(fact,field):
    _,qualifiers=semantic_label(field)
    context=' '.join(str(field.get(k,'')) for k in ('groupLabel','recordHint'))
    qualifiers+=re.findall(r'博士研究生|硕士研究生|博士|硕士|本科|专科',context)
    if qualifiers and fact['module']=='education':
        hint=normalized(str(fact.get('recordLabel',''))+' '+str(fact.get('recordHint','')))
        if not all(normalized(q.replace('研究生','')) in hint for q in qualifiers): return False
    return True


def label_matches(fact,field):
    label,_=semantic_label(field)
    aliases=[fact['label'],*fact.get('aliases',[])]
    grading_label=fact['label']=='GPA' and any(label.startswith(normalized(a)) for a in ALIASES['GPA']) and bool(re.search(r'4[.．]0|5[.．]0|满分|scale',str(field.get('label','')),re.I))
    return label in {normalized(a) for a in aliases} or grading_label


def matching_facts(profile,field):
    module=module_hint(field); candidates=[]
    for fact in profile['facts']:
        if module and fact['module']!=module and not (module=='education' and fact['label'].startswith('最高')):continue
        if not label_matches(fact,field) or not record_matches(fact,field):continue
        candidates.append(fact)
    hint=normalized(' '.join(str(field.get(k,'')) for k in ('groupLabel','recordHint')))
    if hint and len({f['recordId'] for f in candidates})>1:
        selected=[]
        for fact in candidates:
            tokens=[str(fact.get('recordLabel','')),str(fact.get('recordHint',''))]
            tokens+=re.findall(r'博士研究生|硕士研究生|博士|硕士|本科|专科',str(fact.get('recordHint','')))
            if any(normalized(token) and (normalized(token) in hint or hint in normalized(token)) for token in tokens):selected.append(fact)
        if selected:candidates=selected
    return candidates


def mapping_matches(profile,field,fact):
    module=module_hint(field)
    if module and fact['module']!=module and not (module=='education' and fact['label'].startswith('最高')):return False
    if not record_matches(fact,field):return False
    # Known meanings stay binding even for a model-selected valid key. Truly unknown
    # labels can use an explicit mapping while all value/manual gates still apply.
    known=any(label_matches(other,field) for other in profile['facts'])
    known=known or semantic_label(field)[0] in {normalized(alias) for aliases in ALIASES.values() for alias in aliases}
    if known and not label_matches(fact,field):return False
    eligible=matching_facts(profile,field)
    if eligible and fact['key'] not in {candidate['key'] for candidate in eligible}:return False
    return True


def option_equivalent(value,label):
    text=normalized(value)
    if label in ('学历','最高学历'):
        return {'硕士研究生':'硕士','博士研究生':'博士','大学本科':'本科','大学专科':'专科','大专':'专科'}.get(text,text)
    if label in ('学位','最高学位'):
        return {'硕士学位':'硕士','学士学位':'学士','博士学位':'博士','工学学士':'学士','理学学士':'学士','文学学士':'学士','工学硕士':'硕士','理学硕士':'硕士','文学硕士':'硕士'}.get(text,text)
    return text


def plan_fields(profile,scan,mappings=None,today=None):
    if not isinstance(scan,dict) or not isinstance(scan.get('fields'),list):raise ValueError('invalid field scan')
    facts={f['key']:f for f in profile['facts']}; mappings=mappings or {}
    ids=[f.get('id') for f in scan['fields'] if isinstance(f,dict)]
    if len(ids)!=len(scan['fields']) or any(not isinstance(i,str) or not i for i in ids) or len(ids)!=len(set(ids)):raise ValueError('field IDs must be unique strings')
    if not isinstance(mappings,dict) or any(not isinstance(field,str) or not isinstance(key,str) or field not in ids or key not in facts for field,key in mappings.items()):raise ValueError('mapping must use scanned IDs and current profile fact keys')
    today=today or datetime.date.today()
    rows=[];actions=[];warnings=list(profile.get('warnings',[]))+list(scan.get('warnings',[]))
    for field in scan['fields']:
        row={'fieldId':field['id'],'label':str(field.get('label','')),'module':field.get('module',''),'groupLabel':field.get('groupLabel',''),'status':'missing','reason':'资料中没有可确认的对应字段。','expectedValue':field.get('value','')}
        kind=field.get('type','text'); label=row['label']
        if field.get('unsupported') or kind not in ('text','textarea','email','tel','date','month','number','select','radio','checkbox','combobox','file'):
            row.update(status='unsupported',reason='控件尚不支持可靠填入。')
        elif kind in ('file','checkbox') or (kind=='combobox' and not field.get('options')) or manual_label(label):row.update(status='manual',reason='上传、协议、家庭/联系人或复杂控件需要人工操作。')
        else:
            candidates=[facts[mappings[field['id']]]] if field['id'] in mappings else matching_facts(profile,field)
            if len(candidates)>1:row.update(status='ambiguous',reason='有多个资料记录，分组或记录提示无法唯一确认，请选择事实。')
            elif len(candidates)==1:
                fact=candidates[0]; value=str(fact['value']);value_precision=fact.get('precision');row.update(factKey=fact['key'],value=value,displayValue=mask(value,label) if fact['sensitive'] else value,sensitive=fact['sensitive'])
                date_format=field.get('dateFormat')
                if date_format and date_format not in ('YYYY-MM-DD','YYYY/MM/DD','YYYY.MM.DD','YYYY-MM','YYYY/MM','YYYY.MM'):raise ValueError('invalid date format')
                date_kind=kind if kind in ('date','month') else ('date' if 'DD' in date_format else 'month') if date_format else ''
                reason=None
                if field['id'] in mappings and not mapping_matches(profile,field,fact):reason='映射与字段的明确含义、模块或记录不符，不能跨记录填入。'
                if not reason and fact.get('manual'):reason='此项资料必须人工确认，不使用自动填入。'
                if not reason and fact['label']=='GPA' and re.search(r'(?:4[.．]0|5[.．]0|四分|五分)',label):
                    demanded='4.0' if re.search(r'4[.．]0|四分',label) else '5.0'
                    if str(fact.get('gpaScale',''))!=demanded:reason='GPA 未注明相同满分口径，不能匹配强制满分字段。'
                constraints=field.get('constraints',{})
                if not isinstance(constraints,dict):constraints={}
                if not reason and fact['label']=='GPA' and kind=='number':
                    try:
                        scale=Decimal(str(constraints.get('max','')))
                        if scale in (Decimal('4'),Decimal('5')) and str(fact.get('gpaScale','')) not in (str(scale),str(scale.quantize(Decimal('0.1')))):
                            reason='数值字段明确限定 GPA 满分口径，资料未注明相同口径，需人工确认。'
                    except InvalidOperation:pass
                if not reason and fact.get('ongoing') and ongoing_end(fact) and date_kind:
                    checkbox=any(f.get('type')=='checkbox' and f.get('groupId') and f.get('groupId')==field.get('groupId') and normalized(f.get('label','')) in ('至今','present','ongoing','仍在进行') for f in scan['fields'])
                    if checkbox:reason='网站提供「至今」勾选，请先手动选择，再重新识别。'
                    elif fact.get('dateFallback')!='today':reason='经历仍在进行，日期控件不支持「至今」；尚未授权具体日期兜底。'
                    else:value=today.isoformat();value_precision='day';row.update(dateFallbackUsed=True,resolvedOn=value)
                if not reason and re.search(r'待确认|冲突|不确定',value):reason='资料包含待确认的时间或事实表述，需要人工确认。'
                if not reason and '至今' in value and not fact.get('ongoing'):reason='资料包含至今的时间表述，需要人工确认。'
                if not reason and date_kind=='date' and value_precision!='day':reason='资料没有精确到日，不能自行补为每月一号。'
                if not reason and date_kind=='month' and value_precision not in ('day','month'):reason='资料年月精度不明确。'
                if not reason and kind=='number' and not re.fullmatch(r'-?\d+(?:\.\d+)?',value):reason='资料不是该数值控件所需的纯数值。'
                if not reason and kind=='number':
                    numeric=Decimal(value)
                    for bound,comparison in [('min',lambda value,limit:value<limit),('max',lambda value,limit:value>limit)]:
                        raw_limit=constraints.get(bound)
                        if raw_limit in (None,''):continue
                        try:
                            limit=Decimal(str(raw_limit))
                            if limit.is_finite() and comparison(numeric,limit):
                                reason='数值超出字段明确范围，需人工核对；未截断或修正资料。';break
                        except InvalidOperation:continue
                if not reason and date_kind:
                    numbers=re.findall(r'\d+',value)
                    try:
                        datetime.date(int(numbers[0]),int(numbers[1]),int(numbers[2]) if date_kind=='date' else 1)
                        value='-'.join([numbers[0],numbers[1].zfill(2)]+([numbers[2].zfill(2)] if date_kind=='date' else []))
                        if (constraints.get('min') and value<constraints['min']) or (constraints.get('max') and value>constraints['max']):reason='日期超出字段明确范围，需人工核对；未截断或修改日期。'
                        if date_format:value=value.replace('-','/' if '/' in date_format else '.' if '.' in date_format else '-')
                        row['value']=value;row['displayValue']=value
                    except (ValueError,IndexError):reason='来源日期不符合日历规则，需要人工核对。'
                cap=field.get('maxLength')
                if not reason and isinstance(cap,int) and cap>=0 and len(value.encode('utf-16-le'))//2>cap:reason='内容超过字段长度限制，需人工整理；未截断原文。'
                options=field.get('options',[])
                if not reason and kind in ('select','radio','combobox'):
                    matches=[o for o in options if option_equivalent(o.get('text',''),fact['label'])==option_equivalent(value,fact['label']) or str(o.get('value',''))==value or (fact.get('ongoing') and ongoing_end(fact) and normalized(o.get('text','')) in ('至今','present','ongoing','current'))]
                    if len(matches)!=1:reason='没有唯一等价选项，需要人工选择。'
                    else:row['optionValue']=matches[0]['value']
                if reason:row.update(status='manual',reason=reason)
                else:
                    existing=str(field.get('value') or ''); proposed=str(row.get('optionValue',value))
                    note=' 经历仍在进行；此日期为填写当天的表单占位，不是实际结束日期。' if row.get('dateFallbackUsed') else ''
                    if existing and (existing==proposed or existing==value):row.update(status='already',reason='已有值与资料相同。'+note)
                    elif existing:row.update(status='conflict',reason='已有值与资料不同，保留现值，需明确选择覆盖。'+note)
                    else:
                        row.update(status='ready',reason='事实、记录及控件约束已确认。'+note)
                        actions.append({k:row[k] for k in ('fieldId','value','expectedValue','optionValue') if k in row})
        rows.append(row)
    counts={}
    for row in rows:counts[row['status']]=counts.get(row['status'],0)+1
    return {'protocol':1,'sourceVersion':profile['sourceVersion'],'profileId':profile['profileId'],'origin':scan.get('origin',''),'path':scan.get('path',''),'fingerprint':scan.get('fingerprint',''),'rows':rows,'actions':actions,'summary':{'fields':len(rows),'ready':counts.get('ready',0)},'statusCounts':counts,'warnings':warnings}

profileSummary=profile_summary
