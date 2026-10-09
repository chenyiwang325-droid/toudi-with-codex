"""Conservative local filling facts and plans; never reads web-supplied paths or writes forms."""
from decimal import Decimal, InvalidOperation
import datetime
import copy
import hashlib
import json
import re
import unicodedata
from pathlib import Path

DEFAULT_PROFILES=[{'id':'general','label':'默认资料'}]
ALIASES={
 '姓名':['姓名','name','full name','candidate name'], '性别':['性别','gender','sex'],
 '出生日期':['出生日期','生日','date of birth','birth date','birthday'],
 '证件类型':['证件类型','证件类别','identity document type'], '证件号码':['证件号码','身份证号','身份证号码','id number','identity number'],
 '国籍':['国籍','nationality'], '民族':['民族','ethnicity'], '政治面貌':['政治面貌','political status'],
 '身高cm':['身高cm','身高','height','height cm'], '体重kg':['体重kg','体重','weight','weight kg'],
 '婚姻状况':['婚姻状况','婚否','婚姻状态','marital status'], '当前户籍所在地':['当前户籍所在地','户籍所在地','户口所在地','户籍','household registration'],
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
 '单位':['单位','单位名称','公司','公司名称','实习单位','雇主','company','company name','employer','employer name'], '部门':['部门','department'],
 '职务':['职务','职位','岗位','position','job title'], '工作地点':['工作地点','实习地点','work location'],
 '开始':['开始','开始时间','开始日期','实习开始时间','start date','from'],
 '结束':['结束','结束时间','结束日期','实习结束时间','end date','to'],
 '职责':['职责','工作职责','工作内容','实习内容','responsibilities','description'],
 '职责_199字版':['职责','工作职责','工作内容','实习内容','responsibilities','职责199字版'],
 '职责_229字完整版':['职责','工作职责','工作内容','实习内容','responsibilities','职责229字完整版'],
 '名称':['项目名称','project name'], '角色':['项目角色','role'], '时间':['项目时间','project dates'],
 '简述':['项目描述','项目简述','project description'], '最高学历':['最高学历','highest education','highest qualification'],
 '最高学位':['最高学位','highest degree'],
 '工作类型':['工作类型','雇佣类型','employment type'], '工作成果':['工作成果','工作业绩','achievements'],
 '本人职责':['本人职责','项目职责','项目工作内容','project responsibilities'], '项目成果':['项目成果','项目业绩','project achievements'],
 '项目链接':['项目链接','作品链接','project url'], '主修课程':['主修课程','主要课程','courses'],
 'IT技能':['IT技能','计算机技能','技能特长','skills'], '获奖情况':['获奖情况','奖惩情况','荣誉奖励','awards'],
 '资格证书':['资格证书','职业资格证书','专业资格证书','职业资格','执业资格','职业证书','professional certifications','professional certification','professional qualification','vocational qualification'],
 '个人评价':['个人评价','自我评价','个人简介','summary'],
 '语言／证书名称':['语言／证书名称','语言','外语语种','证书名称','language','certificate name'],
 '熟练程度':['熟练程度','语言水平','外语水平','proficiency'], '考试成绩':['考试成绩','考试分数','证书成绩','score'],
 '取得日期':['取得日期','获证日期','考试日期','issue date'],
}
ALIASES.update({'组织名称': ['组织名称', '组织', '社团名称', '学生组织', '所在组织', 'organization', 'organization name'], '职务': ['职务', '职位', '岗位', '担任职务', 'position', 'job title'], '职责描述': ['职责描述', '工作职责', '职责', '工作内容', '任职描述', '任职经历', '经历描述', 'responsibilities', 'description'], '成果': ['成果', '主要成果', '工作成果', 'achievement', 'achievements'], '奖项名称': ['奖项名称', '获奖名称', '奖励名称', '奖项', '荣誉名称', 'award name', 'award title'], '获奖级别': ['获奖级别', '获奖等级', 'award level', 'award scope'], '奖项等级': ['奖项等级', '奖励等级', 'award rank', 'prize rank'], '奖项类别': ['奖项类别', '奖励类别', 'award category'], '获奖日期': ['获奖日期', '获奖时间', '奖励日期', '奖励时间', 'award date'], '颁奖单位': ['颁奖单位', '授奖单位', '颁发机构', '颁奖机构', 'awarding organization'], '获奖说明': ['获奖说明', '获奖描述', '获奖情况', '奖励说明', 'award description'], '论文名称': ['论文名称', '论文题目', '论文标题', '成果名称', 'publication title', 'paper title'], '发表刊物': ['发表刊物', '期刊名称', '发表期刊', '刊物名称', '发表机构', 'journal', 'publication venue'], '发表日期': ['发表日期', '发表时间', 'publication date'], '作者排序': ['作者排序', '作者顺序', '本人排名', '作者位次', 'author order'], '论文摘要': ['论文摘要', '论文描述', '摘要', '研究内容', 'abstract'], '论文链接': ['论文链接', '论文网址', 'DOI', 'doi', 'publication url']})

ALIASES.update({'作者名单': ['作者名单', '作者姓名', '作者', 'authors', 'author names'], '发表状态': ['发表状态', '出版状态', 'publication status'], '收录类别': ['收录类别', '收录情况', '检索类型', '检索类别', '论文级别', 'indexing'], '在线发表日期': ['在线发表日期', '在线发布日期', 'online publication date'], '正式出版日期': ['正式出版日期', '见刊日期', 'issue publication date'], '卷期页码': ['卷期页码', '卷期', '卷号期号页码', 'volume issue pages']})
ALIASES.update({'学生干部级别': ['学生干部级别', '学生干部等级', '干部级别', '任职级别', '职务级别', '干部层级']})

for _field,_names in {'学院': ['学院', '院系', '学院名称', '院系名称', 'school department'], '主修课程': ['主修课程', '主要课程', '专业课程', '课程'], 'GPA': ['GPA', '平均绩点', '绩点', '成绩（GPA）', '成绩(GPA)'], 'IT技能': ['IT技能', '特殊技能', '专业技能', '计算机技能'], '优势与不足': ['优势与不足', '评价自身的优势和不足', '优点与缺点'], '兴趣爱好': ['兴趣爱好', '个人爱好']}.items():
    ALIASES[_field]=list(dict.fromkeys(ALIASES.get(_field,[])+_names))
MODULE_ALIASES={'campus-role': {'职务类别': ['在校职务类别', '校园职务类别', '任职类别'], '职务': ['在校职务名称', '校园职务名称'], '职责描述': ['在校职务描述', '校园职务描述']}, 'project': {'名称': ['在校科研及实践项目', '实践项目名称', '实践名称'], '角色': ['担任角色'], '简述': ['实践描述'], '项目描述': ['实践描述']}, 'publications': {'论文名称': ['名称'], '发表日期': ['发布时间']}}
RECORD_IDENTITY_FIELDS={'campus-role': ['职务', '组织名称'], 'project': ['名称', '项目名称'], 'awards': ['奖项名称'], 'publications': ['论文名称'], 'internship': ['单位']}

ALIASES.update({
 '紧急联系人姓名':['紧急联系人姓名','紧急联系人','emergency contact name'],
 '紧急联系人手机':['紧急联系人手机','紧急联系人电话','紧急联系人联系电话','紧急联系电话','emergency contact phone','emergency phone'],
 '紧急联系人关系':['紧急联系人关系','与紧急联系人关系','relationship to emergency contact'],
 '紧急联系人单位':['紧急联系人单位','紧急联系人工作单位','emergency contact employer'],
 '紧急联系人职务':['紧急联系人职务','紧急联系人职位','emergency contact title'],
 '与本人关系':['与本人关系','与申请人关系','亲属关系','关系','relationship'],
 '工作单位':['工作单位','单位','单位名称','公司名称','company','employer'],
 '工作所在地':['工作所在地','单位所在地','工作地点','工作城市','work location'],
})
ALIASES['手机']+=['联系电话','联系手机','电话','联系方式','contact phone']
MODULE_ALIASES['family']={'姓名':['成员姓名','亲属姓名'], '手机':['联系电话','联系电话号码','手机号码','电话'], '工作单位':['所在单位','单位名称','单位'], '职务':['职位','岗位','职务或职业','职业']}
RECORD_IDENTITY_FIELDS['family']=['姓名','与本人关系']

ALIASES.update({'语种':['语种','语言类型','外语语种','language type'], '证书类型':['证书类型','考试类型','语言证书类型','certificate type'], '证明人':['证明人','证明人姓名','推荐人姓名','referee name','reference name'], '证明人电话':['证明人电话','证明人手机','证明人联系方式','推荐人电话','referee phone','reference phone'], '证明人单位及职务':['证明人单位及职务','证明人单位及职位','referee employer and title']})
ALIASES['考试成绩']+=['语言成绩','外语成绩']
MODULE_ALIASES['language']={'语种':['语言','外语语种','语言类型'], '证书类型':['证书名称','考试名称'], '考试成绩':['语言成绩','成绩']}
RECORD_IDENTITY_FIELDS['language']=['语言／证书名称','证书类型']
ALIASES['取得日期']+=['获得时间']
ALIASES['发表刊物']+=['期刊名称/专利号申请号']

MANUAL_TERMS=('验证码','verification code','captcha','协议','同意','承诺','agreement','consent','签名','signature','上传','upload','照片','photo',)
SENSITIVE_TERMS=('姓名','name','手机','电话','phone','邮箱','email','证件','身份证','id number','家庭地址','home address','紧急联系人','emergency contact','证明人','referee','reference contact')
MODULES={'campus-role': 'campus-role', '在校任职': 'campus-role', '校园任职': 'campus-role', '在校经历': 'campus-role', '校园经历': 'campus-role', '在校职务': 'campus-role', '学生工作': 'campus-role', '学生干部': 'campus-role', 'school posts': 'campus-role', 'school_posts': 'campus-role', 'campus posts': 'campus-role', 'campus_posts': 'campus-role', 'awards': 'awards', '获奖': 'awards', '奖励': 'awards', '荣誉': 'awards', 'publications': 'publications', '论文': 'publications', '发表': 'publications', '专著': 'publications'}
MODULES.update({'family':'family','家庭':'family','亲属':'family','教育':'education','education':'education','学历':'education','实习':'internship','工作':'internship','internship':'internship','employment':'internship','项目':'project','project':'project','个人':'personal','personal':'personal','基本':'personal','语言':'language','language':'language','work':'internship','projects':'project'})


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
    return fact.get('module') in ('project','internship','campus-role') and fact.get('label') in ('结束','结束日期') and normalized(fact.get('value','')) in ('至今','present','ongoing','current')


def validate_date_policy(fact):
    if 'ongoing' in fact and not isinstance(fact['ongoing'],bool):raise ValueError('ongoing must be boolean')
    if fact.get('ongoing') and not ongoing_end(fact):raise ValueError('ongoing is only valid for a present project/work/campus end date')
    if fact.get('dateFallback') not in (None,'','today'):raise ValueError('unknown ongoing date fallback')
    if fact.get('dateFallback') and not (fact.get('ongoing') and ongoing_end(fact)):raise ValueError('date fallback requires an ongoing end date')


def sort_facts(facts):
    """Order complete records by start date without changing stable fact/record IDs."""
    groups={}; modules={'personal':0,'education':1,'internship':2,'project':3,'language':4,'campus-role':5,'awards':6,'publications':7,'family':8}
    for fact in facts:groups.setdefault((fact['module'],fact.get('recordId','')),[]).append(fact)
    def start_date(group):
        for label in ('开始日期','开始','时间','获奖日期','发表日期','取得日期'):
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


def load_profile(workspace,profile_id=None):
    path,source_name=source_file(workspace)
    if path is None:return {'sourceVersion':'missing','sourceName':None,'profileId':profile_id or 'general','profiles':copy.deepcopy(DEFAULT_PROFILES),'facts':[],'rules':[],'warnings':['尚未提供填报资料，未创建示例或推测个人信息。'],'supplements':[]}
    raw=path.read_bytes(); data=json.loads(raw)
    if not isinstance(data,dict):raise ValueError('filling profile root must be an object')
    if source_name=='填报资料/资料.json':
        if data.get('schemaVersion')!=1 or not isinstance(data.get('facts'),list):raise ValueError('formal filling profile requires schemaVersion 1 and facts')
        definitions=copy.deepcopy(data.get('profiles'))
        if definitions is None:
            # Old formal packs without metadata retain their field memberships.
            legacy_ids=['general']
            for fact in data.get('facts',[]):
                membership=fact.get('profiles',[]) if isinstance(fact,dict) else []
                if not isinstance(membership,list):raise ValueError('invalid fact profiles')
                for key in membership:
                    if key not in legacy_ids:legacy_ids.append(key)
            definitions=[{'id':key,'label':'默认资料' if key=='general' else '导入资料 '+str(index)} for index,key in enumerate(legacy_ids)]
    else:
        definitions=copy.deepcopy(DEFAULT_PROFILES)
        # Compatibility for explicit versions in old user files, not product defaults.
        if '实习经历_央国企口径' in data or '实习经历_仅AI产品口径_央国企不用' in data:
            definitions.extend([{'id':'state','label':'实习经历_央国企口径'.split('_',1)[1]}, {'id':'ai-product','label':'实习经历_仅AI产品口径_央国企不用'.split('_')[1].removeprefix('仅')}])
    if not isinstance(definitions,list) or not 1<=len(definitions)<=20:raise ValueError('invalid profile definitions')
    ids=set()
    for item in definitions:
        if not isinstance(item,dict) or not isinstance(item.get('id'),str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}',item['id']) or item['id'] in ids or not isinstance(item.get('label'),str) or not item['label'].strip() or len(item['label'])>80:raise ValueError('invalid profile definition')
        ids.add(item['id'])
    if profile_id is None or (profile_id=='general' and profile_id not in ids):profile_id=definitions[0]['id']
    if profile_id not in ids:raise ValueError('unknown profile id')
    result={'sourceVersion':hashlib.sha256(raw).hexdigest(),'sourceName':source_name,'profileId':profile_id,'profiles':definitions,'facts':[],'rules':[],'warnings':[],'supplements':[]}
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
            if fact['module'] not in {'education','internship','project','personal','language','campus-role','awards','publications','family','language'}:raise ValueError('fact module must be education/internship/project/personal/language')
            if fact['key'] in seen:raise ValueError('duplicate fact key')
            seen.add(fact['key'])
            profiles=fact.get('profiles',[p['id'] for p in definitions])
            if not isinstance(profiles,list) or not profiles or any(p not in ids for p in profiles):raise ValueError('invalid fact profiles')
            if profile_id not in profiles:continue
            current=copy.deepcopy(fact); current.setdefault('recordId','');current.setdefault('recordLabel','');current.setdefault('recordHint','');current.setdefault('aliases',ALIASES.get(fact['label'],[fact['label']]))
            if not isinstance(current['aliases'],list) or any(not isinstance(a,str) for a in current['aliases']):raise ValueError('invalid aliases')
            current['sensitive']=bool(current.get('sensitive') or current['module']=='family' or sensitive_label(current['label']));current['manual']=bool(current.get('manual') or manual_label(current['label']) or current.get('companyScope') or current.get('_专属') or str(current['label']).startswith('_专属'))
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
        add('personal','personal','基本信息','个人',field,value,manual_label(field))
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
    records=[]
    split_versions=any(p['id']=='state' for p in definitions)
    if not split_versions or profile_id!='general':
        if split_versions:
            records=list(data.get('实习经历_央国企口径',[]))
        else:
            internships,employment=data.get('实习经历',[]),data.get('工作经历',[])
            if not isinstance(internships,list) or not isinstance(employment,list):raise ValueError('invalid work records')
            records=internships+employment
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
    family=data.get('家庭成员',{})
    family_rows=family.items() if isinstance(family,dict) else enumerate(family) if isinstance(family,list) else []
    for relation,row in family_rows:
        if not isinstance(row,dict):continue
        rid='family-'+str(relation);label=str(row.get('与本人关系') or relation)
        if isinstance(relation,str) and not row.get('与本人关系'):add('family',rid,label,label,'与本人关系',relation)
        for field,value in row.items():add('family',rid,label,label,field,value)
    for fact in result['facts']:
        if fact['module']=='family':fact['sensitive']=True
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
    first=load_profile(workspace)
    packs=[first if p['id']==first['profileId'] else load_profile(workspace,p['id']) for p in first['profiles']]
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
            'sourceVersion':packs[0]['sourceVersion'],'profiles':copy.deepcopy(first['profiles']),
            'facts':sort_facts(list(facts.values())),'rules':packs[0]['rules'],
            'warnings':list(dict.fromkeys(w for p in packs for w in p['warnings'])),
            'supplements':[{'label':s.get('label'),'module':s.get('module')} for s in packs[0]['supplements']]}


def mask(value,label):
    text=str(value)
    if '邮箱' in label or 'email' in label.casefold():return (text[:1]+'***@***') if '@' in text else '***'
    if any(term in label for term in ('手机','电话')) and len(text)>7:return text[:3]+'****'+text[-4:]
    if '姓名' in label or 'name' in label.casefold():return text[:1]+'***'
    return '***'


def manual_field(field):
    return any(manual_label(field.get(key,'')) for key in ('label','module','groupLabel','recordHint'))


def module_hint(field):
    text=str(field.get('module','')).casefold()
    context=' '.join(str(field.get(key,'')) for key in ('module','groupLabel'))
    if manual_field(field):return 'manual'
    if re.search(r'紧急联系人|emergency contact',context+' '+str(field.get('label','')),re.I):return 'personal'
    if re.search(r'家庭成员|家庭情况|家庭信息|家庭关系|亲属|family|父亲|母亲',context,re.I) or re.match(r'^(父亲|母亲)',str(field.get('label',''))):return 'family'
    if re.search(r'campus-role|在校任职|校园任职|在校经历|校园经历|在校职务|学生工作|学生干部|school[ _-]*posts|campus[ _-]*posts',context,re.I):return 'campus-role'
    if re.search(r'获奖|奖励|荣誉|awards',context,re.I):return 'awards'
    if re.search(r'论文|发表|出版|专著|publications',context,re.I):return 'publications'
    if re.fullmatch(r'毕业院校|毕业学校|最近毕业专业',str(field.get('label',''))):return 'education'
    for alias,module in MODULES.items():
        if alias in text:return module
    return 'unsupported-module' if text.strip() else None


def semantic_label(field):
    label=str(field.get('semanticLabel') or field.get('label',''))
    if module_hint(field)=='family':label=re.sub(r'^(父亲|母亲|家庭成员|亲属)','',label) or label
    if re.search(r'紧急联系人|emergency contact',' '.join(str(field.get(k,'')) for k in ('groupLabel','module')),re.I) and not re.search(r'紧急|emergency',label,re.I):
        if normalized(label) in {normalized(x) for x in ALIASES['姓名']}:label='紧急联系人姓名'
        elif normalized(label) in {normalized(x) for x in ALIASES['手机']}:label='紧急联系人手机'
        elif normalized(label) in {normalized(x) for x in ALIASES['与本人关系']}:label='紧急联系人关系'
        elif normalized(label) in {normalized(x) for x in ALIASES['工作单位']}:label='紧急联系人单位'
        elif normalized(label) in {normalized(x) for x in ALIASES['职务']}:label='紧急联系人职务'
    # Explicit education qualifiers are hard record constraints, never DOM ordering.
    qualifiers=re.findall(r'博士研究生|硕士研究生|博士|硕士|本科|专科|高中',label)
    if qualifiers:
        label=re.sub(r'博士研究生|硕士研究生|博士|硕士|本科|专科|高中','',label)
    return normalized(label),qualifiers


def record_matches(fact,field):
    if fact['module']=='family':
        relation=re.search(r'父亲|母亲',' '.join(str(field.get(k,'')) for k in ('label','groupLabel')))
        if relation and relation[0] not in str(fact.get('recordLabel',''))+' '+str(fact.get('recordHint','')):return False
    _,qualifiers=semantic_label(field)
    context=' '.join(str(field.get(k,'')) for k in ('groupLabel','recordHint'))
    qualifiers+=re.findall(r'博士研究生|硕士研究生|博士|硕士|本科|专科|高中',context)
    if qualifiers and fact['module']=='education':
        hint=normalized(str(fact.get('recordLabel',''))+' '+str(fact.get('recordHint','')))
        if not all(normalized(q.replace('研究生','')) in hint for q in qualifiers): return False
    return True


def label_matches(fact,field):
    label,_=semantic_label(field)
    if module_hint(field)=='language':
        for canonical in ('语种','证书类型','考试成绩'):
            if label in {normalized(x) for x in [canonical,*MODULE_ALIASES['language'].get(canonical,[])]}:return normalized(fact['label'])==normalized(canonical)
    if module_hint(field)=='awards':
        scope={normalized(v) for v in ['获奖级别','获奖等级','award level','award scope']};rank={normalized(v) for v in ['奖项等级','奖励等级','award rank','prize rank']};fl=normalized(fact['label'])
        if (fl in scope and label in rank) or (fl in rank and label in scope):return False
    scoped=MODULE_ALIASES.get(module_hint(field),{})
    for canonical,synonyms in scoped.items():
        if normalized(fact['label'])==normalized(canonical) and label in {normalized(a) for a in synonyms}:return True
    aliases=[fact['label'],*fact.get('aliases',[])]
    # Old packs may have custom or incomplete aliases. Shared synonyms remain live.
    fact_label=normalized(fact['label'])
    for canonical, synonyms in ALIASES.items():
        if fact_label in {normalized(canonical),*(normalized(a) for a in synonyms)}:
            aliases.extend(synonyms)
    grading_label=fact['label']=='GPA' and any(label.startswith(normalized(a)) for a in ALIASES['GPA']) and bool(re.search(r'4[.．]0|5[.．]0|满分|scale',str(field.get('label','')),re.I))
    return label in {normalized(a) for a in aliases} or grading_label


def personal_graduation(field):
    return module_hint(field)=='personal' and field.get('label') in ('毕业时间','毕业日期')


def highest_education_end(profile,field):
    levels={option_equivalent(f['value'],'学历') for f in profile['facts'] if f['label']=='最高学历' and not f.get('manual')}
    if len(levels)!=1:return []
    records={f['recordId'] for f in profile['facts'] if f['module']=='education' and f['label']=='学历' and option_equivalent(f['value'],'学历') in levels}
    if len(records)!=1:return []
    return [f for f in profile['facts'] if f['module']=='education' and f['recordId'] in records and label_matches(f,field) and record_matches(f,field)]


def personal_reference(field):
    if module_hint(field)!='personal':return None
    education=re.fullmatch(r'(最高|第一)学历(毕业院校|毕业学校|毕业时间|毕业日期|学习形式|专业)?',str(field.get('label','')))
    if education and (education[1]=='第一' or education[2]):return {'module':'education','kind':education[1],'label':{'毕业院校':'学校','毕业学校':'学校','毕业时间':'结束日期','毕业日期':'结束日期','学习形式':'学历类型','专业':'专业'}.get(education[2],'学历')}
    if re.fullmatch(r'学习形式|学习方式',str(field.get('label',''))):return {'module':'education','kind':'最高','label':'学历类型'}
    if re.fullmatch(r'已通过的英语等级证书|英语等级证书|英语等级成绩',str(field.get('label',''))):return {'module':'language','kind':'CET','label':'考试成绩' if '成绩' in field['label'] else '证书类型'}
    if field.get('label')=='外语等级证书':return {'module':'language','kind':'foreign','label':'证书类型'}
    return None


def personal_reference_facts(profile,field):
    ref=personal_reference(field)
    if not ref:return []
    ids=set()
    if ref['module']=='education' and ref['kind']=='最高':
        levels={option_equivalent(f['value'],'学历') for f in profile['facts'] if f['label']=='最高学历' and not f.get('manual')}
        if len(levels)==1:ids={f['recordId'] for f in profile['facts'] if f['module']=='education' and f['label']=='学历' and option_equivalent(f['value'],'学历') in levels}
    elif ref['module']=='education':
        records={f['recordId'] for f in profile['facts'] if f['module']=='education'}
        # The oldest school is not necessarily the first higher qualification.
        for rid in list(records):
            qualifications=[f for f in profile['facts'] if f['module']=='education' and f['recordId']==rid and f['label']=='学历']
            levels={option_equivalent(f['value'],'学历') for f in qualifications}
            if len(levels)!=1:return []
            level=next(iter(levels))
            if level in {'高中','普通高中','中专','职高','初中','小学'}:records.remove(rid)
            elif level not in {'本科','专科','硕士','博士'} or any(f.get('manual') for f in qualifications):return []
        dated=[f for f in profile['facts'] if f['module']=='education' and f['recordId'] in records and f['label']=='开始日期' and not f.get('manual') and re.match(r'^\d{4}-\d{2}',str(f['value']))]
        if any(not any(f['recordId']==rid for f in dated) for rid in records):return []
        first=min((str(f['value']) for f in dated),default='');ids={f['recordId'] for f in dated if str(f['value'])==first}
    else:
        if ref['kind']=='foreign' and any(f['module']=='language' and not f.get('manual') and ((f['label']=='语种' and not re.fullmatch(r'英语|english',str(f['value']),re.I)) or (f['label']=='证书类型' and not re.search(r'六级|四级|CET[- ]?[46]',str(f['value']),re.I))) for f in profile['facts']):return []
        certs=[(f['recordId'],6 if re.search(r'六级|CET[- ]?6',str(f['value']),re.I) else 4 if re.search(r'四级|CET[- ]?4',str(f['value']),re.I) else 0) for f in profile['facts'] if f['module']=='language' and f['label']=='证书类型' and not f.get('manual')]
        rank=max((r for _,r in certs),default=0)
        if rank:ids={id for id,r in certs if r==rank}
    if len(ids)!=1:return []
    projected=dict(field,label=ref['label'],module=ref['module'],groupLabel='',recordHint='')
    return [f for f in profile['facts'] if f['module']==ref['module'] and f['recordId'] in ids and label_matches(f,projected)]


def record_evidence(profile,field,module):
    raw_hint=str(field.get('recordHint',''));hint=normalized(raw_hint)
    prefix=normalized(re.split(r'…|\.{3,}',raw_hint)[0]) if module=='publications' and re.search(r'…|\.{3,}',raw_hint) else ''
    if not hint or module not in RECORD_IDENTITY_FIELDS:return None
    scores={}
    for fact in profile['facts']:
        if fact['module']!=module or fact['label'] not in RECORD_IDENTITY_FIELDS[module]:continue
        value=normalized(fact['value'])
        if len(value)>=2 and (hint==value or (module!='publications' and hint in value) or value in hint or (len(prefix)>=20 and value.startswith(prefix))):
            score=5000+len(prefix) if len(prefix)>=20 and value.startswith(prefix) else min(len(value),len(hint))+(10000 if hint==value else 0)
            scores[fact['recordId']]=max(scores.get(fact['recordId'],0),score)
    best=max(scores.values(),default=0)
    return {rid for rid,score in scores.items() if score==best}


def highest_personal_fact(fact,field):
    return fact['module']=='personal' and fact['label'] in {'最高学历','最高学位'} and normalized(field.get('label',''))==normalized(fact['label'])


def matching_facts(profile,field):
    if personal_reference(field):return personal_reference_facts(profile,field)
    if personal_graduation(field):return highest_education_end(profile,field)
    module=module_hint(field); candidates=[]
    for fact in profile['facts']:
        if fact['module']=='personal' and fact.get('manual'):continue
        if fact['module']=='family' and module!='family':continue
        if module and fact['module']!=module and not (module=='education' and highest_personal_fact(fact,field)):continue
        if not label_matches(fact,field) or not record_matches(fact,field):continue
        candidates.append(fact)
    evidence=record_evidence(profile,field,module)
    if evidence is not None:candidates=[f for f in candidates if f['recordId'] in evidence]
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
    if personal_reference(field):return any(f['key']==fact['key'] for f in personal_reference_facts(profile,field))
    if manual_field(field) or fact['module']=='family' and module_hint(field)!='family':return False
    if personal_graduation(field):return any(f['key']==fact['key'] for f in highest_education_end(profile,field))
    module=module_hint(field)
    if module and fact['module']!=module and not (module=='education' and highest_personal_fact(fact,field)):return False
    if not record_matches(fact,field):return False
    if module=='education' and re.search(r'学制|修业年限|study duration',field.get('label',''),re.I) and not re.search(r'学制|修业年限|study duration',fact['label'],re.I):return False
    evidence=record_evidence(profile,field,module)
    if evidence is not None and fact['recordId'] not in evidence:return False
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
    if label=='获奖级别':text={'校级':'院校级','学校级':'院校级','高校级':'院校级','校院级':'院校级','省级':'省区级','省部级':'省区级','市级':'地市级','全国级':'国家级','国际性':'国际级'}.get(text,text)
    if label=='专业':
        text=normalized(re.sub(r'\s*[（(][^()（）]+类[)）]\s*$','',str(value)))
        if len(text)>=5:text=re.sub(r'(规划|工程|管理|技术|设计|经济|教育|园林)学$',r'\1',text)
    if label in ('证书类型','语言／证书名称'):
        if re.fullmatch(r'(大学英语)?(四级|4级|四级考试|4级考试)',text) or text in ('cet4','collegeenglishtest4'):return 'cet4'
        if re.fullmatch(r'(大学英语)?(六级|6级|六级考试|6级考试)',text) or text in ('cet6','collegeenglishtest6'):return 'cet6'
    if label in ('学历','最高学历'):
        return {'硕士研究生':'硕士','博士研究生':'博士','大学本科':'本科','大学专科':'专科','大专':'专科'}.get(text,text)
    if label=='学历类型':return {'普通全日制':'全日制','全日制普通':'全日制'}.get(text,text)
    if label in ('学位','最高学位'):
        return {'硕士学位':'硕士','学士学位':'学士','博士学位':'博士','工学学士':'学士','理学学士':'学士','文学学士':'学士','工学硕士':'硕士','理学硕士':'硕士','文学硕士':'硕士'}.get(text,text)
    return text


def region_equivalent(field,existing,proposed):
    depth=field.get('regionDepth')
    if field.get('adapter')!='ant-region' or isinstance(depth,bool) or not isinstance(depth,int) or not 2<=depth<=4:return False
    def parts(value):return [re.sub(r'省|市|自治区|特别行政区','',p) for p in re.split(r'(?<=省)|(?<=市)|(?<=自治区)|(?<=特别行政区)',re.sub(r'[\s/／>]+','',str(value))) if p]
    actual,source=parts(existing),parts(proposed)
    return len(actual)==depth and len(source)>=depth and actual==source[:depth]


def numeric_equivalent(a,b,label):
    if not re.fullmatch(r'GPA|平均绩点|绩点|考试成绩|考试分数|证书成绩|英语四级|英语六级|四级成绩|六级成绩|身高(?:cm)?|体重(?:kg)?',label,re.I):return False
    if not all(re.fullmatch(r'-?\d+(?:\.\d+)?',str(value).strip()) for value in (a,b)):return False
    return Decimal(str(a).strip())==Decimal(str(b).strip())


def bind_record_groups(profile,scan,bindings=None):
    bindings=bindings or {}
    if not isinstance(bindings,dict):raise ValueError('invalid record bindings')
    grouped={};repeated={'education','internship','project','campus-role','awards','publications','family','language'}
    for field in scan['fields']:
        if field.get('groupId') and module_hint(field) in repeated:grouped.setdefault(field['groupId'],[]).append(field)
    module_groups={}
    for fields in grouped.values():
        module=module_hint(fields[0]);module_groups[module]=module_groups.get(module,0)+1
    if any(gid not in grouped or not isinstance(rid,str) for gid,rid in bindings.items()):raise ValueError('binding must use current groups')
    groups=[]
    for gid,fields in grouped.items():
        module=module_hint(fields[0]);facts=[f for f in profile['facts'] if f['module']==module]
        records={f['recordId']:{'id':f['recordId'],'label':f.get('recordLabel') or f.get('recordHint') or f['recordId']} for f in facts}
        eligible=set(records);evidence=[]
        if len({module_hint(f) for f in fields})!=1:evidence.append(set())
        for field in fields:
            hints=record_evidence(profile,field,module)
            if hints is not None:evidence.append(hints)
            if module=='education' and re.search(r'博士|硕士|本科|专科|高中',' '.join(str(field.get(k,'')) for k in ('label','groupLabel','recordHint'))):evidence.append({f['recordId'] for f in facts if record_matches(f,field)})
            identities=['学校','院校','学历','专业'] if module=='education' else RECORD_IDENTITY_FIELDS.get(module,[])
            relevant=[f for f in facts if f['label'] in identities and label_matches(f,field)]
            identity_value=next((o['text'] for o in field.get('options',[]) if o['value']==field.get('value')),field.get('value',''))
            value=normalized(identity_value)
            if value and not re.match(r'^(请选择|选择|请输入|please|select)',value,re.I) and relevant:evidence.append({f['recordId'] for f in relevant if any(v and option_equivalent(v,f['label'])==option_equivalent(identity_value,f['label']) for v in (f['value'],f.get('recordLabel'),f.get('recordHint')))})
        header=record_evidence(profile,{'recordHint':fields[0].get('groupLabel','')},module)
        if header:evidence.append(header)
        explicit=bindings.get(gid)
        if explicit:
            if explicit not in records:raise ValueError('record outside group module')
        for ids in evidence:eligible &= ids
        if explicit:eligible={explicit};evidence=[{explicit}]
        bound=len(eligible)==1 and (bool(evidence) or (len(records)==1 and module_groups.get(module)==1));conflict=bool(evidence) and not eligible;rid=next(iter(eligible)) if bound else ''
        groups.append({'groupId':gid,'module':module,'label':fields[0].get('groupLabel') or module,'status':'bound' if bound else 'conflict' if conflict else 'unbound','recordId':rid,'recordLabel':records[rid]['label'] if rid else '', 'reason':'整段字段使用同一份经历。' if bound else '页面经历信息与所选资料不一致，请核对整段名称或重新选择经历。' if conflict else '请先为这一整段选择对应经历，开始、结束时间与正文将统一匹配。','candidates':list(records.values()),'fieldIds':[f['id'] for f in fields]})
    return groups


def plan_fields(profile,scan,mappings=None,today=None,record_bindings=None):
    if not isinstance(scan,dict) or not isinstance(scan.get('fields'),list):raise ValueError('invalid field scan')
    facts={f['key']:f for f in profile['facts']}; mappings=mappings or {}
    ids=[f.get('id') for f in scan['fields'] if isinstance(f,dict)]
    if len(ids)!=len(scan['fields']) or any(not isinstance(i,str) or not i for i in ids) or len(ids)!=len(set(ids)):raise ValueError('field IDs must be unique strings')
    if not isinstance(mappings,dict) or any(not isinstance(field,str) or not isinstance(key,str) or field not in ids or key not in facts for field,key in mappings.items()):raise ValueError('mapping must use scanned IDs and current profile fact keys')
    today=today or datetime.date.today()
    rows=[];actions=[];warnings=list(profile.get('warnings',[]))+list(scan.get('warnings',[]))
    groups=bind_record_groups(profile,scan,record_bindings);by_field={fid:g for g in groups for fid in g['fieldIds']}
    for field in scan['fields']:
        row={'fieldId':field['id'],'label':str(field.get('label','')),'module':field.get('module',''),'groupLabel':field.get('groupLabel',''),'status':'missing','reason':'资料中没有可确认的对应字段。','expectedValue':field.get('value','')}
        binding=by_field.get(field['id'])
        match_field={**field,'module':binding['module'],'groupLabel':'','recordHint':''} if binding and binding['status']=='bound' else field
        match_profile={**profile,'facts':[f for f in profile['facts'] if f['module']==binding['module'] and f['recordId']==binding['recordId']]} if binding and binding['status']=='bound' else profile
        if binding:
            row['recordBinding']={k:binding[k] for k in ('groupId','status','recordId','recordLabel')}
            row['allowedFactKeys']=[f['key'] for f in profile['facts'] if not f.get('manual') and f['module']==binding['module'] and f['recordId']==binding['recordId'] and mapping_matches(match_profile,match_field,f)] if binding['status']=='bound' else []
        kind=field.get('type','text'); label=row['label'];deferred_select=kind=='combobox' and field.get('adapter') in ('moka-select','phoenix-select','phoenix-date','ant-select','ant-date','ant-split-date','ant-region')
        if field.get('unsupported') or kind not in ('text','textarea','email','tel','date','month','number','select','radio','checkbox','combobox','file'):
            row.update(status='unsupported',reason='控件尚不支持可靠填入。')
        elif kind in ('file','checkbox') or (kind=='combobox' and not field.get('options') and not deferred_select) or manual_field(field):row.update(status='manual',reason='上传、协议或复杂控件需要人工操作。')
        elif binding and binding['status']!='bound':row.update(status='ambiguous',reason=binding['reason'])
        else:
            candidates=[facts[mappings[field['id']]]] if field['id'] in mappings else matching_facts(match_profile,match_field)
            if binding:candidates=[f for f in candidates if f['module']==binding['module'] and f['recordId']==binding['recordId']]
            if len(candidates)>1:row.update(status='ambiguous',reason='有多个资料记录，分组或记录提示无法唯一确认，请选择事实。')
            elif len(candidates)==1:
                fact=candidates[0]; value=str(fact['value']);value_precision=fact.get('precision');row.update(factKey=fact['key'],value=value,displayValue=mask(value,label) if fact['sensitive'] else value,sensitive=fact['sensitive'])
                date_format=field.get('dateFormat')
                if date_format and date_format not in ('YYYY-MM-DD','YYYY/MM/DD','YYYY.MM.DD','YYYY-MM','YYYY/MM','YYYY.MM'):raise ValueError('invalid date format')
                date_kind=('month' if value_precision=='month' else 'date' if value_precision=='day' else '') if field.get('adapter')=='phoenix-date' and not date_format else 'month' if field.get('datePart') else kind if kind in ('date','month') else ('date' if 'DD' in date_format else 'month') if date_format else ''
                reason=None
                if field['id'] in mappings and not mapping_matches(match_profile,match_field,fact):reason='映射与字段的明确含义、模块或记录不符，不能跨记录填入。'
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
                if not reason and ongoing_end(fact) and (date_kind or field.get('adapter')=='phoenix-date'):
                    checkbox=any(f.get('type')=='checkbox' and f.get('groupId') and f.get('groupId')==field.get('groupId') and normalized(f.get('label','')) in ('至今','present','ongoing','仍在进行') for f in scan['fields'])
                    if field.get('presentAvailable'):row['presentControl']=True;value_precision='day'
                    elif checkbox:reason='网站提供「至今」勾选，请先手动选择，再重新识别。'
                    elif fact.get('dateFallback')!='today':reason='经历仍在进行，日期控件不支持「至今」；尚未授权具体日期兜底。'
                    else:value=today.isoformat();value_precision='day';row.update(dateFallbackUsed=True,resolvedOn=value)
                if not reason and re.search(r'待确认|未确认|待核|未核|未知|冲突|不确定',value):reason='资料包含待确认的时间或事实表述，需要人工确认。'
                if not reason and '至今' in value and not fact.get('ongoing') and not row.get('presentControl'):reason='资料包含至今的时间表述，需要人工确认。'
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
                if not reason and date_kind and not row.get('presentControl'):
                    numbers=re.findall(r'\d+',value)
                    try:
                        datetime.date(int(numbers[0]),int(numbers[1]),int(numbers[2]) if date_kind=='date' else 1)
                        value='-'.join([numbers[0],numbers[1].zfill(2)]+([numbers[2].zfill(2)] if date_kind=='date' else []))
                        if (constraints.get('min') and value<constraints['min']) or (constraints.get('max') and value>constraints['max']):reason='日期超出字段明确范围，需人工核对；未截断或修改日期。'
                        if date_format:value=value.replace('-','/' if '/' in date_format else '.' if '.' in date_format else '-')
                        if field.get('datePart'):value=str(int(numbers[0 if field['datePart']=='year' else 1]))
                        row['value']=value;row['displayValue']=value
                    except (ValueError,IndexError):reason='来源日期不符合日历规则，需要人工核对。'
                options=field.get('options',[])
                if not reason and kind in ('select','radio','combobox') and (not deferred_select or options):
                    binary_marriage={'已婚':'是','未婚':'否'}.get(normalized(value)) if fact['label']=='婚姻状况' and normalized(field['label'])=='婚否' else None
                    matches=[o for o in options if option_equivalent(o.get('text',''),fact['label'])==option_equivalent(value,fact['label']) or str(o.get('value',''))==value or (binary_marriage and normalized(o.get('text',''))==binary_marriage) or (fact.get('ongoing') and ongoing_end(fact) and normalized(o.get('text','')) in ('至今','present','ongoing','current'))]
                    if len(matches)!=1:reason='没有唯一等价选项，需要人工选择。'
                    else:row['optionValue']=matches[0]['value']
                if reason:row.update(status='manual',reason=reason)
                else:
                    existing=str(field.get('value') or ''); proposed=str(row.get('optionValue',value))
                    note=' 经历仍在进行；此日期为填写当天的表单占位，不是实际结束日期。' if row.get('dateFallbackUsed') else ''
                    if existing and (existing==proposed or existing==value or numeric_equivalent(existing,value,fact['label']) or field.get('adapter')=='phoenix-date' and re.fullmatch(r'\d{4}-\d{2}',existing) and value.startswith(existing+'-') or region_equivalent(field,existing,value) or kind in ('select','radio','combobox') and option_equivalent(existing,fact['label'])==option_equivalent(value,fact['label'])):row.update(status='already',reason='已有值与资料相同。'+note)
                    elif existing:row.update(status='conflict',reason='已有值与资料不同，保留现值，需明确选择覆盖。'+note)
                    else:
                        row.update(status='ready',reason='事实、记录及控件约束已确认。'+note)
                        actions.append({k:row[k] for k in ('fieldId','value','expectedValue','optionValue') if k in row})
        rows.append(row)
    counts={}
    for row in rows:counts[row['status']]=counts.get(row['status'],0)+1
    return {'protocol':1,'sourceVersion':profile['sourceVersion'],'profileId':profile['profileId'],'origin':scan.get('origin',''),'path':scan.get('path',''),'fingerprint':scan.get('fingerprint',''),'groups':groups,'rows':rows,'actions':actions,'summary':{'fields':len(rows),'ready':counts.get('ready',0)},'statusCounts':counts,'warnings':warnings}

profileSummary=profile_summary
