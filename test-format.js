#!/usr/bin/env node
/**
 * vocab-curator 출력 형식 일관성 테스트
 * - 서로 다른 프로필 5개로 /api/generate 호출
 * - 매 호출마다 "## 프로필 해석", "## CSV", "## 오늘의 3단어" 3개 헤딩 있는지
 * - 프로필 해석 3줄 이상 있는지 체크
 * 
 * 실행:
 *   PORT=3000 node test-format.js                    (로컬 서버)
 *   SERVER_URL=https://foxibu.is-a.dev:5555 node test-format.js  (배포 서비스)
 */

const http = require('http');

// 설정 — 필요에 따라 변경
const CONFIG = {
  serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
  timeout: 90 * 1000,
  numTests: 5
};

const TEST_CASES = [
  {
    name: "테스트 1: 버거집 워홀러 (원래 예시)",
    profile: "미국 버거집에서 알바 준비 중인 워홀러. 카운터에서 손님 응대할 때 쓸 표현을 중심으로 영어를 익히고 싶다. patty, grill 같은 재료·요리 용어보다 주문 받거나 계산할 때 실제로 입에서 나오는 말을 우선적으로 알고 싶다. For here or to go? / Do you want to make that a combo? / That will be $8.50 같은 표현을 내일 바로 써야 한다.",
    sourceText: "I am on grill today, so you take register. For here or to go? Do you want to make that a combo? That will be $8.50, and here is your change. Want to add a drink to that? The combo comes with fries and a drink."
  },
  {
    name: "테스트 2: JLPT N2 학생 (드라마 자막)",
    profile: "JLPT N2 막 시작한 학생. 좋아하는 일본 드라마 자막으로 공부 중. N5~N4에서 이미 뗀 단어는 걸러내고, N2 언저리에서 실제로 걸리는 것들만 알고 싶다. 시험 독해 지문이나 격식 있는 문어체에서 같은 단어가 어떤 얼굴로 나오는지 궁금하다.",
    sourceText: "そう言えば、申し込みの期限が来週末までだった。手続きを怠ると、来年度の研修が受けられなくなる見込みだ。上司には、そんな簡単なこともできないのかと reassigned されるわけにはいかない。"
  },
  {
    name: "테스트 3: 여행 목적 일본어 초보 (공항·카페)",
    profile: "일본어 초보, 여행 목적. 공항, 카페, 교통에서 쓸 말을 우선적으로 알고 싶다. 문법 설명보다는 실제 상황에서 바로 쓸 수 있는 표현이 좋다.",
    sourceText: "スミスさん、こんにちは。いまから搭乗手続きをしますので、パスポートと搭乗券を見せてください。荷物をお預かりしましょうか？機内食は牛丼とサンドイッチからお選びいただけます。"
  },
  {
    name: "테스트 4: 토익 800 목표 직장인 (이메일·회의)",
    profile: "토익 800 목표인 직장인. 이메일, 회의, 발표에서 쓸 비즈니스 영어 표현을 중점적으로 익히고 싶다. 문법 설명보다는 실제 비즈니스 상황에서 바로 쓸 수 있는 표현이 좋다.",
    sourceText: "Dear Mr. Johnson, I am writing to follow up on our meeting last week. As discussed, please find attached the proposed timeline for the project. Could you please review and let me know if there are any concerns? I would be happy to schedule a call to discuss further."
  },
  {
    name: "테스트 5: DELF A2 준비 프랑스어 학습자 (여행·일상)",
    profile: "DELF A2 준비 중인 프랑스어 학습자. 여행과 일상에서 바로 쓸 수 있는 표현을 중심으로 익히고 싶다. 문법 설명보다는 실제 상황 예문이 좋다.",
    sourceText: "Bonjour, je voudrais un café serré s'il vous plaît. Avec du lait chaud ? Non merci, je prends un chocolat chaud. C'est combien ? Ça fait 3 euros 50. Voici mon billet. Merci beaucoup, bonne journée !"
  }
];

function log(msg) {
  console.log(msg);
}

function makeRequest(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(CONFIG.serverUrl + path);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: CONFIG.timeout
      },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTest(test) {
  log(`▶ ${test.name}`);
  try {
    const res = await makeRequest('/api/generate', {
      profile: test.profile,
      sourceText: test.sourceText
    });
    
    if (res.status !== 200) {
      log(`  ❌ HTTP ${res.status} — ${JSON.stringify(res.body).substring(0, 200)}`);
      return { name: test.name, success: false, httpStatus: res.status, headings: [], profileLinesCount: 0, error: `HTTP ${res.status}` };
    }
    
    const data = res.body;
    const result = data.result || '';
    const lines = result.split('\n');
    
    // 헤딩 추출
    const headings = [];
    let inProfile = false;
    let profileLines = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('## ')) {
        headings.push(trimmed);
        if (trimmed === '## 프로필 해석') {
          inProfile = true;
        } else if (inProfile && trimmed !== '## 프로필 해석') {
          inProfile = false;
        }
        continue;
      }
      if (inProfile && trimmed && !trimmed.startsWith('```')) {
        profileLines.push(trimmed);
      }
    }
    
    const hasProfile = headings.includes('## 프로필 해석');
    const hasCsv = headings.includes('## CSV');
    const hasToday = headings.includes('## 오늘의 3단어');
    const headingsOk = headings.length === 3 && hasProfile && hasCsv && hasToday;
    const profileOk = profileLines.length >= 3;
    
    log(`  success: ${data.success}`);
    log(`  응답 길이: ${result.length} chars`);
    log(`  헤딩 수: ${headings.length}`);
    log(`  헤딩: ${headings.join(', ')}`);
    log(`  프로필 해석 있음: ${hasProfile} (${profileLines.length}줄)`);
    log(`  CSV 있음: ${hasCsv}`);
    log(`  오늘의 3단어 있음: ${hasToday}`);
    
    if (headingsOk) {
      log(`  ✅ 형식 OK: 정확히 3개 헤딩`);
    } else {
      log(`  ❌ 형식 문제: 헤딩이 3개가 아니거나 누락`);
    }
    if (profileOk) {
      log(`  ✅ 프로필 해석 3줄 이상`);
    } else {
      log(`  ❌ 프로필 해석 부족: ${profileLines.length}줄`);
    }
    
    return {
      name: test.name,
      success: data.success,
      httpStatus: res.status,
      headings,
      headingsOk,
      hasProfile,
      hasCsv,
      hasToday,
      profileLinesCount: profileLines.length,
      profileOk,
      resultPreview: result.substring(0, 300)
    };
  } catch (error) {
    log(`  ❌ 오류: ${error.message}`);
    return { name: test.name, success: false, httpStatus: 0, headings: [], profileLinesCount: 0, error: error.message };
  }
}

async function main() {
  log('=== vocab-curator 출력 형식 일관성 테스트 ===');
  log(`서버: ${CONFIG.serverUrl}`);
  log(`테스트 수: ${CONFIG.numTests}회`);
  log(`시간: ${new Date().toISOString()}`);
  log('');
  
  const results = [];
  for (let i = 0; i < CONFIG.numTests; i++) {
    results.push(await runTest(TEST_CASES[i]));
    log('');
    await new Promise(r => setTimeout(r, 1000));
  }
  
  log('=== 5회 테스트 결과 요약 ===');
  log('='.repeat(50));
  let allOk = true;
  for (const r of results) {
    const ok = r.success && r.headingsOk && r.profileOk;
    const status = ok ? '✅' : '❌';
    log(`${status} ${r.name}`);
    if (!ok) {
      allOk = false;
      if (!r.success) log(`   → success: ${r.success} (HTTP ${r.httpStatus})`);
      if (!r.headingsOk) log(`   → 형식 문제 (헤딩: ${r.headings.join(', ')})`);
      if (!r.profileOk) log(`   → 프로필 해석 부족 (${r.profileLinesCount}줄)`);
    }
  }
  
  log('');
  if (allOk) {
    log('✅ 5회 모두 형식 일관 + 프로필 해석 항상 확인됨');
  } else {
    log('❌ 일부 테스트 실패 — 확인 필요');
  }
  
  log('');
  log('=== 추가 확인 ===');
  log(`응답 예시 (테스트 1 첫 300자):`);
  if (results[0]) {
    log(results[0].resultPreview || '(결과 없음)');
  }
}

main().catch(err => {
  log(`치명적 오류: ${err.message}`);
  process.exit(1);
});
