// ==UserScript==
// @name         Video Touch Enhancer
// @namespace    http://tampermonkey.net/
// @version      0.0.44
// @description  为主流网页视频播放器添加触屏手势（单击/双击/长按/横滑/竖滑），并提供可视化设置面板
// @author       You
// @match        *://*/*
// @icon         data:image/svg+xml;base64,PHN2ZyB0PSIxNzgyNDMyMTAzMTg1IiBjbGFzcz0iaWNvbiIgdmlld0JveD0iMCAwIDEwMjQgMTAyNCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHAt aWQ9IjIxNjUiIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIj48cGF0aCBkPSJNNTEyIDY0QzI2NS42IDY0IDY0IDI2NS42IDY0IDUxMnMyMDEuNiA0NDggNDQ4IDQ0OCA0NDgtMjAxLjYgNDQ4LTQ0OFM3NTguNCA2NCA1MTIgNjR6TTY5MS4yIDU0NGwtMjU2IDE1Ni44QzQyOC44IDcwNCA0MjIuNCA3MDQgNDE2IDcwNGMtNi40IDAtOS42IDAtMTYtMy4yQzM5MC40IDY5NC40IDM4NCA2ODQuOCAzODQgNjcyTDM4NCAzNTJjMC0xMi44IDYuNC0yMi40IDE2LTI4LjggOS42LTYuNCAyMi40LTYuNCAzMiAwbDI1NiAxNjYuNGM5LjYgNi40IDE2IDE2IDE2IDI4LjhDNzA0IDUyOCA3MDAuOCA1NDAuOCA2OTEuMiA1NDR6IiBwLWlkPSIyMTY2IiBmaWxsPSIjMjU2M0VCIj48L3BhdGg+PC9zdmc+
// @run-at       document-end
// @noframes
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @license      MIT
// ==/UserScript==

(function() {
    "use strict";

    // ============================================================
    // #region 安全兼容
    // ============================================================

    // 部分网站不允许 unsafeWindow，做一层兜底
    const win = (typeof unsafeWindow !== "undefined") ? unsafeWindow : window;

    const ttPolicy = (() => {
        try {
            const tt = win.trustedTypes || (typeof trustedTypes !== "undefined" ? trustedTypes : null);
            if (tt && typeof tt.createPolicy === "function") {
                return tt.createPolicy("touch-enhancer-html", { createHTML: (s) => s });
            }
        } catch {
            // CSP 的 trusted-types 指令限制了 policy 名单时会走到这里
        }
        return null;
    })();


    function setHTML(element, html) {
        if (!element) return;
        const value = (html == null) ? "" : String(html);
        try {
            element.innerHTML = ttPolicy ? ttPolicy.createHTML(value) : value;
        } catch {
            // 极端情况下（强制 Trusted Types 且 policy 被拒）退化为纯文本，至少不让脚本崩溃
            try { element.textContent = ""; } catch {}
        }
    }

    // #endregion



    // ============================================================
    // #region 参数配置
    // ============================================================

    const SETTINGS_KEY = "vte-settings-v2";
    const TOAST_ID = "vte-toast";
    const SHIELD_ID = "vte-shield";
    const SETTINGS_PANEL_ID = "vte-settings-panel";
    const STYLE_ID = "vte-style";

    const BUTTON_CLASS = "vte-side-button";
    const LEFT_BUTTON_ID = "vte-left-button";
    const LEFT_BACKWARD_BUTTON_ID = "vte-left-backward-button";
    const LEFT_FORWARD_BUTTON_ID = "vte-left-forward-button";
    const RIGHT_BUTTON_ID = "vte-right-button";
    const RIGHT_BACKWARD_BUTTON_ID = "vte-right-backward-button";
    const RIGHT_FORWARD_BUTTON_ID = "vte-right-forward-button";
    const LEFT_BUTTON_IDS = [LEFT_BUTTON_ID, LEFT_BACKWARD_BUTTON_ID, LEFT_FORWARD_BUTTON_ID];
    const RIGHT_BUTTON_IDS = [RIGHT_BUTTON_ID, RIGHT_BACKWARD_BUTTON_ID, RIGHT_FORWARD_BUTTON_ID];

    // const FULLSCREEN_BUTTON_SIZE = 52;
    // const BUTTON_SIZE = 40;
    const BUTTON_SIZE_RATIO = 4;
    const TOAST_DELAY = 500;
    const BUTTON_EXPAND_DURATION = 180;
    const MIN_VIDEO_WIDTH = 200;
    const MIN_VIDEO_HEIGHT = 120;
    const SHIELD_Z_INDEX = "45";

    const VERTICAL_ACTIONS = {
        none: "无操作",
        brightness: "调节亮度",
        volume: "调节音量"
    };

    const BUTTON_ACTIONS = {
        none: "无操作",
        lock: "锁定按钮",
        menu: "菜单按钮"
    };

    const DEFAULT_SETTINGS = {
        // 单击
        pbDuration: 3,

        // 双击
        doubleTapPause: true,
        clickTimeout: 200,

        // 长按
        longPressSpeed: true,
        targetSpeed: 3.0,
        pressDelay: 300,

        // 横向滑动
        horizontalSwipeSeek: true,
        horizontalSens: 100,

        // 纵向滑动
        verticalSwipeLeft: "brightness",
        verticalSwipeRight: "volume",
        verticalSens: 50,
        maxBrightness: 200,
        maxVolume: 200,

        // 按钮区域
        leftButtonAction: "lock",
        rightButtonAction: "menu",
        btnSeekStep: 10,
    };

    let userSettings = loadSettings();
    const controllers = new Map();
    const audioStores = new WeakMap();
    let rafId = null;
    let scanTimer = null;

    const NATIVE_CLICK_BLOCK_DURATION = 500;


    // #endregion



    // ============================================================
    // #region CSS样式
    // ============================================================

    if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = /*css*/`
        @keyframes vteSpeedPulse {
            0%   { opacity: 0.3; filter: brightness(0.3); }
            25%  { opacity: 0.6; filter: brightness(0.6); }
            50%  { opacity: 1.0; filter: brightness(1.0); }
            75%  { opacity: 0.6; filter: brightness(0.6); }
            100% { opacity: 0.3; filter: brightness(0.3); }
        }


        /* #region 设置面板容器 */
        #vte-settings-panel {
            --vte-primary-blue: #6366f1;
            --vte-primary-blue-soft: rgba(99, 102, 241, 0.14);
            --vte-black: #111827;
            --vte-gray: #f1f2f3;
        }

        #vte-settings-panel,
        #vte-settings-panel * {
            box-sizing: border-box;
        }

        .vte-card-wrap {
            width: min(540px, calc(100vw - 48px));
            max-height: min(720px, calc(100vh - 48px));
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.55);
            border-radius: 30px;
            color: var(--vte-black);
            background: var(--vte-gray);
            box-shadow: 0 22px 70px rgba(15, 23, 42, 0.22);
        }

        .vte-card {
            max-height: min(720px, calc(100vh - 48px));
            overflow: auto;
            padding: 24px;
        }

        .vte-card::-webkit-scrollbar {
            width: 10px;
        }

        .vte-card::-webkit-scrollbar-thumb {
            border-radius: 999px;
            background: rgba(148, 163, 184, 0.45);
        }

        /* #endregion */


        /* #region 设置面板页头 */
        .vte-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 14px;
            padding-bottom: 18px;
        }

        .vte-title {
            min-width: 0;
            font-size: 25px;
            font-weight: 800;
            line-height: 1.2;
            letter-spacing: -0.03em;
        }

        .vte-title,
        .vte-summary-title,
        .vte-label {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        /* #endregion */


        /* #region 设置面板按钮 */
        .vte-button {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid transparent;
            border-radius: 999px;
            padding: 10px 18px;
            cursor: pointer;
            font-family: inherit;
            font-size: 14px;
            font-weight: 700;
            transition:
                border-color 0.18s ease,
                box-shadow 0.18s ease,
                transform 0.18s ease;
        }

        .vte-section:hover,
        .vte-button:hover {
            z-index: 1;
            border-color: #4aa3ff;
            box-shadow: 0 12px 26px rgba(59, 130, 246, 0.16), 0 8px 18px rgba(15, 23, 42, 0.08);
            transform: translateY(-2px);
        }

        #vte-close-button {
            width: 46px;
            height: 46px;
            flex: 0 0 auto;
            padding: 0;
            color: var(--vte-black);
            background: #ffffff;
        }

        #vte-close-button svg {
            width: 23px;
            height: 23px;
            pointer-events: none;
        }

        #vte-reset-button {
            color: var(--vte-black);
            background: #ffffff;
        }

        #vte-finish-button {
            color: #ffffff;
            background: var(--vte-primary-blue);
        }
        /* #endregion */


        /* #region 设置面板分组 */
        .vte-section {
            position: relative;
            margin-bottom: 14px;
            border: 1px solid transparent;
            border-radius: 22px;
            background: #ffffff;
            box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
            overflow: hidden;
            transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
        }

        .vte-section > summary {
            display: flex;
            align-items: center;
            justify-content: space-between;
            min-height: 62px;
            padding: 0 22px;
            cursor: pointer;
            list-style: none;
            font-size: 18px;
            font-weight: 800;
            user-select: none;
        }

        .vte-section > summary::-webkit-details-marker {
            display: none;
        }

        .vte-summary-arrow {
            display: flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 auto;
            width: 20px;
            height: 20px;
            transition: transform 0.16s ease;
            pointer-events: none;
        }

        .vte-summary-arrow svg {
            width: 18px;
            height: 18px;
            display: block;
        }

        .vte-section[open] > summary .vte-summary-arrow {
            transform: rotate(90deg);
        }

        .vte-summary {
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 0;
        }

        .vte-summary-icon {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 38px;
            height: 38px;
            border-radius: 999px;
            flex: 0 0 auto;
        }

        .vte-summary-icon svg {
            width: 21px;
            height: 21px;
            display: block;
        }

        .vte-summary-icon-purple {
            color: #8b5cf6;
            background: rgba(139, 92, 246, 0.14);
        }

        .vte-summary-icon-blue {
            color: var(--vte-primary-blue);
            background: var(--vte-primary-blue-soft);
        }

        .vte-summary-icon-green {
            color: #22c55e;
            background: rgba(34, 197, 94, 0.14);
        }

        .vte-summary-icon-orange {
            color: #f59e0b;
            background: rgba(245, 158, 11, 0.14);
        }

        .vte-summary-icon-red {
            color: #ef4444;
            background: rgba(239, 68, 68, 0.14);
        }

        .vte-summary-title {
            min-width: 0;
        }

        .vte-section[open] {
            padding-bottom: 14px;
        }
        /* #endregion */


        /* #region 设置面板行和标签 */
        .vte-row {
            display: grid;
            grid-template-columns: 1fr auto;
            align-items: center;
            gap: 12px;
            min-height: 56px;
            margin: 0 22px 10px;
            padding: 0 18px;
            border: 1px solid rgba(17, 24, 39, 0.06);
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.9);
            box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
        }

        .vte-section .vte-row:last-child {
            margin-bottom: 0;
        }

        .vte-label {
            min-width: 0;
            font-size: 15px;
            font-weight: 700;
        }

        /* #endregion */


        /* #region 开关控件 */
        .vte-switch-row {
            position: relative;
            width: 38px;
            height: 22px;
        }

        .vte-switch-row input {
            display: none;
        }

        .vte-slider {
            position: absolute;
            inset: 0;
            cursor: pointer;
            border-radius: 999px;
            background: #d1d5db;
            transition: background 0.18s ease;
        }

        .vte-slider::before {
            content: "";
            position: absolute;
            width: 18px;
            height: 18px;
            left: 2px;
            top: 2px;
            border-radius: 50%;
            background: #fff;
            box-shadow: 0 1px 4px rgba(15, 23, 42, 0.25);
            transition: transform 0.18s ease;
        }

        .vte-switch-row input:checked + .vte-slider {
            background: var(--vte-primary-blue);
        }

        .vte-switch-row input:checked + .vte-slider::before {
            transform: translateX(16px);
        }
        /* #endregion */


        /* #region 选择控件 */
        .vte-select-control {
            width: 144px;
            height: 34px;
            border: 1px solid #e5e7eb;
            border-radius: 14px;
            outline: none;
            color: #111827;
            background: #fff;
            font-family: inherit;
            font-size: 13px;
            padding: 0 34px 0 12px;
        }

        /*#endregion */


        /*#region 数字控件 */
        .vte-number-setting-row {
            grid-template-columns: minmax(112px, 1fr) minmax(210px, 1fr);
        }

        .vte-number-row {
            width: 100%;
            min-width: 0;
            height: 40px;
            display: grid;
            grid-template-columns: minmax(0, 1fr) 62px;
            align-items: center;
            column-gap: 10px;
        }

        .vte-number-control {
            width: 100%;
            height: 28px;
            margin: 0;
            accent-color: var(--vte-primary-blue);
            cursor: pointer;
        }

        .vte-number-txt {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 62px;
            height: 30px;
            border-radius: 999px;
            color: var(--vte-black);
            background: var(--vte-gray);
            font-size: 14px;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
            user-select: none;
        }
        /* #endregion */


        /* #region 设置面板页尾 */
        .vte-footer {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 10px;
            padding-top: 4px;
        }
        /* #endregion */


        /* #region 播放器按钮 */
        .${BUTTON_CLASS} svg {
            width: 55%;
            height: 55%;
            display: block;
            pointer-events: none;
        }
        /* #endregion */


        /* #region 鼠标指针 */
        .vte-cursor-visible,
        .vte-cursor-visible * {
            cursor: default !important;
        }

        .vte-cursor-hidden,
        .vte-cursor-hidden * {
            cursor: none !important;
        }

        .vte-cursor-visible .vte-side-button {
            cursor: pointer !important;
        }
        /* #endregion */
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    // #endregion



    // ============================================================
    // #region 图标
    // ============================================================

    const speedIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="34" height="20" viewBox="0 0 111 66" style="overflow:visible">
            <g transform="matrix(0,3,-3,0,94.5,32.5)">
                <path d="M6.138,3.546 C6.468,4.106 6.278,4.826 5.718,5.156 C5.538,5.266 5.338,5.326 5.118,5.326 C5.118,5.326 -5.122,5.326 -5.122,5.326 C-5.772,5.326 -6.302,4.796 -6.302,4.146 C-6.302,3.936 -6.242,3.726 -6.142,3.546 C-6.142,3.546 -1.352,-4.554 -1.352,-4.554 C-0.912,-5.294 0.048,-5.544 0.798,-5.104 C1.028,-4.974 1.218,-4.784 1.348,-4.554 C1.348,-4.554 6.138,3.546 6.138,3.546z" fill="rgb(255,255,255)" style="animation:vteSpeedPulse 1.2s infinite;animation-delay:0.36s"/>
            </g>
            <g transform="matrix(0,3,-3,0,55.5,32.5)">
                <path d="M6.138,3.546 C6.468,4.106 6.278,4.826 5.718,5.156 C5.538,5.266 5.338,5.326 5.118,5.326 C5.118,5.326 -5.122,5.326 -5.122,5.326 C-5.772,5.326 -6.302,4.796 -6.302,4.146 C-6.302,3.936 -6.242,3.726 -6.142,3.546 C-6.142,3.546 -1.352,-4.554 -1.352,-4.554 C-0.912,-5.294 0.048,-5.544 0.798,-5.104 C1.028,-4.974 1.218,-4.784 1.348,-4.554 C1.348,-4.554 6.138,3.546 6.138,3.546z" fill="rgb(255,255,255)" style="animation:vteSpeedPulse 1.2s infinite;animation-delay:0.18s"/>
            </g>
            <g transform="matrix(0,3,-3,0,16.5,32.5)">
                <path d="M6.138,3.546 C6.468,4.106 6.278,4.826 5.718,5.156 C5.538,5.266 5.338,5.326 5.118,5.326 C5.118,5.326 -5.122,5.326 -5.122,5.326 C-5.772,5.326 -6.302,4.796 -6.302,4.146 C-6.302,3.936 -6.242,3.726 -6.142,3.546 C-6.142,3.546 -1.352,-4.554 -1.352,-4.554 C-0.912,-5.294 0.048,-5.544 0.798,-5.104 C1.028,-4.974 1.218,-4.784 1.348,-4.554 C1.348,-4.554 6.138,3.546 6.138,3.546z" fill="rgb(255,255,255)" style="animation:vteSpeedPulse 1.2s infinite;animation-delay:0s"/>
            </g>
        </svg>`;

    const brightnessIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path d="M20 8.69V4h-4.69L12 .69 8.69 4H4v4.69L.69 12 4 15.31V20h4.69L12 23.31 15.31 20H20v-4.69L23.31 12 20 8.69zM12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z" fill="currentColor" />
        </svg>`;

    const volumeIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06Z" fill="currentColor" />
            <path d="M15.9 8.2 A4.5 4.5 0 0 1 15.9 15.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            <path d="M19.1 5.7 A8.25 8.25 0 0 1 19.1 18.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>`;

    const lockIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" fill="currentColor" />
        </svg>`;

    const unlockIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z" fill="currentColor" />
        </svg>`;

    const menuIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" fill="currentColor" />
        </svg>`;

    const closeIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor" />
        </svg>`;

    const forwardIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" fill="currentColor" />
        </svg>`;

    const backwardIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" fill="currentColor" />
        </svg>`;

    const arrowIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path d="M8.5 5L15.5 12L8.5 19" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;

    const singleTapIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2.4"/>
            <path d="M12 3V6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
            <path d="M12 18V21" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
            <path d="M3 12H6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
            <path d="M18 12H21" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
        </svg>`;

    const doubleTapIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path d="M7 6.5L12 11L17 6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M7 14.5L12 19L17 14.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        `;

    const longPressIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path d="M12 4V16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
            <path d="M8 12L12 16L16 12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M6 19V21H18V19" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;

    const horizontalSwipeIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path d="M3 11H21" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
            <path d="M7 7L3 11L7 15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M17 7L21 11L17 15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;

    const verticalSwipeIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <g transform="rotate(90 12 12)">
                <path d="M3 11H21" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
                <path d="M7 7L3 11L7 15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M17 7L21 11L17 15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
            </g>
        </svg>`;


    const buttonAreaIcon = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2.4"/>
            <circle cx="8.5" cy="12" r="1.8" fill="currentColor"/>
            <circle cx="15.5" cy="12" r="1.8" fill="currentColor"/>
        </svg>`;

    // #endregion



    // ============================================================
    // #region 工具类函数
    // ============================================================

    function clamp(value, min, max) {
        return Math.min(Number(max), Math.max(Number(min), Number(value)));
    }


    function formatNumberText(value, step, unit = "") {
        const number = Number(value);
        const decimals = String(step).match(/\.(\d+)/)?.[1].length ?? 0;

        let text;

        if (!Number.isFinite(number)) {
            text = "0";
        } else if (decimals <= 0) {
            text = String(Math.round(number));
        } else {
            text = number.toFixed(decimals).replace(/\.?0+$/, "");
        }

        return `${text}${unit}`;
    }


    function formatTime(seconds) {
        seconds = Math.ceil(Number.isFinite(seconds) ? seconds : 0);
        const hr = Math.floor(seconds / 3600);
        const min = Math.floor((seconds % 3600) / 60);
        const sec = seconds % 60;

        if (hr > 0) return `${hr}:${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
        return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
    }


    function getFullscreenElement() {
        return document.fullscreenElement
            || document.webkitFullscreenElement
            || document.mozFullScreenElement
            || document.msFullscreenElement
            || null;
    }


    // 该控制器对应的视频是否处于（原生）全屏状态
    function isPlayerFullscreen(c) {
        const fe = getFullscreenElement();
        return !!(fe && (fe === c.video || fe.contains(c.video)));
    }


    // 以遮罩层（覆盖在视频上的容器）为基准判断左右半屏
    function getGestureZone(refEl, clientX) {
        const rect = refEl.getBoundingClientRect();
        const localX = clientX - rect.left;
        return localX < rect.width / 2 ? "left" : "right";
    }


    function blockNativeEvent(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
    }


    function resetTimeout(timer, callback, delay) {
        clearTimeout(timer);
        return setTimeout(callback, delay);
    }

    // #endregion



    // ============================================================
    // #region 设置数据
    // ============================================================

    function deepMerge(defaultValue, userValue) {
        if (!userValue || typeof userValue !== "object") return JSON.parse(JSON.stringify(defaultValue));

        const result = {};
        for (const key of Object.keys(defaultValue)) {
            if (defaultValue[key] && typeof defaultValue[key] === "object" && !Array.isArray(defaultValue[key])) {
                result[key] = deepMerge(defaultValue[key], userValue[key]);
            } else {
                result[key] = userValue[key] ?? defaultValue[key];
            }
        }
        return result;
    }


    function loadSettings() {
        return deepMerge(DEFAULT_SETTINGS, GM_getValue(SETTINGS_KEY, DEFAULT_SETTINGS));
    }


    function saveSettings() {
        GM_setValue(SETTINGS_KEY, userSettings);
    }

    // #endregion



    // ============================================================
    // #region 设置面板
    // ============================================================

    function buildSummaryRow(title, icon, colorClass) {
        return `
            <div class="vte-summary">
                <span class="vte-summary-icon ${colorClass}">${icon}</span>
                <span class="vte-summary-title">${title}</span>
            </div>
            <span class="vte-summary-arrow">${arrowIcon}</span>
        `;
    }


    function buildSwitchRow(label, key) {
        const checked = userSettings[key] ? "checked" : "";
        return `
            <div class="vte-row">
                <span class="vte-label">${label}</span>
                <label class="vte-switch-row" data-setting-key="${key}">
                    <input class="vte-switch-control" type="checkbox" ${checked} >
                    <span class="vte-slider"></span>
                </label>
            </div>
        `;
    }


    function buildSelectRow(label, key, options) {
        const value = userSettings[key] ?? DEFAULT_SETTINGS[key];
        const optionHtml = Object.entries(options).map(([optionValue, label]) => {
            const selected = optionValue === value ? "selected" : "";
            return `<option value="${optionValue}" ${selected}>${label}</option>`;
        }).join("");

        return `
            <div class="vte-row">
                <span class="vte-label">${label}</span>
                <div class="vte-select-row" data-setting-key="${key}">
                    <select class="vte-select-control">${optionHtml}</select>
                </div>
            </div>
        `;
    }


    function buildNumberRow(label, key, min, max, step, unit = "") {
        const value = userSettings[key] ?? DEFAULT_SETTINGS[key];
        return `
            <div class="vte-row vte-number-setting-row">
                <span class="vte-label">${label}</span>
                <div class="vte-number-row" data-setting-key="${key}" data-unit="${unit}">
                    <input class="vte-number-control" type="range" min="${min}" max="${max}" step="${step}" value="${value}">
                    <span class="vte-number-txt">${formatNumberText(value, step, unit)}</span>
                </div>
            </div>
        `;
    }


    function updateSettingsPanel(panel) {
        panel.querySelectorAll(".vte-switch-row").forEach((switchRow) => {
            const key = switchRow.dataset.settingKey;
            switchRow.querySelector(".vte-switch-control").checked = userSettings[key];
        });

        panel.querySelectorAll(".vte-select-row").forEach((selectRow) => {
            const key = selectRow.dataset.settingKey;
            selectRow.querySelector(".vte-select-control").value = userSettings[key];
        });

        panel.querySelectorAll(".vte-number-row").forEach((numberRow) => {
            const key = numberRow.dataset.settingKey;
            const step = numberRow.querySelector(".vte-number-control").step;
            const unit = numberRow.dataset.unit;
            numberRow.querySelector(".vte-number-control").value = userSettings[key];
            numberRow.querySelector(".vte-number-txt").textContent = formatNumberText(userSettings[key], step, unit);
        });
    }


    function createSettingsPanel() {
        let panel = document.querySelector("#" + SETTINGS_PANEL_ID);
        if (!panel) {
            panel = document.createElement("div");
            panel.id = SETTINGS_PANEL_ID;
            setHTML(panel, `
                <div class="vte-card-wrap">
                    <div class="vte-card">
                        <div class="vte-header">
                            <div class="vte-title">网页视频触屏手势 设置</div>
                            <button id="vte-close-button" class="vte-button" type="button" data-action="close">${closeIcon}</button>
                        </div>

                        <details class="vte-section">
                            <summary>${buildSummaryRow("单击", singleTapIcon, "vte-summary-icon-purple")}</summary>
                            ${buildNumberRow("进度条显示时长", "pbDuration", 1, 10, 1, "s")}
                        </details>

                        <details class="vte-section">
                            <summary>${buildSummaryRow("双击", doubleTapIcon, "vte-summary-icon-purple")}</summary>
                            ${buildSwitchRow("双击暂停", "doubleTapPause")}
                            ${buildNumberRow("双击判定间隔", "clickTimeout", 100, 1000, 100, "ms")}
                        </details>

                        <details class="vte-section">
                            <summary>${buildSummaryRow("长按", longPressIcon, "vte-summary-icon-blue")}</summary>
                            ${buildSwitchRow("长按倍速", "longPressSpeed")}
                            ${buildNumberRow("长按播放速度", "targetSpeed", 0.25, 10, 0.25, "x")}
                            ${buildNumberRow("长按触发延迟", "pressDelay", 100, 1000, 100, "ms")}
                        </details>

                        <details class="vte-section">
                            <summary>${buildSummaryRow("横向滑动", horizontalSwipeIcon, "vte-summary-icon-green")}</summary>
                            ${buildSwitchRow("横向滑动快进", "horizontalSwipeSeek")}
                            ${buildNumberRow("横向滑动灵敏度", "horizontalSens", 10, 300, 10, "%")}
                        </details>

                        <details class="vte-section">
                            <summary>${buildSummaryRow("纵向滑动", verticalSwipeIcon, "vte-summary-icon-orange")}</summary>
                            ${buildSelectRow("左侧", "verticalSwipeLeft", VERTICAL_ACTIONS)}
                            ${buildSelectRow("右侧", "verticalSwipeRight", VERTICAL_ACTIONS)}
                            ${buildNumberRow("纵向滑动灵敏度", "verticalSens", 10, 300, 10, "%")}
                            ${buildNumberRow("最大亮度", "maxBrightness", 10, 300, 10, "%")}
                            ${buildNumberRow("最大音量", "maxVolume", 10, 300, 10, "%")}
                        </details>

                        <details class="vte-section">
                            <summary>${buildSummaryRow("按钮区域", buttonAreaIcon, "vte-summary-icon-red")}</summary>
                            ${buildSelectRow("左侧", "leftButtonAction", BUTTON_ACTIONS)}
                            ${buildSelectRow("右侧", "rightButtonAction", BUTTON_ACTIONS)}
                            ${buildNumberRow("按钮跳转时长", "btnSeekStep", 1, 30, 1, "s")}
                        </details>

                        <div class="vte-footer">
                            <button id="vte-reset-button" class="vte-button" type="button" data-action="reset">恢复默认</button>
                            <button id="vte-finish-button" class="vte-button" type="button" data-action="close">完成</button>
                        </div>
                    </div>
                </div>
            `);
            panel.style.cssText = `
                position: fixed;
                z-index: 2147483647;
                inset: 0;

                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;

                background: rgba(15, 23, 42, 0.28);
                backdrop-filter: blur(6px);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
            `;

            // 关闭面板，重置面板
            panel.addEventListener("click", (e) => {
                if (e.target.dataset.action === "close" || e.target === panel) {
                    panel.style.display = "none";
                    return;
                }

                if (e.target.dataset.action === "reset") {
                    userSettings = deepMerge(DEFAULT_SETTINGS, {});
                    saveSettings();
                    updateSettingsPanel(panel);
                    return;
                }

            });

            // 开关行，选择行
            panel.addEventListener("change", (e) => {
                const switchRow = e.target.closest(".vte-switch-row");
                if (switchRow) {
                    const key = switchRow.dataset.settingKey;
                    userSettings[key] = e.target.checked;
                    saveSettings();
                    controllers.forEach((controller) => setupButtons(controller));
                    return;
                }

                const selectRow = e.target.closest(".vte-select-row");
                if (selectRow) {
                    const key = selectRow.dataset.settingKey;
                    userSettings[key] = e.target.value;
                    saveSettings();
                    controllers.forEach((controller) => setupButtons(controller));
                    return;
                }
            });

            // 数值行
            panel.addEventListener("input", (e) => {
                const numberRow = e.target.closest(".vte-number-row");
                if (numberRow) {
                    const key = numberRow.dataset.settingKey;
                    const value = clamp(e.target.value, e.target.min, e.target.max);
                    userSettings[key] = value;
                    numberRow.querySelector(".vte-number-txt").textContent = formatNumberText(value, e.target.step, numberRow.dataset.unit);
                    saveSettings();
                    controllers.forEach((controller) => setupButtons(controller));
                    return;
                }
            });

            document.body.appendChild(panel);
        }
        panel.style.display = "flex";
        return panel;
    }

    GM_registerMenuCommand("设置", createSettingsPanel);

    // #endregion



    // ============================================================
    // #region 提示框
    // ============================================================

    function createToast(c) {
        let toast = c.shield.querySelector("#" + TOAST_ID);
        if (!toast) {
            toast = document.createElement("div");
            toast.id = TOAST_ID;
            toast.style.cssText = `
                position: absolute;
                z-index: 100001;
                top: 15%;
                left: 50%;
                transform: translateX(-50%);

                display: none;
                align-items: center;
                justify-content: center;
                gap: 8px;
                padding: 12px 24px;
                border-radius: 8px;

                color: #ffffff;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(8px);

                font-family: "Segoe UI", sans-serif;
                font-size: 20px;
                font-weight: 600;
                line-height: 1;
                text-align: center;
                white-space: nowrap;

                pointer-events: none;
                user-select: none;
            `;
            c.shield.appendChild(toast);
        }
        return toast;
    }


    function showToast(c, svg, text) {
        const toast = createToast(c);
        setHTML(toast, "");
        toast.style.display = "flex";

        if (svg) {
            const iconContainer = document.createElement("span");
            setHTML(iconContainer, svg);
            iconContainer.style.cssText = `
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            `;
            toast.appendChild(iconContainer);
        }

        toast.appendChild(document.createTextNode(text));
    }


    function hideToast(c) {
        clearTimeout(c.toastTimer);
        const toast = c.shield.querySelector("#" + TOAST_ID);
        if (toast) toast.style.display = "none";
    }

    // #endregion



    // ============================================================
    // #region 按钮
    // ============================================================

    function createButton(c, id, action) {
        let button = c.shield.querySelector("#" + id);
        if (!button) {
            button = document.createElement("button");
            button.id = id;
            button.className = BUTTON_CLASS;
            button.type = "button";
            button.style.cssText = `
                position: absolute;
                z-index: 100002;
                top: 50%;
                transform: translateY(-50%);

                display: none;
                align-items: center;
                justify-content: center;
                border: 1px solid rgba(255, 255, 255, 0.4);
                border-radius: 999px;

                color: #ffffff;
                background: rgba(0, 0, 0, 0.4);
                backdrop-filter: blur(6px);
                opacity: 0;

                line-height: 1;

                cursor: pointer;
                pointer-events: none;
                user-select: none;
                touch-action: manipulation;
                transition: opacity ${Number(BUTTON_EXPAND_DURATION)/1000}s ease,
                            transform ${Number(BUTTON_EXPAND_DURATION)/1000}s ease;
            `;

            button.addEventListener("pointerdown", blockNativeEvent, true);
            button.addEventListener("pointerup", blockNativeEvent, true);
            button.addEventListener("click", (e) => {
                blockNativeEvent(e);
                if (!c.isLocked) showPBTemp(c);
                if (button.dataset.action == "lock") {
                    onLockButtonClick(c);
                } else if (button.dataset.action == "menu") {
                    onMenuButtonClick(c, button);
                } else if (button.dataset.action == "backward") {
                    onQuickSeek(c, -userSettings.btnSeekStep);
                } else if (button.dataset.action == "forward") {
                    onQuickSeek(c, userSettings.btnSeekStep);
                }
            }, true);

            c.shield.appendChild(button);
        }

        button.dataset.action = action;
        return button;
    }


    function setButtonVisible(button, visible, offsetY = 0) {
        if (button.dataset.visibleState === String(visible) && button.dataset.offsetY === String(offsetY)) return;
        button.dataset.visibleState = String(visible);
        button.dataset.offsetY = String(offsetY);

        clearTimeout(button.hideTimer);

        if (visible) {
            button.style.display = "flex";
            requestAnimationFrame(() => {
                button.style.opacity = "1";
                button.style.pointerEvents = "auto";
                button.style.transform = `translateY(calc(-50% + ${offsetY}px))`;
            });
        } else {
            button.style.opacity = "0";
            button.style.pointerEvents = "none";
            button.style.transform = "translateY(-50%)";
            button.hideTimer = setTimeout(() => { if (button.style.opacity === "0") button.style.display = "none"; }, BUTTON_EXPAND_DURATION);
        }
    }


    // 仅更新几何尺寸（每帧调用，开销低）
    function updateButtonsLayout(c) {
        const buttonSize = clamp(c.shield.clientWidth * BUTTON_SIZE_RATIO / 100, 32, 64);
        const buttonSide = c.shield.clientWidth * 0.04;

        c.shield.querySelectorAll("." + BUTTON_CLASS).forEach((button) => {
            button.style.width = `${buttonSize}px`;
            button.style.height = `${buttonSize}px`;
            button.style.left = LEFT_BUTTON_IDS.includes(button.id) ? `${buttonSide}px` : "";
            button.style.right = RIGHT_BUTTON_IDS.includes(button.id) ? `${buttonSide}px` : "";
        });
    }


    // 更新图标与显隐状态（状态变化时调用）
    function updateButtonsState(c) {
        const buttonSize = clamp(c.shield.clientWidth * BUTTON_SIZE_RATIO / 100, 32, 64);
        const showMainButton = c.isLocked || c.isPBVisible;

        c.shield.querySelectorAll("." + BUTTON_CLASS).forEach((button) => {
            const isExpanded = c.expandedButtonIds.has(button.id);
            if (button.dataset.action == "lock") {
                setHTML(button, c.isLocked ? lockIcon : unlockIcon);
                setButtonVisible(button, showMainButton);
            } else if (button.dataset.action == "menu") {
                setHTML(button, isExpanded ? closeIcon : menuIcon);
                setButtonVisible(button, showMainButton);
            } else if (button.dataset.action == "backward") {
                setHTML(button, backwardIcon);
                setButtonVisible(button, showMainButton && isExpanded, -buttonSize * 1.25);
            } else if (button.dataset.action == "forward") {
                setHTML(button, forwardIcon);
                setButtonVisible(button, showMainButton && isExpanded, buttonSize * 1.25);
            } else {
                setHTML(button, "");
                setButtonVisible(button, false);
            }
        });
    }


    function setupButtons(c) {
        if (!c.shield) return;

        let leftAction = userSettings.leftButtonAction ?? DEFAULT_SETTINGS.leftButtonAction;
        let rightAction = userSettings.rightButtonAction ?? DEFAULT_SETTINGS.rightButtonAction;

        if (c.isLocked && leftAction !== "lock" && rightAction !== "lock") { c.isLocked = false; }
        if (leftAction !== "menu") LEFT_BUTTON_IDS.forEach((id) => c.expandedButtonIds.delete(id));
        if (rightAction !== "menu") RIGHT_BUTTON_IDS.forEach((id) => c.expandedButtonIds.delete(id));

        createButton(c, LEFT_BUTTON_ID, leftAction);
        createButton(c, LEFT_BACKWARD_BUTTON_ID, "backward");
        createButton(c, LEFT_FORWARD_BUTTON_ID, "forward");
        createButton(c, RIGHT_BUTTON_ID, rightAction);
        createButton(c, RIGHT_BACKWARD_BUTTON_ID, "backward");
        createButton(c, RIGHT_FORWARD_BUTTON_ID, "forward");
        updateButtonsLayout(c);
        updateButtonsState(c);
    }

    // #endregion



    // ============================================================
    // #region 锁定按钮
    // ============================================================

    function finishCurrentGesture(c) {
        clearTimeout(c.pressTimer);
        clearTimeout(c.clickTimer);
        c.clickTimer = null;

        if (c.video && c.gestureType != "") {
            if (c.gestureType == "speed") {
                onLongPressEnd(c);
            } else if (c.gestureType == "seek") {
                onSeekEnd(c);
            } else if (c.gestureType == "brightness") {
                onBrightnessEnd(c);
            } else if (c.gestureType == "volume") {
                onVolumeEnd(c);
            }
        }

        c.isDown = false;
        c.gestureType = "";
    }


    function onLockButtonClick(c) {
        c.isLocked = !c.isLocked;
        if (c.isLocked) {
            c.shield.style.pointerEvents = "auto";
            finishCurrentGesture(c);
            hidePB(c);
            setMouseCursorVisible(c, false);
            showToast(c, lockIcon, "已锁定");
        } else {
            c.shield.style.pointerEvents = "none";
            setMouseCursorVisible(c, null);
            showPBTemp(c);
            showToast(c, unlockIcon, "已解锁");
        }
        c.toastTimer = resetTimeout(c.toastTimer, () => hideToast(c), TOAST_DELAY);
        updateButtonsState(c);
    }

    // #endregion



    // ============================================================
    // #region 菜单按钮
    // ============================================================

    function onMenuButtonClick(c, button) {
        const buttonIds = button.id === LEFT_BUTTON_ID ? LEFT_BUTTON_IDS : RIGHT_BUTTON_IDS;
        const method = c.expandedButtonIds.has(button.id) ? "delete" : "add";
        buttonIds.forEach((id) => c.expandedButtonIds[method](id));
        updateButtonsState(c);
    }


    function onQuickSeek(c, seconds) {
        if (!c.video) return;
        c.video.currentTime = clamp(c.video.currentTime + seconds, 0, c.video.duration);

        showToast(c, "", `${seconds > 0 ? "+" : "−"} ${Math.abs(seconds)}s`);
        c.toastTimer = resetTimeout(c.toastTimer, () => hideToast(c), TOAST_DELAY);
    }

    // #endregion



    // ============================================================
    // #region 鼠标指针
    // ============================================================

    function setMouseCursorVisible(c, visible) {
        if (!c?.video) return;
        const elements = [
            c.video,
            c.video.parentElement,
            c.shield,
        ];

        elements.forEach((element) => {
            if (!(element instanceof Element)) return;

            if (visible === true) {
                element.classList.add("vte-cursor-visible");
                element.classList.remove("vte-cursor-hidden");
            } else if (visible === false) {
                element.classList.remove("vte-cursor-visible");
                element.classList.add("vte-cursor-hidden");
            } else if (visible === null) {
                element.classList.remove("vte-cursor-visible");
                element.classList.remove("vte-cursor-hidden");
            }
        });

        if (visible === null) {
            clearTimeout(c.cursorTimer);
            c.cursorTimer = null;
        }
    }


    function showMouseCursorTemp(c) {
        setMouseCursorVisible(c, true);
        c.cursorTimer = resetTimeout(c.cursorTimer, () => setMouseCursorVisible(c, false), 500);
    }

    // #endregion



    // ============================================================
    // #region 单指单击：进度条
    // ============================================================

    function sendMouseEvent(element, type, x = 0, y = 0) {
        if (!element) return;
        try {
            element.dispatchEvent(new win.MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                composed: true,
                view: win,
                clientX: x,
                clientY: y,
            }));
        } catch {}
    }


    function getMouseEventTargets(video) {
        const targets = [];
        const add = (element) => { if (element?.dispatchEvent && !targets.includes(element)) targets.push(element); };
        
        add(video);
        add(video?.parentElement);
        add(getPlayerContainer(video));
        add(video?.closest("[id*='player' i], [class*='player' i], [id*='video' i], [class*='video' i]"));
        
        add(document.body);
        add(document.documentElement);
        add(document);

        return targets;
    }


    function toggleYouTubePB(video, visible) {
        const player = video.closest(".html5-video-player, #movie_player");
        if (!player) return;
        player.classList.toggle("ytp-autohide", !visible);
    }


    function showPB(c) {
        if (!c.video) return;
        c.isPBVisible = true;
        updateButtonsState(c);
        setMouseCursorVisible(c, true);

        clearInterval(c.pbKeepTimer);
        clearTimeout(c.pbHideTimer);
        c.pbKeepTimer = null;
        c.pbHideTimer = null;

        const moveMouse = () => {
            const rect = c.video.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height * 0.1;
            getMouseEventTargets(c.video).forEach((target) => sendMouseEvent(target, "mousemove", x, y));
            toggleYouTubePB(c.video, true);
        };

        moveMouse();
        c.pbKeepTimer = setInterval(moveMouse, 1000);
    }


    function hidePB(c) {
        if (!c.video) return;
        c.isPBVisible = false;
        updateButtonsState(c);
        setMouseCursorVisible(c, false);

        clearInterval(c.pbKeepTimer);
        clearTimeout(c.pbHideTimer);
        c.pbKeepTimer = null;
        c.pbHideTimer = null;

        const rect = c.video.getBoundingClientRect();
        const x = rect.right + 10;
        const y = rect.bottom + 10;
        getMouseEventTargets(c.video).forEach((target) => {
            sendMouseEvent(target, "mouseleave", x, y);
            sendMouseEvent(target, "mouseout", x, y);
        });
        toggleYouTubePB(c.video, false);
    }


    function showPBTemp(c) {
        showPB(c);
        c.pbHideTimer = resetTimeout(c.pbHideTimer, () => hidePB(c), userSettings.pbDuration * 1000);
    }

    // #endregion



    // ============================================================
    // #region 单指双击：播放暂停
    // ============================================================

    function onDoubleTap(c) {
        if (!c.video) return;
        c.video.paused ? c.video.play().catch(() => {}) : c.video.pause();
    }

    // #endregion



    // ============================================================
    // #region 单指长按：倍速播放
    // ============================================================

    function onLongPressStart(c) {
        if (!c.video) return;
        c.originalSpeed = c.video.playbackRate;
        c.video.playbackRate = userSettings.targetSpeed;
        const targetSpeed = Number(userSettings.targetSpeed);
        const speedText = Number.isInteger(targetSpeed) ? targetSpeed.toFixed(1) : String(targetSpeed);
        showToast(c, speedIcon, speedText + "x");
    }


    function onLongPressEnd(c) {
        if (!c.video) return;
        c.video.playbackRate = c.originalSpeed;
        hideToast(c);
    }

    // #endregion



    // ============================================================
    // #region 横向滑动：调节进度
    // ============================================================

    function onSeekStart(c, clientX) {
        if (!c.video) return;
        c.prevX = clientX;
        c.startVal = c.video.currentTime;
        showPB(c);
    }


    function onSeek(c, clientX) {
        if (!c.video) return;
        c.startVal = c.startVal + (clientX - c.prevX) / (c.shield.clientWidth * (userSettings.horizontalSens / 100)) * c.video.duration;
        c.startVal = clamp(c.startVal, 0, c.video.duration);
        c.prevX = clientX;
        c.video.currentTime = c.startVal;
        showToast(c, "", `${formatTime(c.startVal)} / ${formatTime(c.video.duration)}`);
    }


    function onSeekEnd(c) {
        if (!c.video) return;
        hidePB(c);
        hideToast(c);
    }

    // #endregion



    // ============================================================
    // #region 纵向滑动：调节亮度
    // ============================================================

    function getCurrentBrightness(video) {
        const filter = video.style.filter;
        if (!filter || !filter.includes("brightness")) return 1;

        const match = filter.match(/brightness\(([\d.]+)\)/);
        return match ? parseFloat(match[1]) : 1;
    }


    function onBrightnessStart(c, clientY) {
        c.prevY = clientY;
        c.startVal = getCurrentBrightness(c.video);
    }


    function onBrightness(c, clientY) {
        const video = c.video;
        c.startVal = c.startVal + (c.prevY - clientY) / (c.shield.clientHeight * (userSettings.verticalSens / 100));
        c.startVal = clamp(c.startVal, 0, userSettings.maxBrightness / 100);
        c.prevY = clientY;

        video.style.filter = `brightness(${c.startVal})`;
        showToast(c, brightnessIcon, `${Math.round(c.startVal * 100)}%`);
    }


    function onBrightnessEnd(c) {
        c.toastTimer = resetTimeout(c.toastTimer, () => hideToast(c), TOAST_DELAY);
    }

    // #endregion



    // ============================================================
    // #region 纵向滑动：调节音量
    // ============================================================

    // 仅在需要音量增益（>100%）时才创建 Web Audio 节点
    // 注意：跨域且未开启 CORS 的媒体经过 Web Audio 可能会静音，故仅按需创建并做兜底
    function getGainNode(c) {
        if (!c.gainNode) {
            const stored = audioStores.get(c.video);
            if (stored) {
                c.ctx = stored.ctx;
                c.sourceNode = stored.sourceNode;
                c.gainNode = stored.gainNode;
                return c.gainNode;
            }

            try {
                c.ctx = c.ctx || new (win.AudioContext || win.webkitAudioContext)();
                if (c.ctx.state === "suspended") c.ctx.resume().catch(() => {});
                c.sourceNode = c.ctx.createMediaElementSource(c.video);

                c.gainNode = c.ctx.createGain();
                c.gainNode.gain.value = 1;

                c.sourceNode.connect(c.gainNode);
                c.gainNode.connect(c.ctx.destination);
                audioStores.set(c.video, {
                    ctx: c.ctx,
                    sourceNode: c.sourceNode,
                    gainNode: c.gainNode
                });
            } catch {
                c.gainNode = null;
            }
        }
        return c.gainNode;
    }


    function onVolumeStart(c, clientY) {
        c.prevY = clientY;
        c.startVal = c.gainNode?.gain.value > 1 ? c.gainNode.gain.value : c.video.volume;
    }


    function onVolume(c, clientY) {
        const video = c.video;
        c.startVal = c.startVal + (c.prevY - clientY) / (c.shield.clientHeight * (userSettings.verticalSens / 100));
        c.startVal = clamp(c.startVal, 0, userSettings.maxVolume / 100);
        c.prevY = clientY;

        if (c.startVal <= 1) {
            video.volume = c.startVal;
            if (c.gainNode) c.gainNode.gain.value = 1;
        } else {
            video.volume = 1;
            const g = getGainNode(c);
            if (g) {
                g.gain.value = c.startVal;
            } else {
                // 无法增益（如跨域媒体），限制在 100%
                c.startVal = 1;
            }
        }
        showToast(c, volumeIcon, `${Math.round(c.startVal * 100)}%`);
    }


    function onVolumeEnd(c) {
        c.toastTimer = resetTimeout(c.toastTimer, () => hideToast(c), TOAST_DELAY);
    }

    // #endregion



    // ============================================================
    // #region 手势识别与分发
    // ============================================================

    function handleDown(c, e) {
        blockNativeEvent(e);
        if (c.isLocked) return;
        if (!e.isPrimary || e.button == 2) return;

        const video = c.video;
        if (!video) return;

        c.isDown = true;
        c.gestureType = "";
        c.startX = e.clientX;
        c.startY = e.clientY;

        // 启动长按计时器
        if (userSettings.longPressSpeed) {
            c.pressTimer = setTimeout(() => {
                if (c.gestureType == "") {
                    c.gestureType = "speed";
                    onLongPressStart(c);
                }
            }, userSettings.pressDelay);
        }
    }


    function handleMove(c, e) {
        blockNativeEvent(e);
        if (c.isLocked) return;
        if (!c.isDown) return;

        const video = c.video;
        if (!video) return;

        c.deltaX = e.clientX - c.startX;
        c.deltaY = c.startY - e.clientY;
        c.absX = Math.abs(c.deltaX);
        c.absY = Math.abs(c.deltaY);

        // 手势未确定，判断滑动方向
        if (c.gestureType == "" && (c.absX > 15 || c.absY > 15)) {
            clearTimeout(c.pressTimer);

            if (c.absX > c.absY) {
                if (userSettings.horizontalSwipeSeek) {
                    c.gestureType = "seek";
                    onSeekStart(c, e.clientX);
                } else {
                    c.gestureType = "none";
                }
            } else {
                const zone = getGestureZone(c.shield, c.startX);
                const action = zone === "left" ? userSettings.verticalSwipeLeft : userSettings.verticalSwipeRight;

                if (action == "brightness") {
                    c.gestureType = "brightness";
                    onBrightnessStart(c, e.clientY);
                } else if (action == "volume") {
                    c.gestureType = "volume";
                    onVolumeStart(c, e.clientY);
                } else {
                    c.gestureType = "none";
                }
            }
        }

        // 手势已确定，持续更新
        if (c.gestureType != "") {
            if (c.gestureType == "seek") {
                onSeek(c, e.clientX);
            } else if (c.gestureType == "brightness") {
                onBrightness(c, e.clientY);
            } else if (c.gestureType == "volume") {
                onVolume(c, e.clientY);
            }
        }
    }


    function handleUp(c, e) {
        blockNativeEvent(e);
        if (c.isLocked) return;
        clearTimeout(c.pressTimer);

        const video = c.video;
        if (!video) {
            c.isDown = false;
            c.gestureType = "";
            return;
        }

        c.deltaX = e.clientX - c.startX;
        c.deltaY = c.startY - e.clientY;
        c.absX = Math.abs(c.deltaX);
        c.absY = Math.abs(c.deltaY);

        // 无滑动、无长按 → 单击或双击
        if (c.gestureType == "" && (c.absX < 10 && c.absY < 10)) {
            if (!c.clickTimer) {
                c.clickTimer = setTimeout(() => {
                    c.clickTimer = null;
                    c.isPBVisible ? hidePB(c) : showPBTemp(c);
                }, userSettings.clickTimeout);
            } else {
                clearTimeout(c.clickTimer);
                c.clickTimer = null;
                if (userSettings.doubleTapPause) onDoubleTap(c);
            }
        }

        // 手势结束收尾
        if (c.gestureType != "") {
            if (c.gestureType == "speed") {
                onLongPressEnd(c);
            } else if (c.gestureType == "seek") {
                onSeekEnd(c);
            } else if (c.gestureType == "brightness") {
                onBrightnessEnd(c);
            } else if (c.gestureType == "volume") {
                onVolumeEnd(c);
            }
        }

        c.isDown = false;
        c.gestureType = "";
    }

    // #endregion



    // ============================================================
    // #region 控件命中与放行判断
    // ============================================================

    // 判断元素是否属于脚本自己的遮罩、按钮或设置面板。
    function isVteElement(element) {
        if (!(element instanceof Element)) return false;
        return !!element.closest(`#${SHIELD_ID}, #${SETTINGS_PANEL_ID}`);
    }


    // 判断元素当前是否可见且能接收指针事件。
    function isElementVisible(element) {
        if (!(element instanceof Element)) return false;

        const rect = element.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return false;
        if (rect.right <= 0 || rect.left >= window.innerWidth) return false;
        if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false;
        if (getComputedStyle(element).pointerEvents === "none") return false;

        for (let node = element; node && node instanceof Element; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === "none") return false;
            if (style.visibility === "hidden" || style.visibility === "collapse") return false;
            if (Number(style.opacity) <= 0.05) return false;
        }

        return true;
    }


    function isSameSizeAsVideoArea(c, element) {
        if (!c?.video || !(element instanceof Element)) return false;

        const videoRect = c.video.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        const tolerance = 100;

        return Math.abs(rect.left - videoRect.left) <= tolerance &&
            Math.abs(rect.right - videoRect.right) <= tolerance &&
            Math.abs(rect.top - videoRect.top) <= tolerance &&
            Math.abs(rect.bottom - videoRect.bottom) <= tolerance;
    }


    // 判断元素矩形是否和视频画面区域发生重叠。
    function overlapsVideoArea(c, element) {
        if (!c?.video || !(element instanceof Element)) return false;

        const videoRect = c.video.getBoundingClientRect();
        const rect = element.getBoundingClientRect();

        return rect.right > videoRect.left &&
            rect.left < videoRect.right &&
            rect.bottom > videoRect.top &&
            rect.top < videoRect.bottom;
    }


    // 从 video 向上寻找最近的播放器交互容器。
    function getPlayerContainer(video) {
        for (let node = video?.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
            for (const child of node.children) {
                if (child === video || child.contains(video)) continue;
                if (isElementVisible(child)) return node;
            }
        }

        return video?.parentElement || null;
    }


    // 判断当前点击是否命中了视频区域内应放行的原生控件。
    function isWidgetTarget(c, e) {
        const container = getPlayerContainer(c.video);
        if (!container) return false;

        const elements = document.elementsFromPoint(e.clientX, e.clientY);
        for (const element of elements) {
            if (!(element instanceof Element)) continue;
            if (isVteElement(element)) continue;
            if (element === c.video || element.contains(c.video)) continue;
            if (!container.contains(element)) continue;
            if (!isElementVisible(element)) continue;
            if (isSameSizeAsVideoArea(c, element)) continue;
            if (!overlapsVideoArea(c, element)) continue;

            return true;
        }
        return false;
    }


    function debugClickElement(c, e, label = "click") {
        console.groupCollapsed(`[VTE] ${label} hit test`);

        console.log("event:", e.type);
        console.log("x/y:", e.clientX, e.clientY);
        console.log("eventTarget:", e.target);
        console.log("video:", c?.video);

        document.elementsFromPoint(e.clientX, e.clientY).forEach((el, index) => {
            console.log(index, {
                tag: el.tagName,
                id: el.id,
                className: String(el.className),
                role: el.getAttribute?.("role"),
                ariaLabel: el.getAttribute?.("aria-label"),
                dataPurpose: el.getAttribute?.("data-purpose"),
                pointerEvents: getComputedStyle(el).pointerEvents,
                rect: el.getBoundingClientRect(),
                element: el,
            });
        });

        console.groupEnd();
    }

    // #endregion



    // ============================================================
    // #region 全局事件接管
    // ============================================================

    let activeController = null;
    let activePointerId = null;
    let lastMouseController = null;
    let blockNativeClickUntil = 0;


    // 根据坐标找到当前视频区域对应的控制器。
    function getControllerAtPoint(x, y) {
        const list = Array.from(controllers.values()).reverse();

        for (const c of list) {
            if (!c?.shield || c.shield.style.display === "none") continue;
            const rect = c.shield.getBoundingClientRect();
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return c;
        }

        return null;
    }


    function onGesturePointerDown(e) {
        if (!e.isPrimary || e.button === 2) return;
        if (isVteElement(e.target)) return;
        
        const c = getControllerAtPoint(e.clientX, e.clientY);
        if (!c) return;

        debugClickElement(c, e, "pointerdown");

        if (isWidgetTarget(c, e)) return;

        activeController = c;
        activePointerId = e.pointerId;
        blockNativeClickUntil = Date.now() + NATIVE_CLICK_BLOCK_DURATION;

        handleDown(c, e);
    }


    function onGesturePointerMove(e) {
        if (!activeController) return;
        if (e.pointerId !== activePointerId) return;
        handleMove(activeController, e);
    }


    function onGesturePointerEnd(e) {
        if (!activeController) return;
        if (e.pointerId !== activePointerId) return;

        const c = activeController;
        const hadGesture = c.gestureType !== "";

        handleUp(c, e);
        if (hadGesture) blockNativeClickUntil = Date.now() + NATIVE_CLICK_BLOCK_DURATION;

        activeController = null;
        activePointerId = null;
    }


    function onGestureMouseMove(e) {
        if (!(e.target instanceof Element)) return;

        const hitShield = e.target.closest(`#${SHIELD_ID}`);
        const c = hitShield ? Array.from(controllers.values()).find((c) => c.shield === hitShield) : getControllerAtPoint(e.clientX, e.clientY);
        const isSideButton = !!e.target.closest(`.${BUTTON_CLASS}`);

        if (lastMouseController && lastMouseController !== c && !lastMouseController.isDown && !lastMouseController.isLocked)
            hidePB(lastMouseController);
        lastMouseController = c;

        if (!c) return;

        if (c.isLocked) {
            blockNativeEvent(e);
            if (c.isPBVisible) hidePB(c);
            showMouseCursorTemp(c);
            return;
        }

        if (isSideButton) {
            showPB(c);
            return;
        }

        if (c.isDown || e.isTrusted === false) return;
        if (isWidgetTarget(c, e)) return;

        showPBTemp(c);
    }


    function onNativeMouseClick(e) {
        if (!(e.target instanceof Element)) return;
        if (e.target.closest(`.${BUTTON_CLASS}`)) return;

        const hitShield = e.target.closest(`#${SHIELD_ID}`);
        const c = hitShield ? Array.from(controllers.values()).find((controller) => controller.shield === hitShield) : getControllerAtPoint(e.clientX, e.clientY);

        if (!c) return;

        if (c.isLocked) {
            blockNativeEvent(e);
            if (c.isPBVisible) hidePB(c);
            showMouseCursorTemp(c);
            return;
        }

        if (isWidgetTarget(c, e)) return;
        if (Date.now() > blockNativeClickUntil) return;
        blockNativeEvent(e);
    }


    function bindGestureEvents() {
        if (bindGestureEvents.bound) return;
        bindGestureEvents.bound = true;

        document.addEventListener("pointerdown", onGesturePointerDown, true);
        document.addEventListener("pointermove", onGesturePointerMove, true);
        document.addEventListener("pointerup", onGesturePointerEnd, true);
        document.addEventListener("pointercancel", onGesturePointerEnd, true);

        document.addEventListener("mousemove", onGestureMouseMove, true);
        document.addEventListener("mousedown", onNativeMouseClick, true);
        document.addEventListener("mouseup", onNativeMouseClick, true);

        document.addEventListener("click", onNativeMouseClick, true);
        document.addEventListener("dblclick", onNativeMouseClick, true);
        document.addEventListener("auxclick", (e) => { if (getControllerAtPoint(e.clientX, e.clientY)) blockNativeEvent(e); }, true);
        document.addEventListener("contextmenu", (e) => { if (getControllerAtPoint(e.clientX, e.clientY)) blockNativeEvent(e); }, true);
    }

    // #endregion



    // ============================================================
    // #region 控制器 controller
    // ============================================================

    function setTouchAction(c) {
        const elements = [
            c.video,
            c.video?.parentElement,
            getPlayerContainer(c.video),
            c.video?.closest("[id*='player' i], [class*='player' i], [id*='video' i], [class*='video' i]")
        ];

        elements.forEach((element) => {
            if (!(element instanceof HTMLElement)) return;
            if (element.dataset.vteOldTouchAction == null) {
                element.dataset.vteOldTouchAction = element.style.touchAction || "";
            }
            element.style.touchAction = "none";
        });
    }


    function restoreTouchAction(c) {
        const elements = [
            c.video,
            c.video?.parentElement,
            getPlayerContainer(c.video),
            c.video?.closest("[id*='player' i], [class*='player' i], [id*='video' i], [class*='video' i]")
        ];

        elements.forEach((element) => {
            if (!(element instanceof HTMLElement)) return;
            element.style.touchAction = element.dataset.vteOldTouchAction || "";
            delete element.dataset.vteOldTouchAction;
        });
    }


    function createController(video) {
        const shield = document.createElement("div");
        shield.id = SHIELD_ID;
        shield.style.cssText = `
            position: fixed;
            z-index: ${SHIELD_Z_INDEX};
            top: 0;
            left: 0;
            width: 0;
            height: 0;
            pointer-events: none;
            overflow: visible;
        `;

        const c = {
            video,
            shield,

            isLocked: false,
            isPBVisible: true,
            expandedButtonIds: new Set(),

            // 手势会话状态
            isDown: false,
            gestureType: "",
            startX: 0, startY: 0,
            deltaX: 0, deltaY: 0,
            absX: 0, absY: 0,
            prevX: 0, prevY: 0,
            startVal: 0,
            originalSpeed: 1.0,

            // 计时器
            pressTimer: null,
            clickTimer: null,
            toastTimer: null,
            pbKeepTimer: null,
            pbHideTimer: null,
            cursorTimer: null,

            // 全屏状态记忆
            wasFullscreen: false,

            // 音频
            ctx: null,
            sourceNode: null,
            gainNode: null,
        };

        setTouchAction(c);
        document.body.appendChild(shield);
        setupButtons(c);
        return c;
    }


    function teardownController(c) {
        clearTimeout(c.pressTimer);
        clearTimeout(c.clickTimer);
        clearTimeout(c.toastTimer);
        clearInterval(c.pbKeepTimer);
        clearTimeout(c.pbHideTimer);
        clearTimeout(c.cursorTimer);
        setMouseCursorVisible(c, null);
        restoreTouchAction(c);
        c.shield?.remove();
    }


    function getVisibleRect(video) {
        const rect = video.getBoundingClientRect();
        const left = clamp(rect.left, 0, window.innerWidth);
        const right = clamp(rect.right, 0, window.innerWidth);
        const top = clamp(rect.top, 0, window.innerHeight);
        const bottom = clamp(rect.bottom, 0, window.innerHeight);
        return {
            rect,
            width: Math.max(0, right - left),
            height: Math.max(0, bottom - top)
        };
    }


    function isAdLikeVideo(video) {
        let node = video;
        for (let i = 0; node && i < 5; i += 1, node = node.parentElement) {
            const text = `${node.id || ""} ${node.className || ""}`;
            if (/(^|[\s_-])(ad|ads|advert|advertisement|promotion|sponsor)([\s_-]|$)/i.test(text)) return true;
        }
        return false;
    }


    function isVideoEligible(video) {
        if (!video || !video.isConnected) return false;
        if (isAdLikeVideo(video)) return false;

        const style = win.getComputedStyle(video);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;

        const { rect, width, height } = getVisibleRect(video);
        if (rect.width < MIN_VIDEO_WIDTH || rect.height < MIN_VIDEO_HEIGHT) return false;
        if (width < MIN_VIDEO_WIDTH || height < MIN_VIDEO_HEIGHT) return false;
        if (video.readyState === 0 && !video.currentSrc && !video.src) return false;

        return true;
    }


    function getVideoScore(video) {
        const { width, height } = getVisibleRect(video);
        let score = width * height;
        if (!video.paused && !video.ended) score += 100000000;
        if (video === document.pictureInPictureElement) score += 50000000;
        if (Number.isFinite(video.duration) && video.duration > 60) score += 10000;
        return score;
    }


    function selectPrimaryVideo() {
        let selectedVideo = null;
        let selectedScore = -1;

        document.querySelectorAll("video").forEach((video) => {
            if (!isVideoEligible(video)) return;
            const score = getVideoScore(video);
            if (score > selectedScore) {
                selectedVideo = video;
                selectedScore = score;
            }
        });

        return selectedVideo;
    }

    // #endregion



    // ============================================================
    // #region 初始化
    // ============================================================

    function syncLayout() {
        if (controllers.size === 0) {
            rafId = null;
            return;
        }

        const fe = getFullscreenElement();

        controllers.forEach((c) => {
            const video = c.video;
            if (!video.isConnected) return;

            const inFullscreen = isPlayerFullscreen(c);

            if (inFullscreen) {
                // 全屏：把遮罩挂进全屏元素内部（否则不会被渲染），铺满
                const host = (fe === video && video.parentElement) ? video.parentElement : fe;
                if (c.shield.parentElement !== host) host.appendChild(c.shield);
                c.shield.style.position = "absolute";
                c.shield.style.left = "0";
                c.shield.style.top = "0";
                c.shield.style.width = "100%";
                c.shield.style.height = "100%";
                c.shield.style.display = "";
            } else {
                // 普通：固定定位，实时贴合视频在视口中的位置
                if (c.shield.parentElement !== document.body) document.body.appendChild(c.shield);
                const rect = video.getBoundingClientRect();
                const tooSmall = rect.width < MIN_VIDEO_WIDTH || rect.height < MIN_VIDEO_HEIGHT;
                const offscreen = rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth;
                c.shield.style.display = (tooSmall || offscreen) ? "none" : "";
                c.shield.style.position = "fixed";
                c.shield.style.left = `${rect.left}px`;
                c.shield.style.top = `${rect.top}px`;
                c.shield.style.width = `${rect.width}px`;
                c.shield.style.height = `${rect.height}px`;
            }

            updateButtonsLayout(c);

            // 全屏状态变化时刷新按钮尺寸/偏移
            if (c.wasFullscreen !== inFullscreen) {
                c.wasFullscreen = inFullscreen;
                updateButtonsState(c);
            }
        });

        rafId = requestAnimationFrame(syncLayout);
    }


    function scan() {
        const primaryVideo = selectPrimaryVideo();

        controllers.forEach((c, video) => {
            if (!video.isConnected || video !== primaryVideo) {
                teardownController(c);
                controllers.delete(video);
            }
        });

        if (primaryVideo && !controllers.has(primaryVideo)) 
            controllers.set(primaryVideo, createController(primaryVideo));

        if (controllers.size > 0 && rafId == null) 
            rafId = requestAnimationFrame(syncLayout);
    }


    function scheduleScan() {
        if (scanTimer) return;
        scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 250);
    }


    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(scheduleScan, 3000);

    window.addEventListener("resize", scheduleScan);
    window.addEventListener("pageshow", scheduleScan);
    window.addEventListener("popstate", scheduleScan);
    window.addEventListener("load", scan);

    bindGestureEvents();
    scan();

    // #endregion

})();
