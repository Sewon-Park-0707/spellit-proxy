// api/check.js
// Vercel Serverless Function — Korean spell check via Google Gemini API

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text field is required' });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const prompt = `당신은 한국어 맞춤법 검사 전문가입니다.

아래 텍스트의 맞춤법, 띄어쓰기, 철자 오류를 검사해주세요.

규칙:
- 한국어+영어 혼용은 오류가 아님 (예: "버튼 Click", "홈 Home")
- 브랜드명, 고유명사, 2자 이하 단어, 약어는 검사 제외
- 명백한 오류만 리포트 (불확실한 경우 제외)
- 오류가 없으면 errors를 빈 배열로 반환

검사할 텍스트:
"${text.replace(/"/g, '\\"')}"

반드시 아래 JSON 형식으로만 응답 (다른 텍스트 절대 금지, 마크다운 코드블록 금지):
{"errors":[{"wrong":"틀린부분","suggestion":"올바른표현","desc":"오류설명","type":"spelling또는spacing또는grammar"}]}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 1024 }
        }),
        signal: AbortSignal.timeout(15000)
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error('Gemini error: ' + (err.error?.message || response.status));
    }

    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{"errors":[]}';
    const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json({ errors: parsed.errors || [] });

  } catch (err) {
    console.error('Gemini proxy error:', err);
    return res.status(502).json({ error: err.message });
  }
}
