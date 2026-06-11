'use client';

// 第三方登录：仅当 NEXT_PUBLIC_GITHUB_OAUTH=1（服务端也配了凭证）时显示。
// 回调落到 /onboarding/consent——新 OAuth 用户在此补齐内容授权同意，已同意者自动跳首页。
import { Button } from '@harublog/ui';
import { authClient } from '@/lib/auth-client';

export function OAuthButtons() {
  if (process.env.NEXT_PUBLIC_GITHUB_OAUTH !== '1') {
    return null;
  }
  return (
    <div className="mt-8 flex flex-col gap-3">
      <Button
        variant="secondary"
        onClick={() =>
          authClient.signIn.social({ provider: 'github', callbackURL: '/onboarding/consent' })
        }
      >
        用 GitHub 继续
      </Button>
      <div className="flex items-center gap-3 text-ink-400 text-xs">
        <span className="h-px flex-1 bg-ink-200" />
        或使用邮箱
        <span className="h-px flex-1 bg-ink-200" />
      </div>
    </div>
  );
}
