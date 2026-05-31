// Vercel 서버리스 함수 — 스톤킴 단가표 기반 AI 상담
// 브라우저는 이 함수로 요청을 보내고, 이 함수가 Anthropic API를 호출한다.
// API 키는 Vercel 환경변수(ANTHROPIC_API_KEY)에 숨겨둔다. 절대 브라우저에 노출 안 됨.

export default async function handler(req, res) {
  // CORS (혹시 다른 도메인에서 부를 경우 대비)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST 요청만 가능합니다." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "서버에 API 키가 설정되지 않았습니다. Vercel 환경변수(ANTHROPIC_API_KEY)를 확인하세요.",
    });
  }

  try {
    // 요청 본문 파싱 (Vercel은 보통 자동 파싱하지만 안전하게 처리)
    let body = req.body;
    if (typeof body === "string") {
      body = JSON.parse(body);
    }

    const { question, priceTable, history } = body || {};

    if (!priceTable || priceTable.trim().length === 0) {
      return res.status(400).json({
        error: "NO_PRICE_TABLE",
        message: "먼저 단가표를 업로드해주세요. 단가표가 있어야 상담이 가능합니다.",
      });
    }

    if (!question || question.trim().length === 0) {
      return res.status(400).json({ error: "질문 내용이 비어 있습니다." });
    }

    // 시스템 프롬프트 — 단가표를 지식으로 주입
    const systemPrompt = `당신은 스톤킴(STONE KIM)의 인테리어·건축 자재 견적 상담 AI입니다.
아래는 고객이 직접 업로드한 단가표입니다. 이 단가표에 있는 정보만을 근거로 답변하세요.

[고객 단가표]
${priceTable}

[답변 규칙 — 매우 중요]
- 반드시 위 단가표에 있는 제품명, 규격, 단가만 사용해서 계산하세요.
- 단가표에 없는 제품을 물어보면 "해당 제품은 단가표에 없습니다"라고 솔직히 답하세요.
- 면적(평/㎡) 계산 시: 1평 = 3.3058㎡ 로 환산합니다.
- 타일/판재 수량 계산 시 한 장의 규격(가로×세로)으로 시공 면적을 나누어 필요 장수를 구하고, 로스율 7%를 더해 안내합니다.
- 금액은 단가 × 수량으로 계산하고, 한국 원화(원)로 천 단위 콤마를 넣어 표시합니다.

[답변 형식 — 반드시 지킬 것]
이 답변은 좁은 모바일 채팅창에 표시됩니다. 다음을 엄격히 지키세요.
1. 가장 먼저 핵심 결론을 1~2문장으로 짧게 답하세요. (예: "G088 모델이 가장 유리합니다. 50㎡ 기준 약 199만원입니다.")
2. 표(table), 마크다운 표 문법(| 기호)은 절대 사용하지 마세요. 좁은 화면에서 깨집니다.
3. 전체 제품을 나열하지 마세요. 질문에 직접 답하는 데 필요한 1~3개만 언급하세요.
4. 상세 설명이 필요하면, 결론 뒤에 짧게 2~4줄로만 덧붙이세요. 긴 비교는 하지 마세요.
5. 이모지는 최대 1개까지만. 헤더(##)나 굵은 줄 장식을 남발하지 마세요.
6. 전체 답변은 가능하면 5~6줄 이내로 짧게 유지하세요.
7. 사용자가 "자세히", "전부 비교해줘" 라고 명시적으로 요청할 때만 더 길게 답하세요.
- 답변은 친절하고 간결한 한국어로, 영업사원처럼 신뢰감 있게 하세요.
- 부가세(VAT) 별도 여부는 단가표에 명시가 없으면 한 줄로 "부가세 별도 여부는 담당자 확인이 필요합니다"라고만 덧붙이세요.`;

    // 대화 히스토리 구성
    const messages = [];
    if (Array.isArray(history)) {
      for (const h of history) {
        if (h && h.role && h.content) {
          messages.push({ role: h.role, content: String(h.content) });
        }
      }
    }
    messages.push({ role: "user", content: question });

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 700,
        system: systemPrompt,
        messages: messages,
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return res.status(502).json({
        error: "AI 호출 실패",
        detail: errText.slice(0, 500),
      });
    }

    const data = await anthropicRes.json();
    const answer = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return res.status(200).json({ answer: answer || "(빈 응답)" });
  } catch (err) {
    return res.status(500).json({
      error: "서버 오류",
      detail: String(err).slice(0, 500),
    });
  }
}
