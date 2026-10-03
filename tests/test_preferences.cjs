/* Pure matching and round-trip regression checks; no personal records or running server. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../app/投递管理.html'),'utf8');
for(const [i,script] of [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].entries())new vm.Script(script[1],{filename:`inline-${i}`});
const block=html.slice(html.indexOf('// Canonical display labels'),html.indexOf('// One fixed entry point'));
const controls=[];
const context=vm.createContext({document:{addEventListener(){},querySelectorAll(){return controls;}},data:[{'行业':'城市商业银行/企业战略规划/电子商务/投融资\u200b/升学规划/AI药物研发/无法识别的业务词'}],preferences:{industries:['投融资','历史偏好词']}});
vm.runInContext(block,context);
const run=s=>vm.runInContext(s,context);
for(const [input,kind,expected] of [['大专及以上','education','专科及以上'],['本科及研究生','education','本科及以上'],['硕士研究生及以上','education','硕士及以上'],['研究生','education','研究生'],['本科','education','本科'],['民企','nature','民营企业'],['央国企','nature','央国企'],['投融资\u200b','industry','投融资']])assert.equal(run(`normalizePreference(${JSON.stringify(input)},${JSON.stringify(kind)})`),expected);
assert.equal(run(`normalizePreference('分岗位：本科、MBA或博士','education')`),'分岗位:本科、MBA或博士');
const groups=run('industryPreferenceGroups()'),groupFor=label=>groups.find(g=>g.values.some(e=>e.label===label))?.name;
assert.equal(groupFor('城市商业银行'),'银行、金融与投资');assert.equal(groupFor('企业战略规划'),'专业与企业服务');assert.equal(groupFor('升学规划'),'教育、科研与出版');assert.equal(groupFor('电子商务'),'消费、零售与贸易');assert.equal(groupFor('AI药物研发'),'医药、医疗与健康');assert.equal(groupFor('无法识别的业务词'),'跨行业与待核实');assert.equal(groupFor('历史偏好词'),'跨行业与待核实');
const alias=run(`preferenceEntries(['大专及以上','专科及以上'],['大专及以上'],'education')`);assert.equal(alias.length,1);
controls.push({dataset:{original:JSON.stringify(alias[0].original),aliases:JSON.stringify(alias[0].aliases)}});
assert.deepEqual(Array.from(run(`readPreferenceChoices('fixture')`)),['大专及以上']); // Unchanged UI preserves the saved spelling.
controls[0].dataset.original='[]';assert.deepEqual(Array.from(run(`readPreferenceChoices('fixture')`)),['大专及以上','专科及以上']); // A new choice covers both source spellings.
console.log('PASS inline syntax, aliases, distinct thresholds, ambiguous categories, legacy choices and save round-trip');
