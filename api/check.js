// api/check.js
// Vercel Serverless Function — CORS proxy for PNU Korean spellchecker
// Deployed on Vercel (free tier), called from Figma plugin UI

export default async function handler(req, res) {
  // Allow requests from Figma plugin (null origin) and any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text field is required' });
  }

  // PNU spellchecker has a ~500 char limit per request
  // Split into chunks if needed
  const MAX_CHUNK = 400;
  const chunks = splitIntoChunks(text, MAX_CHUNK);

  try {
    const allErrors = [];

    for (const chunk of chunks) {
      const pnuRes = await fetch('https://nara-speller.co.kr/speller/results', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://nara-speller.co.kr/',
          'User-Agent': 'Mozilla/5.0 (compatible; SpellitPlugin/1.0)',
        },
        body: 'text1=' + encodeURIComponent(chunk),
        signal: AbortSignal.timeout(10000),
      });

      if (!pnuRes.ok) {
        throw new Error('PNU API returned ' + pnuRes.status);
      }

      const data = await pnuRes.json();

      if (data && Array.isArray(data.errInfo)) {
        for (const e of data.errInfo) {
          allErrors.push({
            wrong: e.orgStr,
            suggestion: e.candWord ? e.candWord.split('|')[0] : e.orgStr,
            desc: e.help || '맞춤법 오류',
            // errorIdx: 1=철자, 2=띄어쓰기, 3=문법, 4=표준어
            type: e.errorIdx === 2 ? 'spacing' : e.errorIdx === 3 ? 'grammar' : 'spelling',
          });
        }
      }
    }

    // Deduplicate by wrong word
    const seen = new Set();
    const unique = allErrors.filter(e => {
      if (seen.has(e.wrong)) return false;
      seen.add(e.wrong);
      return true;
    });

    return res.status(200).json({ errors: unique });

  } catch (err) {
    console.error('PNU proxy error:', err);
    return res.status(502).json({ error: 'Failed to reach PNU spellchecker: ' + err.message });
  }
}

function splitIntoChunks(text, maxLen) {
  const chunks = [];
  // Split on sentence boundaries first, then by length
  const sentences = text.split(/(?<=[.!?\n])\s*/);
  let current = '';

  for (const sentence of sentences) {
    if ((current + sentence).length > maxLen) {
      if (current) chunks.push(current.trim());
      // If single sentence is too long, split by spaces
      if (sentence.length > maxLen) {
        const words = sentence.split(' ');
        let sub = '';
        for (const word of words) {
          if ((sub + ' ' + word).length > maxLen) {
            if (sub) chunks.push(sub.trim());
            sub = word;
          } else {
            sub = sub ? sub + ' ' + word : word;
          }
        }
        if (sub) current = sub;
      } else {
        current = sentence;
      }
    } else {
      current = current ? current + ' ' + sentence : sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(c => c.length > 0);
}
