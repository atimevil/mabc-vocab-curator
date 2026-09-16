require('dotenv').config();

const express = require('express');
const path = require('path');
const { VOCAB_CURATOR_PROMPT } = require('./vocab-curator-prompt');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const API_KEY = process.env.UPSTAGE_API_KEY;
if (!API_KEY) {
  console.warn('경고: UPSTAGE_API_KEY 환경변수가 설정되지 않았습니다.');
  console.warn('실제 키는 .env 파일에 직접 입력해주세요 (코드에 값 없음).');
}

let client = null;

function getClient() {
  if (!client) {
    if (!API_KEY) {
      throw new Error('UPSTAGE_API_KEY가 설정되지 않았습니다.');
    }
    const { OpenAI } = require('openai');
    client = new OpenAI({
      apiKey: API_KEY,
      baseURL: 'https://api.upstage.ai/v1'
    });
  }
  return client;
}

async function generateVocabResult(profile, sourceText, knownWords = '', extractCount = '', focusWords = [], extractedHistory = [], crossLangOriginal = '', crossLangContext = '', personaFeedback = '') {
  console.log('[generateVocabResult] 호출 시작');
  console.log('[generateVocabResult] 프로필 길이:', profile.length, '| 원문 길이:', sourceText.length);
  console.log('[generateVocabResult] extractCount:', extractCount || '없음');
  console.log('[generateVocabResult] focusWords:', focusWords.length ? focusWords : '없음');
  console.log('[generateVocabResult] extractedHistory:', extractedHistory.length ? extractedHistory.length + '개' : '없음');
  console.log('[generateVocabResult] crossLangOriginal:', crossLangOriginal || '없음');
  console.log('[generateVocabResult] crossLangContext:', crossLangContext || '없음');
  console.log('[generateVocabResult] personaFeedback:', personaFeedback || '없음');
  
  const client = getClient();
  const prompt = VOCAB_CURATOR_PROMPT(profile, sourceText, knownWords, extractCount, focusWords, extractedHistory, crossLangOriginal, crossLangContext, personaFeedback);
  
  console.log('[generateVocabResult] 프롬프트 생성 완료, 길이:', prompt.length);
  console.log('[generateVocabResult] Solar Pro 4 API 호출 시작...');
  
  const response = await client.chat.completions.create({
    model: 'solar-pro4',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 4000
  });
  
  console.log('[generateVocabResult] API 응답 완료');
  console.log('[generateVocabResult] 모델:', response.model);
  console.log('[generateVocabResult] 토큰 사용량: 총', response.usage.total_tokens, '| 프롬프트:', response.usage.prompt_tokens, '| 완성:', response.usage.completion_tokens);
  console.log('[generateVocabResult] finish_reason:', response.choices[0].finish_reason);
  
  const content = response.choices[0].message.content;
  console.log('[generateVocabResult] 응답 내용 길이:', content ? content.length : 0);
  
  if (content && (content.includes(process.env.UPSTAGE_API_KEY) || content.includes(API_KEY))) {
    console.warn('경고: 응답에 API 키가 포함될 수 있습니다.');
  }
  
  console.log('[generateVocabResult] 반환 완료');
  return content;
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/generate', async (req, res) => {
  try {
    const { profile, sourceText, knownWords, extractCount, focusWords, extractedHistory, crossLangOriginal, crossLangContext, personaId, personaName, personaTagline, personaFeedback } = req.body;
    
    if (!profile || !sourceText) {
      return res.status(400).json({ 
        error: 'profile과 sourceText는 필수입니다.',
        success: false 
      });
    }
    
    console.log('[api/generate] personaId:', personaId || '없음');
    console.log('[api/generate] personaName:', personaName || '없음');
    console.log('[api/generate] personaFeedback:', personaFeedback || '없음');
    console.log('[api/generate] crossLangOriginal:', crossLangOriginal || '없음');
    console.log('[api/generate] crossLangContext:', crossLangContext || '없음');
    
    const result = await generateVocabResult(
      profile,
      sourceText,
      knownWords || '',
      extractCount ? String(extractCount) : '',
      focusWords || [],
      extractedHistory || [],
      crossLangOriginal || '',
      crossLangContext || '',
      personaFeedback || ''
    );
    
    res.json({
      success: true,
      result: result,
      meta: {
        model: 'solar-pro4',
        timestamp: new Date().toISOString(),
        personaId: personaId || null,
        personaName: personaName || null
      }
    });
  } catch (error) {
    console.error('API 호출 오류:', error.message);
    res.status(500).json({
      success: false,
      error: '어휘 생성 중 오류가 발생했습니다.',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'vocab-curator',
    timestamp: new Date().toISOString()
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`vocab-curator 서비스 실행 중: http://localhost:${PORT}`);
    console.log('API 엔드포인트: POST /api/generate');
    console.log('건강 체크: GET /health');
  });
}

module.exports = app;
