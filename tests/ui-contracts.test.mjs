import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const main=readFileSync('main.tsx','utf8'),css=readFileSync('src/styles.css','utf8'),shell=readFileSync('src/ui/AppShell.tsx','utf8'),table=readFileSync('src/ui/ResponsiveTable.tsx','utf8'),client=readFileSync('src/supabase.ts','utf8');
test('one light theme, without decorative emoji or always-on realtime chrome',()=>{
 assert.match(css,/color-scheme: light/);assert.doesNotMatch(main,/setDarkMode|full-suite-dark|<PresenceIndicator|full-suite-statusbar/);
 assert.doesNotMatch(main,/[\u{1F000}-\u{1FAFF}]/u);
});
test('existing section title is clean while errors and field labels stay visible',()=>{
 const section=main.slice(main.indexOf('const FullSuiteSectionTitle'),main.indexOf('const FullSuiteBadge'));
 assert.doesNotMatch(section,/subtitle/);assert.match(main,/role="alert"/);assert.match(main,/htmlFor=\{controlId\}/);
});
test('sidebar uses real existing routes and mobile native dialog',()=>{
 assert.match(main,/<AppShell key=\{cacheScope\}/);assert.match(shell,/<aside/);assert.match(shell,/dialog.showModal\(\)/);assert.match(shell,/aria-controls="buymore-mobile-drawer"/);
 for(const id of ['production','dashboard','plan','analytics','factory','users','logs','settings','security'])assert.match(main,new RegExp(`id:'${id}'`));
});
test('uniform text scale excludes only the brand and increases for mobile',()=>{
 assert.match(css,/--buymore-type: \.875rem/);assert.match(css,/--buymore-type: 1rem/);assert.match(css,/\[data-brand\]/);assert.match(css,/min-height: 44px/);
});
test('mobile tables preserve one set of data and actions with header-derived labels',()=>{
 assert.match(table,/headers\[index\]/);assert.match(table,/'data-label'/);assert.match(table,/scope:'col'/);assert.match(css,/content: attr\(data-label\)/);
 assert.doesNotMatch(main,/<table\b/);assert.match(main,/<ResponsiveTable/);
});
test('all relevant Supabase reads go through cache while security identity comes from live profile and membership',()=>{
 assert.match(client,/global: \{fetch:cachedSupabaseFetch\}/);assert.match(main,/establishCacheIdentity/);assert.match(main,/loadFactoryAccess\(activeSession.user.id\)/);
 assert.match(main,/45_000/);assert.match(main,/clearPageCache\(\);setCacheNotice/);
});
test('database/Edge contracts are byte-identical to the supplied baseline',()=>{
 const hashes=JSON.parse(readFileSync('docs/UI_BASELINE_SERVER_HASHES.json','utf8'));
 return import('node:crypto').then(({createHash})=>{for(const [path,hash]of Object.entries(hashes))assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),hash,path);});
});
test('private root views clear before paint and late log responses cannot cross cache scopes',()=>{
 assert.match(main,/React\.useLayoutEffect\(\(\)=>\{[\s\S]*?\+\+logsRequestRef\.current[\s\S]*?setRecords\(\[\]\)[\s\S]*?\},\[cacheScope\]\)/);
 assert.match(main,/requestScope!==pageCache\.getScope\(\)\|\|request!==logsRequestRef\.current/);
 assert.match(main,/if\(!cacheScope\|\|!session\?\.user\?\.id\|\|!profile\?\.is_active\)return/);
});
test('existing chart series type remains declared after shared style changes',()=>{
 assert.match(main,/type AnalyticsSeriesItem\s*=\s*\{\s*label:\s*string;\s*value:\s*number/);
});
