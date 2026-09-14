require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const { VOCAB_CURATOR_PROMPT } = require('./vocab-curator-prompt');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// 환경변수 읽기 (실제 키는 .env에서, 코드에 값 없음)
const API_KEY = process.env.UPSTAGE_API_KEY;
if (!API_KEY) {
  console.warn('경고: UPSTAGE_API_KEY 환경변수가 설정되지 않았습니다.');
  console.warn('실제 키는 .env 파일에 직접 입력해주세요 (코드에 값 없음).');
}

// Solar Pro 4 API 클라이언트 (OpenAI SDK 호환)
const { OpenAI } = require('openai');
const client = new OpenAI({
  apiKey: API_KEY,
  baseURL: 'https://api.upstage.ai/v1'
});

/**
 * vocab-curator 결과를 생성
 * - Solar Pro 4 API만 호출 (base_url: https://api.upstage.ai/v1, model: solar-pro4)
 * - 그 외 외부 주소로는 요청하지 않음
 */
async function generateVocabResult(profile, sourceText, knownWords = '', difficultyMarks = '') {
  const prompt = VOCAB_CURATOR_PROMPT(profile, sourceText, knownWords, difficultyMarks);
  
  const response = await client.chat.completions.create({
    model: 'solar-pro4',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 4000
  });
  
  // 응답에 키가 섞여 있지 않은지 확인 (방어)
  const content = response.choices[0].message.content;
  if (content && (content.includes(process.env.UPSTAGE_API_KEY) || content.includes(API_KEY))) {
    console.warn('경고: 응답에 API 키가 포함될 수 있습니다.');
  }
  
  return content;
}

// GET / — index.html 서빙
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// POST /api/generate — vocab-curator 결과 생성
app.post('/api/generate', async (req, res) => {
  try {
    const { profile, sourceText, knownWords, difficultyMarks } = req.body;
    
    if (!profile || !sourceText) {
      return res.status(400).json({ 
        error: 'profile과 sourceText는 필수입니다.',
        success: false 
      });
    }
    
    // Solar Pro 4 API 호출 (서비스 키 사용, 그 외 외부 주소 없음)
    const result = await generateVocabResult(
      profile,
      sourceText,
      knownWords || '',
      difficultyMarks || ''
    );
    
    // 응답 JSON에 키 없음을 보장 — 결과 데이터만 반환
    res.json({
      success: true,
      result: result,
      // 메타데이터 (키 없음, 사용자에게 유용한 정보만)
      meta: {
        model: 'solar-pro4',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('API 호출 오류:', error.message);
    res.status(500).json({
      success: false,
      error: '어휘 생성 중 오류가 발생했습니다.',
      // 개발 환경에서만 상세 메시지 (프로덕션에는 노출 안 함)
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /health — 상태 확인 (배포 검증용)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'vocab-curator',
    timestamp: new Date().toISOString()
  });
});

// 서버 시작 (직접 실행 시)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`vocab-curator 서비스 실행 중: http://localhost:${PORT}`);
    console.log('API 엔드포인트: POST /api/generate');
    console.log('건강 체크: GET /health');
  });
}

module.exports = app;
