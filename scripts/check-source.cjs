/* Structural inspection only. Full type checking remains `npm run typecheck`. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
let ts;
try { ts=require('typescript'); }
catch { ts=require(path.join(require('node:child_process').execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript')); }
const root=process.cwd();const errors=[];const checks=[];
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);}
const files=['main.tsx','vite.config.ts',...walk('src'),...walk('supabase/functions'),...walk('legacy')].filter(f=>/\.(tsx?|m?js)$/.test(f));
const parsed=new Map();
function localImportExists(file,specifier){
 const base=path.resolve(path.dirname(file),specifier);
 return [base,base+'.ts',base+'.tsx',base+'.js',base+'.mjs',base+'.d.ts',path.join(base,'index.ts'),path.join(base,'index.tsx'),base.replace(/\.js$/,'.ts')].some(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
}
for(const file of files){
 const text=fs.readFileSync(file,'utf8');const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:file.endsWith('.ts')?ts.ScriptKind.TS:ts.ScriptKind.JS);parsed.set(file,sf);
 for(const d of sf.parseDiagnostics){const p=sf.getLineAndCharacterOfPosition(d.start||0);errors.push(`${file}:${p.line+1}:${p.character+1} ${ts.flattenDiagnosticMessageText(d.messageText,' ')}`);}
 const topNames=new Set();
 for(const node of sf.statements){
   const names=[];if((ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node))&&node.name)names.push(node.name.text);
   if(ts.isVariableStatement(node))for(const d of node.declarationList.declarations)if(ts.isIdentifier(d.name))names.push(d.name.text);
   for(const name of names){if(topNames.has(name))errors.push(`${file}: duplicate top-level declaration ${name}`);topNames.add(name);}
 }
 function visit(node){
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)){
    const value=node.moduleSpecifier.text;if(value.startsWith('.')&&!localImportExists(file,value))errors.push(`${file}: missing local import ${value}`);
  }
  ts.forEachChild(node,visit);
 }
 visit(sf);
 if(/\beyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text))errors.push(`${file}: literal JWT found`);
}
checks.push(`${files.length} TypeScript/TSX/JavaScript source files parsed; local static imports inspected.`);
const main=fs.readFileSync('main.tsx','utf8');
for(const token of ['AnalyticsLineChart','trendSeries','bestOperator','operatorSeries','top_operators'])if(main.includes(token))errors.push(`Forbidden analysis symbol: ${token}`);
if(/SUPABASE_SERVICE_ROLE_KEY/.test(fs.readFileSync('src/supabase.ts','utf8')))errors.push('Service key referenced in browser client');
const sql=fs.readFileSync('supabase/migrations/20260921000100_production_workflow.sql','utf8');
const routines=[...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(buymore_\w+)\(/g)].map(m=>m[1]);
if(new Set(routines).size!==routines.length)errors.push('Duplicate workflow routine definition');
const expectedRpcs=new Set([...files.filter(f=>!f.startsWith('legacy/')).flatMap(f=>[...fs.readFileSync(f,'utf8').matchAll(/['"](buymore_\w+)['"]/g)].map(m=>m[1]))].filter(n=>!['buymore_user_factories','buymore_dark_mode'].includes(n)));
for(const name of expectedRpcs)if(!routines.includes(name))errors.push(`Missing migration RPC: ${name}`);
for(const tag of new Set(sql.match(/\$[A-Za-z_][A-Za-z_0-9]*\$/g)||[]))if(sql.split(tag).length%2!==1)errors.push(`Unbalanced SQL dollar quote: ${tag}`);
if(/\bDROP\s+(TABLE|DATABASE)\b/i.test(sql))errors.push('Destructive table/database operation found');
checks.push(`${routines.length} unique workflow routine definitions; ${expectedRpcs.size} referenced names found in SQL. This is NOT PostgreSQL syntax/execution validation.`);
function declaration(sf,name){for(const node of sf.statements){if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&d.name.text===name))return node.getText(sf);if(ts.isFunctionDeclaration(node)&&node.name?.text===name)return node.getText(sf);}return '';}
for(const name of ['Card','Button','FullSuiteSectionTitle','FullSuiteInput','FullSuiteStat','FullSuiteModal'])if(!declaration(parsed.get('main.tsx'),name))errors.push(`Missing existing shared component: ${name}`);
for(const token of ['setDarkMode','full-suite-dark','<PresenceIndicator','full-suite-statusbar'])if(main.includes(token))errors.push(`Removed UI returned: ${token}`);
if(!main.includes('<AppShell')||!main.includes('<ResponsiveTable'))errors.push('Responsive shell/table integration missing');
checks.push('Existing shared component names retained; authorized UI revision uses AppShell and ResponsiveTable. Historical text hashes are not a current design requirement.');
for(const file of ['.env.example','public/manifest.webmanifest','public/production-sw.js','public/icon.svg','public/robots.txt','README_DEPLOYMENT.md','CHANGELOG.md'])if(!fs.existsSync(file))errors.push(`Missing release file: ${file}`);
const report={created_at:new Date().toISOString(),status:errors.length?'FAIL':'PASS',checks,errors,limitations:['Dependencies, complete TypeScript semantics, bundler execution, PostgreSQL execution, real Auth/RLS, and rendered visual comparison are separate checks.']};
fs.mkdirSync('docs/qa-ui',{recursive:true});fs.writeFileSync('docs/qa-ui/source-check.json',JSON.stringify(report,null,2)+'\n');
for(const item of checks)console.log(item);for(const item of errors)console.error(item);console.log(`Structural source checks: ${report.status}`);process.exitCode=errors.length?1:0;
