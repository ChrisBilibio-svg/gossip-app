import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const socialSource = readFileSync(new URL('../src/lib/social.ts', import.meta.url), 'utf8');

test('SocialRepost exposes denormalized replyCount', () => {
  assert.match(socialSource, /export\s+interface\s+SocialRepost\s*{[\s\S]*replyCount:\s*number;/);
  assert.match(socialSource, /interface\s+SocialRepostRow\s*{[\s\S]*reply_count:\s*number;/);
  assert.match(socialSource, /replyCount:\s*row\.reply_count/);
});

test('social lib can read repost replies with handles newest first', () => {
  assert.match(socialSource, /export\s+interface\s+SocialRepostReply\s*{/);
  assert.match(socialSource, /export\s+async\s+function\s+getRepostReplies\s*\(\s*repostId:\s*string\s*\)/);
  assert.match(socialSource, /\.from\(\s*'social_repost_replies'\s*\)[\s\S]*\.eq\(\s*'repost_id'\s*,\s*repostIdResult\.value!\s*\)[\s\S]*\.order\(\s*'created_at'\s*,\s*{\s*ascending:\s*false\s*}\s*\)/);
  assert.match(socialSource, /\.from\(\s*'profiles'\s*\)\.select\(\s*'id, handle, avatar'\s*\)/);
});

test('social lib validates repost replies before inserting', () => {
  assert.match(socialSource, /export\s+async\s+function\s+createRepostReply\s*\(\s*repostId:\s*string\s*,\s*body:\s*string\s*\)/);
  assert.match(socialSource, /validateUuid\s*\(\s*repostId\s*,\s*'Repost'\s*\)/);
  assert.match(socialSource, /validateUserText\s*\(\s*body\s*,\s*{\s*max:\s*280,\s*label:\s*'Resposta'\s*}\s*\)/);
  assert.match(socialSource, /if\s*\(\s*!bodyResult\.ok\s*\)\s*return\s*{\s*ok:\s*false/);
  assert.match(socialSource, /\.from\(\s*'social_repost_replies'\s*\)\.insert\(\s*{\s*repost_id:\s*repostIdResult\.value!,\s*body:\s*bodyResult\.value!\s*}\s*\)/);
});
