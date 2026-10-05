/* Shared Markdown tables: readable measures, semantic cells and lossless parsing. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../app/投递管理.html'),'utf8');
const context=vm.createContext({esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')});
vm.runInContext(html.slice(html.indexOf('function mdInline('),html.indexOf('// Preparation attachments resolve')),context);
const cells=row=>Array.from(context.mdTableCells(row));
assert.deepEqual(cells('| A | B |'),['A','B']);
assert.deepEqual(cells('| A\\|B | `C|D` |'),['A|B','`C|D`']);
assert.deepEqual(cells('| A | ``C`|D`` |'),['A','``C`|D``']);
assert.deepEqual(cells('| unmatched ` | B |'),['unmatched `','B']);
assert.deepEqual(cells('| A | B\\|'),['A','B|']);
const widths=md=>[...context.renderMd(md).matchAll(/<col style="width:([\d.]+)%">/g)].map(m=>Number(m[1]));
const middle=['| 项目 | 说明 | 结果 |','| --- | --- | --- |','| A | '+ '需要核对事实并保留完整信息。'.repeat(6)+' | 已核对 |'].join('\n');
const w=widths(middle);assert.equal(w.length,3);assert(w[1]>w[0]*3 && w[1]>w[2]*3);
const moved=['| 项目 | 结果 | 说明 |','| --- | --- | --- |','| A | 已核对 | '+ '需要核对事实并保留完整信息。'.repeat(6)+' |'].join('\n');
assert.deepEqual(widths(moved),[w[0],w[2],w[1]]); // Content determines width, not column position.
const linked=widths('| 项目 | 资料 |\n| --- | --- |\n| A | [原文](https://example.com/'+ 'path/'.repeat(60)+') |');
assert.deepEqual(linked,[50,50]); // Hidden URL length must not distort the column measure.
const dated=widths('| 标签 | 日期 |\n| --- | --- |\n| A | 2026-10-05 |');
assert(dated[1]>dated[0]); // Short dates and labels need enough width to stay intact.
const table=context.renderMd('| 标题 | 数量 | 说明 |\n| :--- | ---: | :---: |\n| A\\|B | 25 | **完整** |\n| C | 3 |');
assert.equal((table.match(/<th scope="col"/g)||[]).length,3);
assert.equal((table.match(/<td /g)||[]).length,6);
assert(table.includes('text-align:right">25'));
assert(table.includes('text-align:center"><strong>完整</strong>'));
assert(table.includes('>A|B</td>'));
assert(table.includes('role="region"') && table.includes('tabindex="0"'));
assert.equal((context.renderMd('| A |\n| --- |\n| B | extra |').match(/<td /g)||[]).length,2); // Keep malformed extra source cells.
const escaped=context.renderMd('| A |\n| --- |\n| <script>alert(1)</script> |');
assert(!escaped.includes('<script>'));assert(escaped.includes('&lt;script&gt;'));
const blocks=context.renderMd('正文\n\n'+middle+'\n\n> '+middle.replace(/\n/g,'\n> ')+'\n\n```\n| a | b |\n```');
assert.equal((blocks.match(/<table class="md-table"/g)||[]).length,2);
assert(blocks.includes('<pre class="md-pre">'));
for(const [i,script] of [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].entries())new vm.Script(script[1],{filename:`inline-${i}`});
console.log('PASS Markdown column measures, escaped/code pipes, alignment, uneven rows, HTML escaping, nested quotes and scripts');
