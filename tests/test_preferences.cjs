/* Defaults, source corrections, conservative matching and persisted legacy choices. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../app/投递管理.html'),'utf8');
for(const [i,script] of [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].entries())new vm.Script(script[1],{filename:`inline-${i}`});
const defaults=JSON.parse(fs.readFileSync(path.join(__dirname,'../app/assets/preference-defaults.json')));
const block=html.slice(html.indexOf('// Common defaults stay usable'),html.indexOf('// One fixed entry point'));
let controls=[];
const context=vm.createContext({window:{__TOUDI_PREFERENCE_DEFAULTS__:defaults},document:{addEventListener(){},querySelectorAll(){return controls;}},data:[],preferences:{natures:[],industries:[],education:[]}});
vm.runInContext(block,context);const run=s=>vm.runInContext(s,context);
assert.equal(run('industryPreferenceGroups().length'),19); // Available even in an empty workspace.
assert.equal(run('industryPreferenceGroups()[0].children[0].name'),'软件与数字服务');
assert.equal(run(`normalizePreference('民企','nature')`),'民营企业');
assert.equal(run(`normalizePreference('硕士研究生','education')`),'硕士');
assert.equal(run(`normalizePreference('博士研究生','education')`),'博士');
assert.equal(run(`normalizePreference('本科及研究生','education')`),'本科及研究生');
assert.deepEqual(Array.from(run(`selectedPreferenceLabels(['专科','硕士研究生'],'education')`)),['大专','硕士']);
for(const value of ['本科','本科及以上','硕士','硕士研究生','硕士及以上','研究生'])assert.equal(run(`preferenceMatch(${JSON.stringify(value)},['硕士'],'education')`),value==='本科'?false:true);
assert.equal(run(`preferenceMatch('博士',['硕士'],'education')`),false);
assert.equal(run(`preferenceMatch('博士',['博士研究生'],'education')`),true);
for(const value of ['', 'MBA', 'MPA', '本科及研究生','硕士以上','硕士（限定专业及专项培养）','分岗位：本科或博士', '学历不限']){
  assert.equal(run(`preferenceMatch(${JSON.stringify(value)},['硕士'],'education')`),null);
  assert.equal(run(`matchesJobPreferences({'学历要求':${JSON.stringify(value)}})`),true);
}
assert.equal(run(`preferenceMatch('软件/人工智能',['软件'],'industry')`),true);
assert.equal(run(`preferenceMatch('银行/国企',['软件'],'industry')`),false); // Metadata must not defeat an ordinary filter.
assert.equal(run(`preferenceMatch('银行/Unclear domain',['软件'],'industry')`),null);
assert.equal(run(`preferenceMatch('软件 extended',['软件'],'industry')`),null); // No substring-based exclusion.
assert(!run(`JSON.stringify(industryPreferenceGroups())`).includes('华南区域'));
const rules={schemaVersion:1,directionMatch:'any',dimensions:{natures:{groups:[{name:'Organizations',values:['Type A','Type B']}]},industries:{separator:'|',aliases:{'Source A':'Canonical A'},ignored:['Campaign'],groups:[{name:'Own domain',children:[{name:'Own subdivision',values:['Canonical A','Source B']}]}]},education:{groups:[],levels:{'Confirmed source degree':['硕士'],'Open requirement':[]}}}};
context.rules=rules;run('sourcePreferenceRules=rules');
assert.equal(run(`normalizePreference('Source A')`),'Canonical A');
assert.equal(run('industryPreferenceGroups()[0].children[0].values.length'),2);
assert.equal(run(`configuredPreferenceGroups('education')[0].values.length`),4);
run("preferences.industries=['Source A'];preferences.education=['硕士研究生']");
assert.equal(run(`matchesJobPreferences({'行业':'Source A|Source B','学历要求':'Confirmed source degree'})`),true);
assert.equal(run(`matchesJobPreferences({'行业':'Source B|Campaign','学历要求':'硕士'})`),false);
assert.equal(run(`matchesJobPreferences({'行业':'Source A','学历要求':'博士'})`),false);
assert.equal(run(`matchesJobPreferences({'行业':'Source A','学历要求':'MBA'})`),true);
assert.equal(run(`matchesJobPreferences({'行业':'Source A','学历要求':'Open requirement'})`),true);
run("preferences.natures=['Type A'];sourcePreferenceRules.directionMatch='all'");
assert.equal(run(`matchesJobPreferences({'性质':'Type B','行业':'Source A','学历要求':'硕士'})`),false);
assert.equal(run(`matchesJobPreferences({'性质':'Type A','行业':'Source A','学历要求':'硕士'})`),true);
run("preferences.natures=['Unknown saved'];preferences.industries=['Source A'];sourcePreferenceRules.directionMatch='any'");
assert.equal(run(`matchesJobPreferences({'性质':'Unknown','行业':'Source B','学历要求':'硕士'})`),false); // An inactive legacy dimension cannot bypass a known mismatch.
run("preferences.education=['本科及以上','MBA'];beginPreferenceDraft()");
controls=['本科','硕士','博士'].map(value=>({value}));
assert.deepEqual(Array.from(run(`readPreferenceChoices('prefEducation')`)),['本科及以上','MBA']);
controls=[{value:'硕士'}];
assert.deepEqual(Array.from(run(`readPreferenceChoices('prefEducation')`)),['硕士','MBA']);
assert.equal(run(`preferenceMatch('博士',readPreferenceChoices('prefEducation'),'education')`),false);
controls=[];assert.deepEqual(Array.from(run(`readPreferenceChoices('prefEducation')`)),['MBA']);
run("preferences.natures=[];preferences.industries=[];preferences.education=[]");assert.equal(run(`matchesJobPreferences({})`),true);
console.log('PASS defaults in empty workspace, hierarchy, source overrides, education ranges, special fallback, metadata, exact matching and lossless legacy choices');
