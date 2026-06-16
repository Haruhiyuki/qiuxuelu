// 注册法律前置（PRD §7）的协议版本号：升级协议文本时递增版本并要求存量用户重新确认。
// 服务端（auth.ts 的 before 钩子）与注册表单共用此常量，保证强制与展示一致。
export const LICENSE_CONSENT_VERSION = 'CC-BY-NC-SA-4.0/v1';
export const COVENANT_CONSENT_VERSION = 'covenant/v1';
