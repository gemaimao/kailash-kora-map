export async function onRequestGet(context) {
  try {
    const { env } = context;
    if (!env.KORA_MESSAGES) {
      return new Response(JSON.stringify({ error: "KV namespace KORA_MESSAGES is not bound" }), { status: 500 });
    }

    // 获取所有 key，按前缀 msg_ 过滤
    const list = await env.KORA_MESSAGES.list({ prefix: 'msg_' });
    
    let messages = [];
    for (const key of list.keys) {
      const value = await env.KORA_MESSAGES.get(key.name);
      if (value) {
        messages.push(JSON.parse(value));
      }
    }

    // 按时间倒序排序（最新的在前）
    messages.sort((a, b) => b.timestamp - a.timestamp);

    // 最多返回 50 条，防止超载
    messages = messages.slice(0, 50);

    return new Response(JSON.stringify({ messages }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!env.KORA_MESSAGES) {
      return new Response(JSON.stringify({ error: "KV namespace KORA_MESSAGES is not bound" }), { status: 500 });
    }

    const data = await request.json();
    const { nickname, contact, type, content } = data;

    if (!nickname || !type || !content) {
      return new Response(JSON.stringify({ error: "缺少必填字段：昵称、类型或内容" }), { status: 400 });
    }

    const timestamp = Date.now();
    // 生成唯一键名
    const randomHex = Math.random().toString(16).slice(2, 8);
    const key = `msg_${timestamp}_${randomHex}`;

    const messagePayload = {
      nickname: nickname.substring(0, 20),
      contact: (contact || "").substring(0, 50),
      type: type,
      content: content.substring(0, 100), // 限制内容长度
      timestamp: timestamp
    };

    // 存入 KV，保留数据
    await env.KORA_MESSAGES.put(key, JSON.stringify(messagePayload));

    return new Response(JSON.stringify({ success: true, message: messagePayload }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
