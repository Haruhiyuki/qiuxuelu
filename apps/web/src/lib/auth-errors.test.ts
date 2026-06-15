import { describe, expect, it } from 'vitest';
import { translateAuthError } from './auth-errors';

describe('translateAuthError', () => {
  it('已收录错误码给中文文案', () => {
    expect(translateAuthError('INVALID_EMAIL_OR_PASSWORD')).toBe('邮箱或密码不正确');
    expect(translateAuthError('USER_ALREADY_EXISTS')).toBe('该邮箱已注册，请直接登录');
  });

  it('错误码优先于自定义 message', () => {
    expect(translateAuthError('USER_NOT_FOUND', '随便什么')).toBe('账号不存在');
  });

  it('无错误码但带中文 message 时透传', () => {
    expect(translateAuthError(undefined, '名字已被占用')).toBe('名字已被占用');
    expect(translateAuthError('UNKNOWN_CODE', '该名字不可用')).toBe('该名字不可用');
  });

  it('英文原文绝不外漏：未知码 + 英文 message → 中文兜底', () => {
    expect(translateAuthError('SOME_NEW_CODE', 'Name is already taken')).toBe(
      '操作失败，请稍后重试',
    );
    expect(translateAuthError(undefined, 'Internal server error')).toBe('操作失败，请稍后重试');
  });

  it('完全无信息时给中文兜底', () => {
    expect(translateAuthError(undefined)).toBe('操作失败，请稍后重试');
    expect(translateAuthError('')).toBe('操作失败，请稍后重试');
  });
});
