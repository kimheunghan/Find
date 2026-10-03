"use strict";

// 메일 파일(EML·MSG)을 공통 메일 객체로 읽는다 (ADR-0004 결정 1).
// { subject, from, to, cc, date, body, attachments: [{ name, content(Buffer) } | { name, mail(메일 객체) }] }
const { simpleParser } = require("mailparser");
const MsgReader = require("@kenjiuno/msgreader").default;

function htmlToText(html) {
  return String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ");
}

const addressText = (value) => [].concat(value || []).map((item) => item?.text || "").filter(Boolean).join(", ");

async function parseEml(buffer) {
  const mail = await simpleParser(buffer);
  return {
    subject: mail.subject || "",
    from: addressText(mail.from),
    to: addressText(mail.to),
    cc: addressText(mail.cc),
    date: mail.date ? mail.date.toISOString() : "",
    body: mail.text || htmlToText(mail.html),
    // 메일 보기에서 원래 모양(문단·표·본문 이미지)으로 보여 주기 위한 HTML. 색인에는 쓰지 않는다.
    html: typeof mail.html === "string" ? mail.html : "",
    attachments: (mail.attachments || []).map((attachment) => ({
      name: attachment.filename || (attachment.contentType === "message/rfc822" ? "첨부 메일.eml" : "첨부 파일"),
      content: attachment.content,
      cid: attachment.cid || "", // 본문 HTML의 <img src="cid:..."> 이미지
      // 본문에 그려지는 이미지 (mailparser가 HTML 안 cid를 data: 주소로 바꿔 둔다)
      inline: Boolean(attachment.related || (attachment.cid && attachment.contentDisposition === "inline")),
      contentType: attachment.contentType || ""
    }))
  };
}

// MSG 필드 → 메일 객체. 첨부된 메일(innerMsgContent)은 필드가 이미 풀려 있어 그대로 메일 객체로 만든다.
function msgFieldsToMail(reader, fields) {
  const recipients = (type) => (fields.recipients || [])
    .filter((recipient) => (recipient.recipType || "to") === type)
    .map((recipient) => {
      const email = recipient.smtpAddress || recipient.email || "";
      return recipient.name && email && recipient.name !== email ? `${recipient.name} <${email}>` : (email || recipient.name || "");
    })
    .filter(Boolean)
    .join(", ");
  const senderEmail = fields.senderSmtpAddress || fields.senderEmail || "";
  const time = fields.messageDeliveryTime || fields.clientSubmitTime || fields.creationTime || "";
  return {
    subject: fields.subject || "",
    from: fields.senderName && senderEmail ? `${fields.senderName} <${senderEmail}>` : (fields.senderName || senderEmail),
    to: recipients("to"),
    cc: recipients("cc"),
    date: time ? new Date(time).toISOString() : "",
    body: fields.body || htmlToText(fields.bodyHtml),
    html: typeof fields.bodyHtml === "string" ? fields.bodyHtml : "",
    attachments: (fields.attachments || []).map((attachment) => {
      if (attachment.innerMsgContent && attachment.innerMsgContentFields) {
        return { name: `${attachment.name || attachment.fileName || "첨부 메일"}.msg`, mail: msgFieldsToMail(reader, attachment.innerMsgContentFields) };
      }
      try {
        const data = reader.getAttachment(attachment);
        return { name: data.fileName || attachment.fileName || "첨부 파일", content: Buffer.from(data.content) };
      } catch {
        return { name: attachment.fileName || "첨부 파일", content: null };
      }
    })
  };
}

function parseMsg(buffer) {
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const reader = new MsgReader(arrayBuffer);
  const fields = reader.getFileData();
  if (fields.error) throw new Error(`MSG 메일을 읽지 못했습니다: ${fields.error}`);
  return msgFieldsToMail(reader, fields);
}

async function parseMail(buffer, extension) {
  return extension === "msg" ? parseMsg(buffer) : parseEml(buffer);
}

module.exports = { parseMail, htmlToText };
