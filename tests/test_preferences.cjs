/* Source-specific matching and lossless saved choices; synthetic vocabulary only. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../app/投递管理.html'),'utf8');
for(const [i,script] of [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].entries())new vm.Script(script[1],{filename:`inline-${i}`});
const block=html.slice(html.indexOf('// Canonical display labels'),html.indexOf('// One fixed entry point'));
const controls=[];
const context=vm.createContext({document:{addEventListener(){},querySelectorAll(){return controls;}},data:[{'行业':'Source A/Source B'},{'行业':'Unknown'}],preferences:{natures:[],industries:['Source A'],education:[]}});
vm.runInContext(block,context);const run=s=>vm.runInContext(s,context);
// No universal meanings or groupings are invented before initialization.
assert.equal(run(`normalizePreference('本科及研究生','education')`),'本科及研究生');
assert.equal(run(`normalizePreference('大专及以上','education')`),'大专及以上');
assert.equal(run(`normalizePreference('民企','nature')`),'民企');
assert.equal(run(`normalizePreference('Source A\u200b','industry')`),'Source A');
assert.equal(run('industryPreferenceGroups()[0].name'),'原始词条 · 待整理');
assert.equal(run(`matchesJobPreferences({'行业':'Unknown','学历要求':'Special'})`),true);
const rules={schemaVersion:1,directionMatch:'any',dimensions:{natures:{groups:[{name:'Organizations',values:['Type A','Type B']}]},industries:{separator:'/',aliases:{'Source A':'Canonical A'},groups:[{name:'Category A',values:['Canonical A']},{name:'Category B',values:['Source B']}]},education:{aliases:{'Threshold alias':'Threshold A'},groups:[{name:'Confirmed requirements',values:['Threshold A','Threshold B']}]}}};
context.rules=rules;run('sourcePreferenceRules=rules');
assert.equal(run(`normalizePreference('Source A')`),'Canonical A');
const groups=run('industryPreferenceGroups()');assert.equal(groups[0].values[0].label,'Canonical A');assert.equal(groups[1].values[0].label,'Source B');assert.equal(groups[2].values[0].label,'Unknown');
assert.equal(run(`matchesJobPreferences({'行业':'Source A/Source B'})`),true);
assert.equal(run(`matchesJobPreferences({'行业':'Source B'})`),false);
assert.equal(run(`matchesJobPreferences({'行业':'Canonical A extended'})`),true); // unmapped, not a substring match
assert.equal(run(`preferenceMatch('Canonical A extended',['Source A'],'industry')`),null);
run("preferences.education=['Threshold A']");
assert.equal(run(`matchesJobPreferences({'行业':'Source A','学历要求':'Threshold alias'})`),true);
assert.equal(run(`matchesJobPreferences({'行业':'Source A','学历要求':'Threshold B'})`),false);
assert.equal(run(`matchesJobPreferences({'行业':'Source A','学历要求':'Unclear qualification'})`),true);
run("preferences.natures=['Type A'];sourcePreferenceRules.directionMatch='all'");
assert.equal(run(`matchesJobPreferences({'性质':'Type B','行业':'Source A'})`),false);
assert.equal(run(`matchesJobPreferences({'性质':'Type A','行业':'Source A'})`),true);
run("preferences.natures=[];preferences.industries=[];preferences.education=[]");assert.equal(run(`matchesJobPreferences({})`),true);
const alias=run(`preferenceEntries(['Source A','Canonical A'],['Source A'],'industry')`);assert.equal(alias.length,1);
controls.push({dataset:{original:JSON.stringify(alias[0].original),aliases:JSON.stringify(alias[0].aliases)}});
assert.deepEqual(Array.from(run(`readPreferenceChoices('fixture')`)),['Source A']);
controls[0].dataset.original='[]';assert.deepEqual(Array.from(run(`readPreferenceChoices('fixture')`)),['Source A','Canonical A']);
console.log('PASS source initialization, unknown retention, exact matching, configurable groups, qualification boundaries and lossless choices');
