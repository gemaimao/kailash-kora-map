export async function onRequestGet(context) {
  try {
    const { env, request } = context;
    if (!env.KORA_MESSAGES) {
      return new Response(JSON.stringify({ error: "KV namespace KORA_MESSAGES is not bound" }), { status: 500 });
    }

    const url = new URL(request.url);
    const password = url.searchParams.get("password");
    const adminPassword = env.ADMIN_PASSWORD || "kailash2026";
    const isAdmin = (password === adminPassword);

    // 获取所有 key，按前缀 msg_ 过滤
    const list = await env.KORA_MESSAGES.list({ prefix: 'msg_' });
    
    let messages = [];
    for (const key of list.keys) {
      const value = await env.KORA_MESSAGES.get(key.name);
      if (value) {
        const msg = JSON.parse(value);
        msg.key = key.name; // 保存键名方便后台操作
        messages.push(msg);
      }
    }

    // 非管理员只拉取已通过的留言
    if (!isAdmin) {
      messages = messages.filter(msg => msg.status === "approved");
    }

    // 按时间倒序排序（最新的在前）
    messages.sort((a, b) => b.timestamp - a.timestamp);

    // 最多返回 100 条
    messages = messages.slice(0, 100);

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

// 敏感词/违法违规关键词库（防灌水、防政治敏感、防博彩色情色诱、防垃圾广告及翻墙工具）
const SENSITIVE_KEYWORDS = [
  "法轮功", "falg", "退党", "三退", "民主运动", "独裁", "暴政", "江泽民", "习近平", "六四", "8964", "天安门事件",
  "赌博", "博彩", "百家乐", "六合彩", "外围", "买球", "球盘", "彩票走势", "彩票分析",
  "嫖娼", "招嫖", "同城约炮", "成人网", "免费看片", "色情", "女大学生包养", "外围女", "寻包养",
  "代开", "发票", "代开发票", "开票",
  "翻墙", "科学上网", "vpn", "机场", "shadowsocks", "v2ray", "trojan", "clash",
  "买卖枪支", "迷药", "毒品", "枪支", "弹药", "海洛因", "大麻",
  "贷款", "网贷", "套现", "刷单", "刷信誉", "刷钻", "兼职刷单"
];

function hasSensitiveWord(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return SENSITIVE_KEYWORDS.some(word => lowerText.includes(word.toLowerCase()));
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!env.KORA_MESSAGES) {
      return new Response(JSON.stringify({ error: "KV namespace KORA_MESSAGES is not bound" }), { status: 500 });
    }

    const data = await request.json();
    const { nickname, contact, type, content, captcha } = data;

    if (!nickname || !type || !content) {
      return new Response(JSON.stringify({ error: "缺少必填字段：昵称、类型或内容" }), { status: 400 });
    }

    // 验证码防刷检查
    const cleanCaptcha = (captcha || "").trim();
    if (cleanCaptcha !== "冈仁波齐" && cleanCaptcha !== "岗仁波齐" && cleanCaptcha !== "冈仁波齐峰") {
      return new Response(JSON.stringify({ error: "防刷验证失败，请填写正确的四字神山名称！" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        }
      });
    }

    // IP 速率限制 (2分钟发一次)
    const ip = request.headers.get("CF-Connecting-IP");
    if (ip) {
      const limitKey = `ratelimit_${ip}`;
      const isLimited = await env.KORA_MESSAGES.get(limitKey);
      if (isLimited) {
        return new Response(JSON.stringify({ error: "您的 IP 发布过于频繁，请等待 2 分钟后再试" }), {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          }
        });
      }
    }

    // 敏感词过滤审核（检查昵称、联系方式和内容）
    const combinedText = `${nickname} ${contact || ""} ${content}`;
    if (hasSensitiveWord(combinedText)) {
      return new Response(JSON.stringify({ error: "发布失败：内容包含敏感词汇或被系统判定为广告垃圾，请文明留言！" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        }
      });
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
      timestamp: timestamp,
      status: "pending" // 默认待审核状态
    };

    // 存入 KV，保留数据
    await env.KORA_MESSAGES.put(key, JSON.stringify(messagePayload));

    // 异步触发微信通知推送
    if (context.waitUntil) {
      context.waitUntil(triggerWeChatPush(env, messagePayload, request.url));
    } else {
      triggerWeChatPush(env, messagePayload, request.url).catch(() => {});
    }

    // 设置 IP 速率限制
    if (ip) {
      const limitKey = `ratelimit_${ip}`;
      await env.KORA_MESSAGES.put(limitKey, "true", { expirationTtl: 120 });
    }

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

export async function onRequestPut(context) {
  try {
    const { request, env } = context;
    if (!env.KORA_MESSAGES) {
      return new Response(JSON.stringify({ error: "KV namespace KORA_MESSAGES is not bound" }), { status: 500 });
    }

    const data = await request.json();
    const { key, password } = data;
    const adminPassword = env.ADMIN_PASSWORD || "kailash2026";

    if (password !== adminPassword) {
      return new Response(JSON.stringify({ error: "无管理员权限" }), { status: 401 });
    }

    const value = await env.KORA_MESSAGES.get(key);
    if (!value) {
      return new Response(JSON.stringify({ error: "留言不存在" }), { status: 404 });
    }

    const msg = JSON.parse(value);
    msg.status = "approved";

    await env.KORA_MESSAGES.put(key, JSON.stringify(msg));

    return new Response(JSON.stringify({ success: true, message: msg }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

export async function onRequestDelete(context) {
  try {
    const { request, env } = context;
    if (!env.KORA_MESSAGES) {
      return new Response(JSON.stringify({ error: "KV namespace KORA_MESSAGES is not bound" }), { status: 500 });
    }

    const data = await request.json();
    const { key, password } = data;
    const adminPassword = env.ADMIN_PASSWORD || "kailash2026";

    if (password !== adminPassword) {
      return new Response(JSON.stringify({ error: "无管理员权限" }), { status: 401 });
    }

    await env.KORA_MESSAGES.delete(key);

    return new Response(JSON.stringify({ success: true }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

// 微信通知推送函数
async function triggerWeChatPush(env, message, requestUrl) {
  try {
    const { nickname, type, content, contact } = message;
    const adminUrl = requestUrl ? new URL(requestUrl).origin + "/admin.html" : "https://kailash-kora-map.pages.dev/admin.html";
    const title = `新留言待审核 - 2026马年大转山`;
    const desp = `**分类**: ${type}\n\n**昵称**: ${nickname}\n\n**联系方式**: ${contact || "无"}\n\n**内容**: ${content}\n\n[点击进入后台审核](${adminUrl})`;

    // 1. Server酱支持
    if (env.SERVERCHAN_SENDKEY) {
      const serverChanUrl = `https://sctapi.ftqq.com/${env.SERVERCHAN_SENDKEY}.send`;
      await fetch(serverChanUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ title, desp })
      });
    }

    // 2. PushPlus (推送加) 支持
    if (env.PUSHPLUS_TOKEN) {
      const pushPlusUrl = "http://www.pushplus.plus/send";
      const htmlContent = `
        <strong>留言类型</strong>: ${type}<br>
        <strong>发布昵称</strong>: ${nickname}<br>
        <strong>联系方式</strong>: ${contact || "无"}<br>
        <strong>留言内容</strong>: ${content}<br><br>
        <a href="${adminUrl}" style="color: #ffcd55; font-weight: bold; text-decoration: none;">👉 点击进入后台审核</a>
      `;
      await fetch(pushPlusUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: env.PUSHPLUS_TOKEN,
          title,
          content: htmlContent,
          template: "html"
        })
      });
    }
  } catch (err) {
    console.error("发送微信推送失败:", err);
  }
}
