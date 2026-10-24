import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
const out='/private/tmp/bukatsu-mock-check'
for (const name of ['types','data/repository','data/mock/mockRepository','data/mock/seed','lib/equipment','lib/joinCode']) {
 const target=path.join(out,name+'.js');fs.mkdirSync(path.dirname(target),{recursive:true})
 const source=fs.readFileSync('src/'+name+'.ts','utf8')
 const result=ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}).replace(/(from ['"])(\.[^'"]+)(['"])/g,'$1$2.js$3')
 fs.writeFileSync(target,result)
}
fs.writeFileSync(out+'/package.json','{"type":"module"}')
const storage=new Map()
globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}
globalThis.window={addEventListener(){}}
const {createMockRepository}=await import(out+'/data/mock/mockRepository.js')
const repo=createMockRepository()
const read=(subscribe)=>new Promise(resolve=>{const off=subscribe(value=>{off();resolve(value)})})
await repo.auth.signIn('member@example.com','Bukatsu#2026')
const second=await repo.teams.create('第二チーム','別の名前')
let profile=await read(cb=>repo.users.subscribeProfile('u-member',cb))
assert.deepEqual(profile.teamIds,['team-sample',second])
await assert.rejects(repo.teams.join('K7MPX2QA','上書き'),/すでに/)
await repo.users.updateDisplayName(second,'変更後')
let members=await read(cb=>repo.teams.subscribeMembers('team-sample',cb))
assert.equal(members.find(m=>m.uid==='u-member').displayName,'佐藤 花子')
await repo.teams.select('team-sample')
await repo.users.updateDisplayName('team-sample','第一の名前')
let items=await read(cb=>repo.equipment.subscribe('team-sample',cb))
assert.equal(items.find(i=>i.id==='eq-1').holderName,'第一の名前')
await repo.teams.leave('team-sample')
profile=await read(cb=>repo.users.subscribeProfile('u-member',cb))
assert.deepEqual(profile.teamIds,[second]);assert.equal(profile.teamId,second)
await repo.teams.join('K7MPX2QA','再参加名')
await assert.rejects(repo.teams.create('空白名','   '))
await repo.auth.signOut();await repo.auth.signIn('member@example.com','Bukatsu#2026')
const loaded=createMockRepository()
profile=await read(cb=>loaded.users.subscribeProfile('u-member',cb))
assert.equal(profile.teamIds.length,2)
// 旧データからの移行で用具・メンバー名を維持する。
const legacy=JSON.parse(storage.get('bukatsu:mock-db:v2'))
for(const user of Object.values(legacy.users)) delete user.teamIds
storage.set('bukatsu:mock-db:v2',JSON.stringify(legacy))
const migrated=createMockRepository()
profile=await read(cb=>migrated.users.subscribeProfile('u-member',cb))
assert.equal(profile.teamIds.length,2)
console.log('PASS: 複数所属、重複参加拒否、名前分離、用具名同期、離脱、再参加、保存復元、旧データ移行')
