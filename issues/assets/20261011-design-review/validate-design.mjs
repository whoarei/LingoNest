// Run: node validate-design.mjs <design.md> <temporary-output-directory> [baseline.md]
// Checks document artifacts, not an implemented application or a full JSON Schema.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const [designArg, outputArg, baselineArg] = process.argv.slice(2);
assert(designArg && outputArg, 'Provide design and temporary output paths');
const designPath = path.resolve(designArg);
const outputPath = path.resolve(outputArg);
fs.mkdirSync(outputPath, { recursive: true });
const text = fs.readFileSync(designPath, 'utf8').replace(/\r\n/g, '\n');
const blocks = [...text.matchAll(/^```([^\n]*)\n([\s\S]*?)^```\s*$/gm)]
  .map(match => ({ language: match[1].trim(), source: match[2].trim() }));
assert.equal((text.match(/^```/gm) ?? []).length, blocks.length * 2, 'Unbalanced code fences');
const jsonBlocks = blocks.filter(block => block.language === 'json').map(block => JSON.parse(block.source));
const pkg = jsonBlocks.find(value => value.packageId);
assert(pkg, 'Lesson sample missing');
assert.equal(pkg.schemaVersion, '2.0.0');
assert.equal(pkg.status, 'draft');
assert.equal(pkg.completeness, 'sample');
assert(pkg.validation.publishBlockers.length > 0);
assert(pkg.assets.some(asset => asset.state === 'pending'));

for (const name of ['assets', 'scenes', 'turns', 'sentences', 'knowledgePoints', 'exercises', 'stages', 'gradingPolicies']) {
  assert.equal(new Set(pkg[name].map(value => value.id)).size, pkg[name].length, `Duplicate ${name} IDs`);
}
const hasId = (name, id) => pkg[name].some(value => value.id === id);
for (const sentence of pkg.sentences) {
  assert(hasId('turns', sentence.turnId));
  for (const ref of sentence.sourceRefs) {
    if (ref.kind === 'image') assert(pkg.assets.some(asset => asset.id === ref.assetId && asset.kind === 'source_image'));
    else assert(pkg.sourceDocuments.some(doc => doc.id === ref.sourceDocumentId && doc.version === ref.version && doc.paragraphs.some(p => p.id === ref.paragraphId)));
  }
}
for (const kp of pkg.knowledgePoints) {
  assert(kp.semanticVersion);
  for (const id of kp.prerequisiteIds) assert(hasId('knowledgePoints', id));
  for (const req of kp.requirements) assert(['two_families', 'cross_day_sessions'].includes(req.independence));
}
for (const exercise of pkg.exercises) {
  assert(hasId('gradingPolicies', exercise.gradingPolicyId));
  assert(Array.isArray(exercise.exposureMappings));
}
for (const mapping of pkg.evidenceMappings) {
  assert(hasId('exercises', mapping.exerciseId));
  assert(pkg.knowledgePoints.some(kp => kp.id === mapping.knowledgeId && kp.requirements.some(req => req.ability === mapping.ability && req.mode === mapping.mode)));
}
for (const stage of pkg.stages) {
  assert(!Object.hasOwn(stage, 'passThreshold'), 'Duplicate stage grading authority');
  for (const id of [...stage.exerciseIds, ...stage.completion.checkExerciseIds]) assert(hasId('exercises', id));
  for (const id of stage.prerequisiteStageIds) assert(hasId('stages', id));
  for (const ref of stage.completion.requiredCellRefs) assert(pkg.knowledgePoints.some(kp => kp.id === ref.knowledgeId && kp.requirements.some(req => req.ability === ref.ability && req.mode === ref.mode)));
}

let imageHashes = 0;
for (const asset of pkg.assets.filter(asset => asset.kind === 'source_image')) {
  const contents = fs.readFileSync(path.resolve(path.dirname(designPath), asset.path));
  assert.equal(crypto.createHash('sha256').update(contents).digest('hex'), asset.sha256);
  imageHashes++;
}
let checkedLinks = 0;
for (const [, target] of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
  if (/^https?:\/\//.test(target)) continue;
  if (target.startsWith('#')) assert(text.includes(`id="${target.slice(1)}"`), `Missing anchor ${target}`);
  else assert(fs.existsSync(path.resolve(path.dirname(designPath), target.split('#')[0])), `Missing link ${target}`);
  checkedLinks++;
}
if (baselineArg) {
  const original = fs.readFileSync(baselineArg, 'utf8').replace(/\r\n/g, '\n');
  for (const firstTurn of ['t01', 't06', 't12']) {
    const expression = new RegExp('```text\\n(' + firstTurn + '[\\s\\S]*?)\\n```');
    assert.equal(expression.exec(text)?.[1], expression.exec(original)?.[1], `Source dialogue changed: ${firstTurn}`);
  }
}

const ts = blocks.filter(block => block.language === 'typescript').map(block => block.source).join('\n\n');
const compileRequest = jsonBlocks.find(value => value.reviewedTranscriptId);
const jointTypes = ts + '\n\nconst samplePackage: LessonPackage = ' + JSON.stringify(pkg, null, 2) + ';\n' +
  'const sampleCompileConfig: CompileConfig = ' + JSON.stringify(compileRequest.config, null, 2) + ';\n';
fs.writeFileSync(path.join(outputPath, 'contracts-and-sample.ts'), jointTypes);

const ddl = blocks.find(block => block.language === 'sql')?.source;
assert(ddl, 'Core SQL missing');
const db = new DatabaseSync(':memory:');
db.exec(ddl);
assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
let sqlChecks = 0;
const insert = (table, row) => db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
const reject = (action, description) => { assert.throws(action, /constraint failed/i, description); sqlChecks++; };
for (const id of ['A', 'B']) insert('learners', { id, nickname: id, timezone: 'Asia/Shanghai', state: 'active' });
for (const [learner, packageId] of [['A', 'P'], ['B', 'Q']]) {
  insert('package_versions', {package_id:packageId,version:'1',schema_version:'2.0.0',sha256:'a'.repeat(64),payload_json:'{}'});
  insert('learner_packages', {learner_id:learner,package_id:packageId,package_version:'1'});
  insert('exercise_index',{package_id:packageId,package_version:'1',exercise_id:'ex',payload_json:'{}'});
  insert('sessions',{learner_id:learner,id:'s'+learner,package_id:packageId,package_version:'1',cursor_json:'{}',state:'active'});
}
const attempt = {learner_id:'A',id:'a1',session_id:'sA',package_id:'P',package_version:'1',exercise_id:'ex',client_event_id:'c1',request_hash:'h1',submitted_at:'2026-10-11T02:00:00Z',payload_json:'{}'};
insert('attempts', attempt);
reject(() => insert('attempts',{...attempt,id:'wrong-owner',learner_id:'B',client_event_id:'other'}),'Cross learner session');
reject(() => insert('attempts',{...attempt,id:'wrong-package',package_id:'Q',client_event_id:'other'}),'Cross package session');
reject(() => insert('attempts',{...attempt,id:'duplicate'}),'Duplicate client event');
insert('attempts',{...attempt,id:'a2',client_event_id:'c2'});
const grade = {learner_id:'A',id:'g1',attempt_id:'a1',evaluation_key:'pending',status:'needs_review',score:null,passed:null,critical_checks_passed:null,payload_json:'{}'};
insert('grade_results',grade);
reject(() => insert('grade_results',{...grade,id:'bad-score',evaluation_key:'bad1',score:0}),'Null grade must not have score');
reject(() => insert('grade_results',{...grade,id:'bad-pass',evaluation_key:'bad2',status:'scored',score:100,passed:1,critical_checks_passed:0}),'Critical failure cannot pass');
reject(() => insert('grade_results',{...grade,id:'duplicate-evaluation'}),'Repeated evaluation key');
insert('grade_results',{...grade,id:'g2',evaluation_key:'auto',status:'scored',score:100,passed:1,critical_checks_passed:1});
insert('grade_results',{...grade,id:'g3',attempt_id:'a2'});
insert('review_decisions',{learner_id:'A',id:'r1',grade_id:'g1',attempt_id:'a1',payload_json:'{}'});
insert('active_evaluations',{learner_id:'A',attempt_id:'a1',grade_id:'g1',review_decision_id:'r1'});
reject(() => db.prepare("UPDATE active_evaluations SET grade_id='g3',review_decision_id=NULL WHERE attempt_id='a1'").run(),'Wrong attempt grade');
reject(() => db.prepare("UPDATE active_evaluations SET grade_id='g2' WHERE attempt_id='a1'").run(),'Review must bind exact grade');

for (const [namespace,version] of [['P','1'],['Q','1'],['P','2']]) {
  insert('knowledge_catalog',{knowledge_namespace:namespace,knowledge_id:'same-local-id',semantic_version:version,definition_hash:'b'.repeat(64),payload_json:'{}'});
  insert('skill_states',{learner_id:'A',knowledge_namespace:namespace,knowledge_id:'same-local-id',semantic_version:version,ability:'spelling',mode:'prompted_word',policy_version:'mastery-2',last_applied_event_seq:0,replay_epoch:0,payload_json:'{}'});
}
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM skill_states').get().count,3);
sqlChecks++;
reject(() => insert('review_states',{learner_id:'A',knowledge_namespace:'P',knowledge_id:'same-local-id',semantic_version:'3',ability:'spelling',mode:'prompted_word',due_at:'2026-10-12T02:00:00Z',replay_epoch:0,payload_json:'{}'}),'Review semantic version FK');
insert('policy_bundles',{version:'bundle-2',payload_json:'{}'});
const event={learner_id:'A',seq:1,event_id:'e1',type:'attempt_submitted',event_schema_version:'2.0.0',replay_epoch:0,occurred_at:'2026-10-11T02:00:00Z',policy_bundle_version:'bundle-2',payload_json:'{}'};
insert('learning_events',event);
reject(() => insert('learning_events',{...event,event_id:'duplicate-seq'}),'Sequence is unique');
reject(() => insert('purge_boundaries',{learner_id:'A',id:'bad-boundary',previous_epoch:0,new_epoch:2,payload_json:'{}'}),'Epoch cannot skip');
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
const summary={jsonBlocks:jsonBlocks.length,typescriptBlocks:blocks.filter(b=>b.language==='typescript').length,imageHashes,localLinksAndAnchors:checkedLinks,sqlTables:db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'").get().count,sqlConstraintChecks:sqlChecks,dialogueUnchanged:baselineArg?true:null,sampleFlagsAndBlockersPreserved:true};
db.close();
fs.writeFileSync(path.join(outputPath,'validation-summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
