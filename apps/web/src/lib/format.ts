// 显式锁定 zh-CN：日期只在服务端渲染，固定 locale 避免环境差异
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

export function formatDateTime(date: Date): string {
  return dateTimeFormatter.format(date);
}
