/** Server Action 统一返回形状：业务可预期失败走 ok:false + 中文文案，不向客户端抛异常。 */
export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };
