/* ─────────────────────────────────────────────────────────────
   开屏 · 碎晶放射（动画全在 BootVeil.astro 的 CSS 里）
   · 主页每次进入都放；其余页面只在会话首访放：BootVeil 的内联脚本在首帧前读 xm-boot-seen，
     看过的会话 / 减弱动效 / 站内 View Transition 进来的页面打 data-boot-skip，面纱不出现。
   · 这里只做三件事：等蒙版、纹理与首屏字体到位、页面头几帧的排版与光栅化忙完再起播（.go，最多等 0.8s），
     在破窗那一刻打 html.booted（页面自己的浮现编排接着走），收场后把整层拿掉。
   · 为什么等页面「静下来」：首访时页面头一回排版、光栅化、起 WebGL 会连着占住主线程与 GPU
     两三百毫秒，开屏若此刻起播，迸出那一下正好被吞掉。素幕本是一整块纯色，多垫这一会儿看不出来。
   ───────────────────────────────────────────────────────────── */

import { reducedMotion } from './lib';

const KEY = 'xm-boot-seen';
const ASSETS = ['/textures/loader-shard.svg', '/textures/loader-window.svg', '/textures/resin.webp'];

/* 相对 .go 的毫秒数，与 BootVeil 的 CSS 时间线对齐 */
const T_OPEN = 1450; // 破窗：打 booted
const T_END = 2350; // 完全收场：移除面纱

/* 连着几帧都准点出来，才算页面头几轮的重活忙完了 */
function settle() {
  return new Promise<void>((resolve) => {
    let last = 0;
    let calm = 0;
    const tick = (t: number) => {
      calm = last && t - last < 24 ? calm + 1 : 0;
      last = t;
      if (calm >= 3) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/* 只等「这些节点里实际要画的字」用到的字面，不挂 document.fonts.ready。
   fonts.ready 是整页字体计划的闩：Noto Serif SC 按 unicode-range 切成十包（500 / 600 各五），
   长文一排版、主页一画卡就把后几包全报上去，要每一包都落地它才 resolve。
   document.fonts.load(font, text) 只取这些字落在的那几包，resolve 时字形已可用，揭开时不闪 fallback。
   先例见 wander/faces.js 的 loadFonts。
   · 按计算后的字体分组：字号不参与选字面，归一成 16px 好去重；
   · [data-morph] 的两面（data-true / data-dream）一起报上：揭开前后它可能已换成梦面；
   · band > 0 时只收落在视口顶上 band 倍视口高之内的文字节点（整个节点收，宁多勿少）；
   · 某一包下载失败也当到位（与原先 fonts.ready 的 reject 同等对待），不把揭幕卡死。 */
export async function loadFontsIn(roots: Iterable<Element | null>, band = 0): Promise<void> {
  const fs = document.fonts;
  if (!fs?.load) return;
  const faces = new Map<string, string>();
  const rg = document.createRange();
  const bottom = innerHeight * band;
  for (const root of roots) {
    if (!root) continue;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.nodeValue?.trim()) continue;
      if (band > 0) {
        rg.selectNodeContents(n);
        const r = rg.getBoundingClientRect();
        // 宽为 0 = display: none（含 script / style 里的文本）
        if (!r.width || r.bottom <= 0 || r.top >= bottom || r.right <= 0 || r.left >= innerWidth) continue;
      }
      const cs = getComputedStyle(el);
      const font = `${cs.fontStyle} ${cs.fontWeight} 16px ${cs.fontFamily}`;
      const m = el.closest<HTMLElement>('[data-morph]');
      const text = n.nodeValue + (m ? `${m.dataset.true ?? ''}${m.dataset.dream ?? ''}` : '');
      faces.set(font, (faces.get(font) ?? '') + text);
    }
  }
  await Promise.all([...faces].map(([font, text]) => fs.load(font, text).catch(() => [])));
}

function preload(src: string) {
  return new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = img.onerror = () => resolve();
    img.src = src;
    img.decode?.().then(resolve, resolve);
  });
}

export function initBoot() {
  /* 主页的颗粒开屏（GrainBoot）自己接管 booted 与整条时间轴，这里不再插手。
     它由 index.astro 的 head 内联脚本在首帧前挂上 window.__grainBoot。 */
  if ((window as unknown as { __grainBoot?: boolean }).__grainBoot) return;

  const veil = document.getElementById('bootveil');
  const root = document.documentElement;
  const markSeen = () => {
    try {
      sessionStorage.setItem(KEY, '1');
    } catch {
      /* 隐私模式下静默 */
    }
  };

  if (!veil || 'bootSkip' in root.dataset || reducedMotion()) {
    veil?.remove();
    root.classList.add('booted');
    markSeen();
    return;
  }

  /* 字体只等首屏（多留四分之一屏：进页会滚到页头之下，见 BaseLayout）。
     上限从 1.2s 收到 0.8s：要等的只剩一两个核心包（head 里已 preload），纹理三张合计 22KB；
     页面的字要到 .go 之后 1.45s 破窗才透出来，字体实际还有 0.8 + 1.45s 的余量。 */
  const fonts = loadFontsIn([document.body], 1.25).catch(() => {});
  const ready = Promise.all([...ASSETS.map(preload), fonts]).then(settle);
  const cap = new Promise((r) => setTimeout(r, 800));
  Promise.race([ready, cap]).then(() => {
    veil.classList.add('go');
    setTimeout(() => {
      root.classList.add('booted');
      markSeen();
    }, T_OPEN);
    setTimeout(() => veil.remove(), T_END);
  });
}
