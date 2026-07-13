import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMarketInsightRouter } from '../routes/marketInsight.js';

function appWith(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

async function get(app, path) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

test('serves fresh cache without generating', async () => {
  const router = createMarketInsightRouter({
    getSummary: async () => null,
    geminiConfigured: () => true,
    readMarketInsightCache: async () => ({
      hit: 'fresh',
      content: {
        en: { short7d: { title: 'A', body: 'Alpha beta gamma delta.' }, mid30d: { title: 'B', body: 'Alpha beta gamma delta.' }, long365d: { title: 'C', body: 'Alpha beta gamma delta.' } },
        zh_TW: { short7d: { title: '甲', body: '甲乙丙丁戊己庚辛。' }, mid30d: { title: '乙', body: '甲乙丙丁戊己庚辛。' }, long365d: { title: '丙', body: '甲乙丙丁戊己庚辛。' } },
        ja: { short7d: { title: '短期', body: '相場は安定して推移しました。' }, mid30d: { title: '中期', body: '相場は安定して推移しました。' }, long365d: { title: '長期', body: '相場は安定して推移しました。' } },
        ko: { short7d: { title: '단기', body: '시장은 지난 한 주 동안 안정적으로 움직였습니다.' }, mid30d: { title: '중기', body: '시장은 지난 한 주 동안 안정적으로 움직였습니다.' }, long365d: { title: '장기', body: '시장은 지난 한 주 동안 안정적으로 움직였습니다.' } },
      },
      ageMs: 1000,
    }),
    writeMarketInsightCache: async () => { throw new Error('should not write'); },
    generateMarketInsight: async () => { throw new Error('should not generate'); },
  });
  const { status, body } = await get(appWith(router), '/insight/market?locale=ja');
  assert.equal(status, 200);
  assert.equal(body.fromCache, true);
  assert.equal(body.content.short7d.title, '短期');
});

test('generates and stores fresh content when cache is cold', async () => {
  let wrote = null;
  const router = createMarketInsightRouter({
    getSummary: async () => ({
      label: 'Pokemon Index',
      value: 120,
      deltas: { d7: 0.01, d30: 0.02, d365: 0.2 },
      constituentCount: 10,
      updatedAt: '2026-07-13T00:00:00.000Z',
    }),
    geminiConfigured: () => true,
    readMarketInsightCache: async () => ({ hit: null, content: null, ageMs: null }),
    writeMarketInsightCache: async (day, content, meta) => { wrote = { day, content, meta }; },
    generateMarketInsight: async () => ({
      en: { short7d: { title: 'Short-term tone', body: 'The market moved higher this week. Breadth remains selective.' }, mid30d: { title: '30-day trend', body: 'The last month stayed positive overall. The pace is steadier than the weekly burst.' }, long365d: { title: 'Long-term backdrop', body: 'The 365-day curve is still constructive. The market remains above last year levels.' } },
      zh_TW: { short7d: { title: '短期氣氛', body: '本週市場走高。廣度仍偏集中。' }, mid30d: { title: '30日趨勢', body: '近一月整體仍為正向。節奏比單週脈衝更平穩。' }, long365d: { title: '長期背景', body: '365日曲線仍偏正向。市場仍高於去年水位。' } },
      ja: { short7d: { title: '短期トーン', body: '今週の市場は上向きでした。広がりはまだ限定的です。' }, mid30d: { title: '30日トレンド', body: '直近1か月は全体としてプラスでした。週次より落ち着いた伸びです。' }, long365d: { title: '長期の地合い', body: '365日の流れは依然として堅調です。市場は前年水準を上回っています。' } },
      ko: { short7d: { title: '단기 톤', body: '이번 주 시장은 상승했습니다. 다만 확산은 아직 제한적입니다.' }, mid30d: { title: '30일 추세', body: '지난 한 달은 전반적으로 플러스였습니다. 주간 급등보다 속도는 더 차분합니다.' }, long365d: { title: '장기 분위기', body: '365일 추세는 여전히 견조합니다. 시장은 작년 수준을 웃돌고 있습니다.' } },
    }),
  });
  const { status, body } = await get(appWith(router), '/insight/market?locale=ko');
  assert.equal(status, 200);
  assert.equal(body.fromCache, false);
  assert.equal(body.locale, 'ko');
  assert.equal(body.content.short7d.title, '단기 톤');
  assert.equal(wrote.meta.summary.label, 'Pokemon Index');
  assert.ok(wrote.day);
});
