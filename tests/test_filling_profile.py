import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from filling_profile import load_profile,profile_summary,plan_fields

class FillingProfileTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.data={'_使用规则':['rule '+str(i) for i in range(10)],'_保存日期':'2026-10-04',
            '基本信息':{'姓名':'Fixture User','手机':'12345678901','电子邮箱':'fixture@example.invalid','当前户籍所在地':'Registered City','生源地':'Origin City','家庭地址':'Private address'},
            '教育经历':[{'学历':'本科','学位':'学士','学校':'Undergraduate University','专业':'Major A','开始日期':'2020-09','结束日期':'2024-06','GPA':'3.8','主修课程及成绩':'Do not paste all courses'}, {'学历':'硕士','学位':'硕士','学校':'Graduate University','专业':'Major B','开始日期':'2024-09-02','结束日期':'2027-06','GPA':'4.1'}],
            '实习经历_央国企口径':[{'单位':'State Fixture','职务':'Research','开始':'2024-07-15','结束':'2035-10-17','职责_199字版':'Short exact responsibilities','职责_229字完整版':'Long complete responsibilities'}],
            '实习经历_仅AI产品口径_央国企不用':[{'单位':'Internet Fixture','职务':'Product','开始':'2025-05','结束':'2025-08','职责':'Internet exact responsibilities'}],
            '项目经历':[{'名称':'Project Fixture','时间':'2025-01至今','简述':'Preserve full description'}],
            '家庭成员':{'父亲':{'姓名':'Never auto-fill family'}},'报名信息_中行':{'个人评价_105字':'Company specific essay'},'研究成果_完整版见':'a-reference.md','证件照':{'路径':'not-auto-upload.jpg'}}
        self.write()
    def tearDown(self):self.tmp.cleanup()
    def write(self): (self.root/'网申信息库.json').write_text(json.dumps(self.data))
    def field(self,label,**kw):return {'id':'field','label':label,'type':'text','module':'','value':'',**kw}
    def plan(self,field,profile='general',mappings=None):return plan_fields(load_profile(self.root,profile),{'origin':'https://example.invalid','path':'/apply','fingerprint':'fixture','fields':[field]},mappings)
    def test_module_boundaries_and_live_shared_aliases(self):
        from filling_profile import matching_facts, mapping_matches
        profile={'facts':[
            {'key':'name','label':'姓名','module':'personal','recordId':'','aliases':['姓名']},
            {'key':'start','label':'入学时间','module':'education','recordId':'edu','aliases':['入学时间']},
            {'key':'end','label':'毕业时间','module':'education','recordId':'edu','aliases':['毕业时间']},
            {'key':'unit','label':'单位','module':'internship','recordId':'job','aliases':['单位']},
            {'key':'home','label':'现居地','module':'personal','recordId':'','aliases':['现居地']},
            {'key':'project','label':'开始日期','module':'project','recordId':'project','aliases':['开始日期']}]}
        for field in [self.field('姓名',module='personal',groupLabel='家庭成员'),self.field('开始时间',module='project',groupLabel='在校任职'),self.field('开始时间',module='awards'),self.field('结束时间',module='publications'),self.field('开始时间',module='other-experience')]:
            self.assertEqual(matching_facts(profile,field),[])
            self.assertTrue(all(not mapping_matches(profile,field,fact) for fact in profile['facts']))
        for label,module,key in [('开始时间','education','start'),('结束时间','education','end'),('单位名称','internship','unit'),('现居住地','personal','home')]:
            self.assertEqual([f['key'] for f in matching_facts(profile,self.field(label,module=module))],[key])
        self.assertEqual(self.plan(self.field('姓名',module='personal',groupLabel='家庭成员'))['rows'][0]['value'],'Never auto-fill family')

    def test_highest_graduation_and_numeric_equality(self):
        from filling_profile import matching_facts,mapping_matches,option_equivalent,numeric_equivalent
        profile=load_profile(self.root)
        profile['facts']=[f for f in profile['facts'] if f['label']!='最高学历']
        field=self.field('毕业时间',module='personal')
        self.assertEqual(matching_facts(profile,field),[])
        profile['facts'].append({'key':'fixture.highest','label':'最高学历','module':'personal','value':'硕士研究生','recordId':'','aliases':['最高学历']})
        ends=matching_facts(profile,field)
        self.assertEqual(len(ends),1)
        self.assertEqual(ends[0]['value'],'2027-06')
        self.assertTrue(mapping_matches(profile,field,ends[0]))
        other=next(f for f in profile['facts'] if f['label']=='结束日期' and f['value']=='2024-06')
        self.assertFalse(mapping_matches(profile,field,other))
        profile['facts'].append({'key':'second.master','label':'学历','module':'education','value':'硕士','recordId':'second','aliases':['学历']})
        self.assertEqual(matching_facts(profile,field),[])
        self.assertFalse(mapping_matches(profile,field,ends[0]))
        self.assertEqual(option_equivalent('普通全日制','学历类型'),option_equivalent('全日制','学历类型'))
        self.assertTrue(numeric_equivalent('554.00000','554','考试成绩'))
        self.assertFalse(numeric_equivalent('554.00000','554','证件号码'))
        self.assertFalse(numeric_equivalent('3.8','38','GPA'))

    def test_module_scoped_aliases_and_record_identity(self):
        from filling_profile import matching_facts,mapping_matches
        facts=[]
        for rid,name in [('one','合成校园职务甲'),('two','合成校园职务乙')]:
            for label,value in [('职务',name),('职责描述','合成职责'),('开始日期','2020-09')]:facts.append({'key':rid+label,'module':'campus-role','recordId':rid,'label':label,'value':value,'aliases':[label]})
        profile={'facts':facts}
        for label,key in [('在校职务名称','one职务'),('在校职务描述','one职责描述'),('开始时间','one开始日期')]:
            field=self.field(label,module='campus-role',recordHint='合成校园职务甲')
            self.assertEqual([f['key'] for f in matching_facts(profile,field)],[key])
            self.assertFalse(mapping_matches(profile,field,next(f for f in facts if f['key']==key.replace('one','two'))))
        self.assertEqual(matching_facts(profile,self.field('在校职务类别',module='campus-role')),[])
        self.assertEqual(len(matching_facts(profile,self.field('开始时间',module='campus-role',groupLabel='在校职务 · 第2段'))),2)
        self.assertEqual(matching_facts(profile,self.field('开始时间',module='campus-role',recordHint='不存在的职务')),[])
        self.assertEqual(matching_facts(profile,self.field('在校职务名称',module='personal')),[])

    def test_explicit_publication_prefix_requires_unique_long_evidence(self):
        from filling_profile import matching_facts,mapping_matches
        prefix='Synthetic Publication Long Identifiable Prefix'
        facts=[{'key':'one.name','module':'publications','recordId':'one','label':'论文名称','value':prefix+' First Complete Title','aliases':['论文名称']},{'key':'one.date','module':'publications','recordId':'one','label':'发表日期','value':'2025-11','aliases':['发表日期']}]
        field=self.field('发布时间',module='publications',recordHint=prefix+'…（示例期刊）')
        self.assertEqual([f['key'] for f in matching_facts({'facts':facts},field)],['one.date'])
        duplicate=facts+[{'key':'two.name','module':'publications','recordId':'two','label':'论文名称','value':prefix+' Second Complete Title','aliases':['论文名称']},{'key':'two.date','module':'publications','recordId':'two','label':'发表日期','value':'2026-01','aliases':['发表日期']}]
        self.assertEqual(len(matching_facts({'facts':duplicate},field)),2)
        for hint in ['Synthetic…',prefix]:self.assertEqual(matching_facts({'facts':facts},self.field('发布时间',module='publications',recordHint=hint)),[])
        self.assertFalse(mapping_matches({'facts':facts},self.field('发布时间',module='publications',recordHint='Unknown Publication Title…'),facts[1]))

    def test_missing_source_and_summary_never_contain_personal_values(self):
        summary=profile_summary(load_profile(self.root)); rendered=json.dumps(summary)
        for private in ('Fixture User','12345678901','fixture@example.invalid','Private address','Graduate University'):self.assertNotIn(private,rendered)
        self.assertEqual(len(summary['rules']),10);self.assertEqual(summary['sourceSavedAt'],'2026-10-04')
        (self.root/'网申信息库.json').unlink();profile=load_profile(self.root);self.assertEqual(profile['sourceVersion'],'missing');self.assertEqual(profile['facts'],[])
    def test_highest_education_rank_not_source_order_and_record_hints(self):
        self.assertEqual(self.plan(self.field('最高学历'))['actions'][0]['value'],'硕士')
        self.assertEqual(self.plan(self.field('学校',module='education',groupLabel='硕士'))['actions'][0]['value'],'Graduate University')
        self.assertEqual(self.plan(self.field('学校',module='education',groupLabel='本科'))['actions'][0]['value'],'Undergraduate University')
        self.assertEqual(self.plan(self.field('学校',module='education'))['rows'][0]['status'],'ambiguous')
        self.data['教育经历'].reverse();self.write();self.assertEqual(self.plan(self.field('最高学历'))['actions'][0]['value'],'硕士')
    def test_hukou_origin_residence_and_native_place_never_interchange(self):
        self.assertEqual(self.plan(self.field('户籍所在地'))['actions'][0]['value'],'Registered City')
        self.assertEqual(self.plan(self.field('生源地'))['actions'][0]['value'],'Origin City')
        for label in ('现居住地','籍贯'):self.assertEqual(self.plan(self.field(label))['rows'][0]['status'],'missing')
    def test_profile_internships_and_company_specific_data_are_isolated(self):
        general=load_profile(self.root,'general');self.assertFalse(any(f['module']=='internship' for f in general['facts']))
        state=load_profile(self.root,'state');ai=load_profile(self.root,'ai-product')
        self.assertNotIn('Internet Fixture',[f['value'] for f in state['facts']]);self.assertIn('Internet Fixture',[f['value'] for f in ai['facts']])
        self.assertEqual(self.plan(self.field('个人评价'),profile='ai-product')['rows'][0]['status'],'missing')
        self.assertEqual(self.plan(self.field('父亲姓名'))['rows'][0]['value'],'Never auto-fill family')
        for label in ('验证码','是否同意协议'):self.assertEqual(self.plan(self.field(label))['rows'][0]['status'],'manual')
    def test_existing_values_preserved_and_sensitive_display_masked(self):
        same=self.plan(self.field('手机',value='12345678901'));self.assertEqual(same['rows'][0]['status'],'already');self.assertEqual(same['actions'],[])
        conflict=self.plan(self.field('手机',value='other'));self.assertEqual(conflict['rows'][0]['status'],'conflict');self.assertEqual(conflict['actions'],[]);self.assertNotEqual(conflict['rows'][0]['displayValue'],'12345678901')
        ready=self.plan(self.field('电子邮箱',type='email'));self.assertEqual(ready['rows'][0]['status'],'ready');self.assertNotIn('fixture@example.invalid',ready['rows'][0]['displayValue'])
    def test_date_precision_maxlength_and_option_equivalence(self):
        month=self.field('开始日期',module='education',groupLabel='本科',type='date');self.assertEqual(self.plan(month)['rows'][0]['status'],'manual')
        month['type']='month';self.assertEqual(self.plan(month)['actions'][0]['value'],'2020-09')
        date=self.field('开始日期',module='education',groupLabel='硕士',type='date');self.assertEqual(self.plan(date)['actions'][0]['value'],'2024-09-02')
        long=self.plan(self.field('姓名',maxLength=3));self.assertEqual(long['rows'][0]['status'],'ready');self.assertEqual(long['rows'][0]['value'],'Fixture User')
        option=self.field('最高学历',type='select',options=[{'value':'m','text':'硕士研究生'}]);self.assertEqual(self.plan(option)['actions'][0]['optionValue'],'m')
        option['options']=[{'value':'b','text':'本科'}];self.assertEqual(self.plan(option)['rows'][0]['status'],'manual')
    def test_mapping_validates_keys_and_cannot_bypass_constraints(self):
        profile=load_profile(self.root);key=next(f['key'] for f in profile['facts'] if f['label']=='学校')
        mapped=self.plan(self.field('学校',module='education'),mappings={'field':key});self.assertEqual(mapped['rows'][0]['status'],'ready')
        with self.assertRaises(ValueError):self.plan(self.field('学校'),mappings={'field':'invented.fact'})
        with self.assertRaises(ValueError):self.plan(self.field('学校'),mappings={'unknownField':key})
        self.assertEqual(self.plan(self.field('上传文件',type='file'),mappings={'field':key})['rows'][0]['status'],'manual')
        gpa=next(f['key'] for f in profile['facts'] if f['label']=='GPA')
        self.assertEqual(self.plan(self.field('GPA（满分4.0）'),mappings={'field':gpa})['rows'][0]['status'],'manual')
        fact=next(f['key'] for f in profile['facts'] if f['label']=='开始日期' and f['recordLabel']=='本科')
        self.assertEqual(self.plan(self.field('开始日期',type='date'),mappings={'field':fact})['rows'][0]['status'],'manual')
    def test_project_present_dates_manual_and_supplements_not_auto_pasted(self):
        plan=self.plan(self.field('项目时间',module='project'),profile='state');self.assertEqual(plan['rows'][0]['status'],'manual')
        self.assertEqual(self.plan(self.field('主修课程及成绩'))['rows'][0]['status'],'missing')
        self.assertTrue(load_profile(self.root)['supplements'])
    def test_gpa_labels_and_invalid_dates_are_manual_without_mapping(self):
        plan=self.plan(self.field('GPA（满分4.0）',module='education',groupLabel='本科'))
        self.assertEqual(plan['rows'][0]['status'],'manual');self.assertEqual(plan['actions'],[])
        self.data['教育经历'][1]['开始日期']='2024-13-40';self.write()
        self.assertEqual(self.plan(self.field('开始日期',module='education',groupLabel='硕士',type='date'))['rows'][0]['status'],'manual')
    def test_same_record_variants_and_multi_jobs_do_not_guess_by_dom_position(self):
        field=self.field('工作职责',module='internship',groupLabel='State Fixture')
        self.assertEqual(self.plan(field,profile='state')['rows'][0]['status'],'ambiguous')
        self.data['实习经历_央国企口径'].append({'单位':'State Fixture','职务':'Another Role'})
        self.write();self.assertEqual(self.plan(self.field('职务',module='internship',recordHint='State Fixture'),profile='state')['rows'][0]['status'],'ambiguous')
    def test_formal_scope_and_gpa_scale_cannot_be_overridden_by_mappings(self):
        folder=self.root/'填报资料';folder.mkdir()
        formal={'schemaVersion':1,'rules':[],'facts':[
            {'key':'gpa','label':'GPA','value':'3.8','module':'education','recordId':'e','gpaScale':'4.0'},
            {'key':'company','label':'个人评价','value':'Only company-specific essay','module':'personal','companyScope':'fixture-company'}]}
        (folder/'资料.json').write_text(json.dumps(formal))
        self.assertEqual(self.plan(self.field('GPA（满分4.0）'),mappings={'field':'gpa'})['rows'][0]['status'],'ready')
        self.assertEqual(self.plan(self.field('GPA（满分5.0）'),mappings={'field':'gpa'})['rows'][0]['status'],'manual')
        self.assertEqual(self.plan(self.field('个人评价'),mappings={'field':'company'})['rows'][0]['status'],'manual')
        with self.assertRaises(ValueError):self.plan(self.field('GPA'),mappings={'field':{}})
    def test_dom_modules_and_explicit_record_mapping_constraints(self):
        self.assertEqual(self.plan(self.field('开始日期',module='work'),profile='state')['actions'][0]['value'],'2024-07-15')
        self.assertEqual(self.plan(self.field('项目名称',module='projects'),profile='state')['actions'][0]['value'],'Project Fixture')
        self.assertEqual(self.plan(self.field('学校名称',module='education',groupLabel='本科教育经历'))['actions'][0]['value'],'Undergraduate University')
        profile=load_profile(self.root);masters=next(f['key'] for f in profile['facts'] if f['label']=='学位' and '硕士' in f['recordHint'])
        row=self.plan(self.field('本科学位',module='education'),mappings={'field':masters})['rows'][0]
        self.assertEqual(row['status'],'manual')
        person=next(f['key'] for f in profile['facts'] if f['label']=='姓名')
        self.assertEqual(self.plan(self.field('School name',module='education'),mappings={'field':person})['rows'][0]['status'],'manual')
        self.assertEqual(self.plan(self.field('Company name',module='work'),profile='state',mappings={'field':person})['rows'][0]['status'],'manual')
        self.assertEqual(self.plan(self.field('Name',module='education'))['rows'][0]['status'],'missing')
    def test_unknown_mapping_and_explicit_aria_options(self):
        profile=load_profile(self.root);key=next(f['key'] for f in profile['facts'] if f['label']=='最高学历')
        self.assertEqual(self.plan(self.field('Unknown field'),mappings={'field':key})['rows'][0]['status'],'ready')
        field=self.field('最高学历',type='combobox',options=[{'value':'m','text':'硕士研究生'}])
        self.assertEqual(self.plan(field)['rows'][0]['status'],'ready')
        field['options']=[];self.assertEqual(self.plan(field)['rows'][0]['status'],'manual')
    def test_numeric_gpa_maximum_and_plain_number_ranges(self):
        field=self.field('GPA',module='education',groupLabel='本科',type='number',constraints={'max':'4','min':'0','step':'0.1'})
        self.assertEqual(self.plan(field)['rows'][0]['status'],'manual')
        self.data['基本信息']['身高cm']=180;self.write()
        field=self.field('身高',type='number',constraints={'min':'120','max':'200','step':'0.5','pattern':'[0-9]+'})
        self.assertEqual(self.plan(field)['rows'][0]['status'],'ready')
        field['constraints']['max']='179';self.assertEqual(self.plan(field)['rows'][0]['status'],'manual')
        field['constraints']={'min':'181'};self.assertEqual(self.plan(field)['rows'][0]['status'],'manual')
        folder=self.root/'填报资料';folder.mkdir()
        (folder/'资料.json').write_text(json.dumps({'schemaVersion':1,'rules':[],'facts':[{'key':'gpa','label':'GPA','module':'education','value':'3.8','gpaScale':'4.0'}]}))
        field=self.field('GPA',type='number',constraints={'max':'4.0'})
        self.assertEqual(self.plan(field)['rows'][0]['status'],'ready')
        field['constraints']['max']='5';self.assertEqual(self.plan(field)['rows'][0]['status'],'manual')
    def test_formal_schema_fixed_path_and_profile_filter(self):
        folder=self.root/'填报资料';folder.mkdir()
        formal={'schemaVersion':1,'rules':['manual uploads'],'facts':[{'key':'safe.degree','label':'最高学历','value':'硕士','module':'personal','profiles':['general','state','ai-product']}],'supplements':[]}
        (folder/'资料.json').write_text(json.dumps(formal));self.assertEqual(self.plan(self.field('最高学历'))['actions'][0]['value'],'硕士')
        formal['facts'][0]['profiles']=['ai-product'];(folder/'资料.json').write_text(json.dumps(formal));self.assertEqual(load_profile(self.root,'general')['facts'],[])
        (folder/'资料.json').write_text('broken')
        with self.assertRaises(ValueError):load_profile(self.root)

    def test_generic_formal_versions_and_standard_work_in_default_profile(self):
        from filling_profile import export_profile_pack
        folder=self.root/'填报资料';folder.mkdir()
        formal={'schemaVersion':1,'profiles':[{'id':'user-default','label':'Default'},{'id':'user-alt','label':'My variant'}],'rules':[], 'facts':[
            {'key':'work.name','label':'单位','value':'Generic Company','module':'internship','recordId':'w','profiles':['user-default']},
            {'key':'work.role','label':'岗位','value':'Generic Role','module':'internship','recordId':'w','profiles':['user-alt']}]}
        path=folder/'资料.json';path.write_text(json.dumps(formal));before=path.read_bytes()
        self.assertEqual(load_profile(self.root)['profileId'],'user-default')
        pack=export_profile_pack(self.root);self.assertEqual(pack['profiles'],formal['profiles']);self.assertEqual(len(pack['facts']),2)
        self.assertEqual(load_profile(self.root,'user-alt')['facts'][0]['value'],'Generic Role');self.assertEqual(path.read_bytes(),before)
        formal['profiles']=[{'id':'general','label':'默认资料'}];formal['facts']=formal['facts'][:1];formal['facts'][0]['profiles']=['general'];path.write_text(json.dumps(formal))
        self.assertEqual(self.plan(self.field('公司名称',module='work'))['actions'][0]['value'],'Generic Company')

    def test_plain_legacy_profile_has_no_author_versions_or_missing_work(self):
        data={'基本信息':{'姓名':'Generic User'},'教育经历':[], '实习经历':[{'单位':'Generic Employer'}],'工作经历':[{'单位':'Other Employer'}],'项目经历':[{'名称':'Generic Project'}]}
        (self.root/'网申信息库.json').write_text(json.dumps(data))
        profile=load_profile(self.root)
        self.assertEqual(profile['profiles'],[{'id':'general','label':'默认资料'}])
        self.assertEqual([f['value'] for f in profile['facts'] if f['module']=='internship' and f['label']=='单位'],['Generic Employer','Other Employer'])
        self.assertTrue(any(f['module']=='project' for f in profile['facts']))

if __name__=='__main__':unittest.main()
