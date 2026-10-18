import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('miniprogram');
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    assert.equal(entry.isSymbolicLink(), false, '发布目录不通过链接引入外部牌桌');
    return entry.isDirectory() ? files(file) : [file];
  });
}
test('雀叙牌谱发布包只有线下记分页面，不保留隐藏联机入口或资源', () => {
  const app = JSON.parse(readFileSync(path.join(root, 'app.json')));
  const project = JSON.parse(readFileSync(path.join(root, 'project.config.json')));
  assert.equal(project.compileType, 'miniprogram');
  assert.equal(path.resolve(root, project.miniprogramRoot), root, '发布根目录不能包含联机档案');
  assert.equal(project.packOptions?.include?.length || 0, 0);
  assert.deepEqual(app.pages, ['pages/room/index', 'pages/quick/index', 'pages/fu/index',
    'pages/record/index', 'pages/me/index', 'pages/profile/index', 'pages/yaku/index']);
  assert.equal(app.subPackages?.length || app.subpackages?.length || 0, 0);
  assert.deepEqual(readdirSync(path.join(root, 'utils')).sort(),
    ['api.js', 'fu.js', 'invite.js', 'lookup.js', 'scoring.js', 'settlement-view.js', 'yaku.js']);
  for (const file of files(root)) {
    const relative = path.relative(root, file);
    assert.doesNotMatch(relative, /(?:^|[/\\])online(?:[-./\\]|$)|(?:^|[/\\])assets[/\\]/);
    if (/\.(js|wxml|wxss|json)$/.test(file)) {
      assert.doesNotMatch(readFileSync(file, 'utf8'),
        /\/api\/online|pages\/online|utils\/online|联机牌桌|<web-view|createOffscreenCanvas|WebGLRenderer/,
        relative);
    }
  }
  const room = readFileSync(path.join(root, 'pages/room/index.wxml'), 'utf8');
  assert.match(room, /扫码入桌/);
  assert.match(room, /记一局/);
  assert.match(room, /发送邀请/);
});
