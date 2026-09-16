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

const RESPONSE_JSON_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "vocab_curator_result",
    strict: true,
    schema: {
      type: "object",
      properties: {
        profileInterpretation: {
          type: "object",
          properties: {
            line1: { type: "string" },
            line2: { type: "string" },
            line3: { type: "string" }
          },
          required: ["line1", "line2", "line3"],
          additionalProperties: false
        },
        words: {
          type: "array",
          items: {
            type: "object",
            properties: {
              "표제어": { type: "string", description: "원문에 나온 대소문자를 그대로 살린다. 문장 첫 글자, 고유명사, 대명사 I, 줄임말/약어의 대소문자도 원문 그대로 둔다. 표에 쓸 때는 원문 표기 그대로, 임의로 소문자로 바꾸지 않는다." },
              "읽기": { type: "string", description: "읽기(발음 표기)는 일본어 후리가나·중국어 병음처럼 글자만 보고 발음을 바로 알기 어려운 언어일 때만 채운다. 영어 등 알파벳만으로 발음을 유추할 수 있는 언어는 빈 문자열로 둔다. 로마자 발음 표기(한국어 발음을 로마자로 적은 것), 한글 발음 표기, 영어 발음 풀이 등은 넣지 않는다." },
              "품사": { type: "string" },
              "뜻": { type: "string" },
              "상황예문": { type: "string", description: "원문 언어로만 쓴 완전한 문장 (한국어 금지)" },
              "상황예문번역": { type: "string", description: "상황예문의 한국어 번역" },
              "내상황에서": { type: "string", description: "[장면] 원문 언어 짧은 발화 / 한국어 번역" },
              "말투등급": { type: "string" },
              "연어": { type: "string" },
              "확신도": { type: "string", enum: ["정형표현", "자연스러움 확인 권장"] },
              "왜필요한가": { type: "string" },
              "우선순위": { type: "string", enum: ["지금 바로", "여유 될 때"] }
            },
            required: ["표제어","읽기","품사","뜻","상황예문","상황예문번역","내상황에서","말투등급","연어","확신도","왜필요한가","우선순위"],
            additionalProperties: false
          }
        },
        todayTop3: {
          type: "object",
          properties: {
            titles: { type: "string" },
            scene: { type: "string", description: "한국어 장면 설명" },
            dialogue: { type: "string", description: "원문 언어로만 쓴 A:/B: 대화, 줄마다 줄바꿈" }
          },
          required: ["titles", "scene", "dialogue"],
          additionalProperties: false
        }
      },
      required: ["profileInterpretation", "words", "todayTop3"],
      additionalProperties: false
    }
  }
};

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
    // 20개 요청 시 완성 토큰이 약 3,600개라 4000이면 length로 잘릴 위험이 있음
    max_tokens: 8000,
    response_format: RESPONSE_JSON_SCHEMA
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
  
  const finishReason = response.choices[0].finish_reason;
  if (finishReason !== 'stop') {
    throw new Error(`응답이 완료되지 않았습니다 (finish_reason: ${finishReason})`);
  }

  const parsed = JSON.parse(content);
  // 스키마는 개수를 제한하지 못해서(maxItems 미지원) 요청 개수를 넘으면 여기서 자름
  const limit = parseInt(extractCount, 10) || 15;
  if (parsed.words.length > limit) {
    console.log('[generateVocabResult] 요청 개수 초과:', parsed.words.length, '→', limit);
    parsed.words = parsed.words.slice(0, limit);
  }
  console.log('[generateVocabResult] 반환 완료, 단어 수:', Array.isArray(parsed.words) ? parsed.words.length : 0);
  return parsed;
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
      code: API_KEY ? undefined : 'MISSING_API_KEY',
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
