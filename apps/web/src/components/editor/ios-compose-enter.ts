// iOS Safari 系统输入法的「预测/行内候选」会让合成态（composition）在词已上屏后仍保持活跃，
// 于是回车的第一下被 ProseMirror 当作「结束合成」吞掉、不换行，要按第二下才换行
// （桌面拼音是「回车选词、不换行」的正常语义，不能动；这里只针对 iOS 预测候选这一场景）。
//
// 兜底：记下「合成态下按的回车」，等本次 compositionend 落定后补执行一次换行——
// 使「确认预测候选」的那一下回车同时完成换行，贴近原生 iOS 行为。
// 仅在 iOS 上挂载；非 iOS 返回空插件，桌面行为完全不变。
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

function isIOS(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent || '';
  // iPadOS 13+ 的 Safari UA 伪装成 Mac，用触点数兜底识别
  return /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
}

export const IosComposeEnter = Extension.create({
  name: 'iosComposeEnter',
  addProseMirrorPlugins() {
    if (!isIOS()) {
      return [];
    }
    const editor = this.editor;
    let pendingEnter = false;
    // 换行：在列表里分条目，否则分段落（覆盖用户场景：列表 / 普通正文）
    const runEnter = () => {
      if (!editor.isEditable) {
        return;
      }
      if (!editor.commands.splitListItem('listItem')) {
        editor.commands.splitBlock();
      }
    };
    return [
      new Plugin({
        key: new PluginKey('iosComposeEnter'),
        props: {
          handleDOMEvents: {
            keydown: (_view, event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                // 只盯「合成态下的回车」（预测候选未结束）；普通回车交给默认 keymap
                pendingEnter = event.isComposing === true;
              }
              return false;
            },
            compositionend: () => {
              if (pendingEnter) {
                pendingEnter = false;
                // 等 compositionend 的 DOM 变更被 ProseMirror 消化后再补换行
                window.setTimeout(runEnter, 0);
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});
