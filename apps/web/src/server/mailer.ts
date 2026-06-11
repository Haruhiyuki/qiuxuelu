// 统一发信出口（Resend）。无 RESEND_API_KEY 时 dev 走控制台打印——密码重置/验证等流程可端到端跑通而不真发信。
import { Resend } from 'resend';

const FROM = process.env.EMAIL_FROM ?? '求学路 <onboarding@resend.dev>';

let client: Resend | undefined;

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail({ to, subject, html, text }: MailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    // 开发兜底：不真发，仅打印，便于本地验证链接/验证码
    console.log(`[mail:dev] → ${to}\n  主题：${subject}\n  正文：${text}`);
    return;
  }
  client ??= new Resend(apiKey);
  const { error } = await client.emails.send({ from: FROM, to, subject, html, text });
  if (error) {
    throw new Error(`邮件发送失败：${error.message}`);
  }
}

/** 极简邮件模板：纯文本 + 同内容的轻量 HTML，避免引第三方模板依赖。 */
export function basicEmail(heading: string, body: string, action?: { label: string; url: string }) {
  const text = action
    ? `${heading}\n\n${body}\n\n${action.label}：${action.url}`
    : `${heading}\n\n${body}`;
  const button = action
    ? `<p style="margin:24px 0"><a href="${action.url}" style="background:#1f6feb;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none">${action.label}</a></p><p style="color:#888;font-size:12px">若按钮无法点击，请复制链接：${action.url}</p>`
    : '';
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#1f2933">
    <h2 style="font-size:18px">${heading}</h2>
    <p style="line-height:1.6">${body}</p>
    ${button}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
    <p style="color:#aab;font-size:12px">求学路 · 可协作的求学经验之书</p>
  </div>`;
  return { text, html };
}
