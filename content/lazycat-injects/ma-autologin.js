/*
 * 懒猫微服 · Music Assistant 免密登录 / 首次初始化 / 打开即同步
 * ---------------------------------------------------------------------------
 * 由 lzc-manifest.yml 的 browser inject（id: ma-login-autofill）注入到 /、/setup、/login。
 *
 * 为什么需要它
 * ------------
 * MA 是「自带账号体系」的应用：首次打开没有用户时给安装向导（/setup），之后打开给登录页，
 * 要求输入 admin + 密码。评审/用户打开应用不该看到密码页（与微服其它应用一致）。
 * 包内已经固定了管理员账号（manifest 的 LZC_MA_USER / LZC_MA_PASS，与 lzc-sync-agent.py 共用），
 * 所以这里在页面脚本之前就把登录做掉，用户无感。
 *
 * 关键实现（踩过坑，别改）
 * ------------------------
 * 1. 必须在 app 的 module 脚本之前拿到 token：MA 前端是 `<script type="module">`（deferred），
 *    而本脚本以普通 `<script>` 在解析 HTML 时同步执行 ⇒ 用**同步 XHR** 登录并写
 *    localStorage['ma_access_token']，app 启动时就已经是「已登录」状态，不会闪登录页。
 * 2. token 存的是 JWT 原文（前端 auth 模块：var S=`ma_access_token`; localStorage.setItem(S, token)）。
 *    写入前用 payload.exp 判断是否过期，过期就重新登录。
 * 3. 服务端还没有任何用户时（全新安装、且同步助手还没跑到）先 POST /setup 建号，
 *    与 content/lzc-sync-agent.py 互为兜底：谁先到谁建，另一个收到「已初始化」也只是重试登录。
 * 4. MA 的文件系统音乐源默认 3 小时才同步一次；打开页面时顺手触发一轮 music/sync
 *    （每个标签页会话一次，失败静默），让「放进文稿的音乐」尽快出现在「歌曲」里。
 * 5. soft-fail：任何异常都不抛出，页面照常加载（注入脚本报错会让整个页面 500）。
 */
(function () {
  'use strict';

  var PARAMS = {};
  try {
    // 平台注入脚本可访问 ctx（params 来自 manifest 的 do[].params）；取不到就用包内固定值。
    var c = (typeof ctx !== 'undefined' && ctx) || null;
    if (c && c.params && typeof c.params === 'object') PARAMS = c.params;
  } catch (e) {}

  var USER = (PARAMS.user || 'admin');
  var PASS = (PARAMS.password || 'MaLzc-8Qx4Rz');
  var TOKEN_KEY = 'ma_access_token';
  var LOG = '[lzc-ma-autologin]';

  function say() {
    try {
      var a = Array.prototype.slice.call(arguments);
      a.unshift(LOG);
      console.info.apply(console, a);
    } catch (e) {}
  }

  // ── 同步 XHR（必须在 app 脚本之前完成，因此不能用 fetch/await）─────────────
  function postSync(path, payload) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', path, false); // false = 同步，故意如此
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify(payload));
      var text = xhr.responseText || '';
      var data = null;
      try { data = JSON.parse(text); } catch (e) {}
      return { status: xhr.status, data: data, text: text };
    } catch (e) {
      return { status: 0, data: null, text: String(e) };
    }
  }

  function apiSync(command, args, token) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api', false);
      xhr.setRequestHeader('Content-Type', 'application/json');
      if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.send(JSON.stringify({ message_id: 1, command: command, args: args || {} }));
      var data = null;
      try { data = JSON.parse(xhr.responseText || ''); } catch (e) {}
      return { status: xhr.status, data: data, text: xhr.responseText || '' };
    } catch (e) {
      return { status: 0, data: null, text: String(e) };
    }
  }

  function tokenFrom(res) {
    var d = res && res.data;
    if (!d || typeof d !== 'object') return '';
    if (typeof d.access_token === 'string') return d.access_token;
    if (typeof d.token === 'string') return d.token;
    var r = d.result;
    if (r && typeof r === 'object') {
      if (typeof r.access_token === 'string') return r.access_token;
      if (typeof r.token === 'string') return r.token;
    }
    return '';
  }

  function decodePayload(jwt) {
    try {
      var part = String(jwt).split('.')[1];
      if (!part) return null;
      var b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return JSON.parse(decodeURIComponent(escape(atob(b64))));
    } catch (e) {
      return null;
    }
  }

  function isUsable(jwt) {
    if (!jwt || typeof jwt !== 'string') return false;
    var claims = decodePayload(jwt);
    if (!claims) return false;
    if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now() + 60000) return false;
    return true;
  }

  function login() {
    var res = apiSync('auth/login', { username: USER, password: PASS, device_name: 'lzc-autologin' });
    var token = tokenFrom(res);
    if (token) return token;
    // 服务器还没有任何用户（全新安装）→ 先初始化，再登录一次。
    say('login failed (HTTP ' + res.status + ')，按全新安装处理：尝试 /setup');
    postSync('/setup', { username: USER, password: PASS, device_name: 'lzc-autologin' });
    res = apiSync('auth/login', { username: USER, password: PASS, device_name: 'lzc-autologin' });
    token = tokenFrom(res);
    if (token) return token;
    say('setup/login 都失败（HTTP ' + res.status + '）：' + String(res.text).slice(0, 120));
    return '';
  }

  function ensureToken() {
    var stored = '';
    try { stored = window.localStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
    if (isUsable(stored)) return stored;
    var token = login();
    if (!token) return '';
    try { window.localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
    say('已免密登录：' + USER);
    return token;
  }

  // ── 打开页面顺手触发一轮库同步（每标签页会话一次）────────────────────────
  function syncOnOpen(token) {
    try {
      if (!token || !window.sessionStorage) return;
      if (window.sessionStorage.getItem('lzc_ma_synced') === '1') return;
      window.sessionStorage.setItem('lzc_ma_synced', '1');
      // 用微任务延后，别拖慢首屏；失败静默（服务端可能还在启动）。
      setTimeout(function () {
        try {
          var xhr = new XMLHttpRequest();
          xhr.open('POST', '/api', true);
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.setRequestHeader('Authorization', 'Bearer ' + token);
          xhr.onerror = function () {};
          xhr.send(JSON.stringify({
            message_id: 99,
            command: 'music/sync',
            args: { media_types: ['track', 'album', 'artist'] }
          }));
        } catch (e) {}
      }, 1500);
    } catch (e) {}
  }

  // ── 登录页/初始化页兜底：把表单填好，避免任何情况下出现「空白密码页」──────
  function fillLoginForm() {
    try {
      var forms = document.querySelectorAll('form');
      for (var i = 0; i < forms.length; i++) {
        var inputs = forms[i].querySelectorAll('input');
        var userEl = null, passEl = null;
        for (var j = 0; j < inputs.length; j++) {
          var t = (inputs[j].getAttribute('type') || '').toLowerCase();
          if (t === 'password') passEl = inputs[j];
          else if (!userEl && (t === 'text' || t === 'email' || !t)) userEl = inputs[j];
        }
        if (!passEl) continue;
        if (userEl && !userEl.value) {
          userEl.value = USER;
          userEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (!passEl.value) {
          passEl.value = PASS;
          passEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    } catch (e) {}
  }

  // ── 兜底：页面已经按「未登录」渲染出登录页（bootstrap 没赶上/服务还在起）────
  // 只在「现在我们确实有 token，但界面是登录页」时刷新一次，且每会话最多一次，
  // 避免任何刷新环。正常情况下 manifest 里 response 阶段内联的
  // data-lzc-ma-bootstrap 会先于 app 脚本拿到 token，这条路根本不会触发。
  function reloadIfStuckOnLogin(token) {
    try {
      if (!token) return false;
      var hasPw = document.querySelector('input[type=password]');
      if (!hasPw) return false;
      if (window.sessionStorage.getItem('lzc_ma_reloaded') === '1') return false;
      window.sessionStorage.setItem('lzc_ma_reloaded', '1');
      say('界面仍是登录页，token 已就绪 → 刷新一次');
      window.location.reload();
      return true;
    } catch (e) {
      return false;
    }
  }

  try {
    var token = ensureToken();
    if (token) {
      syncOnOpen(token);
      var reloading = reloadIfStuckOnLogin(token);
      if (!reloading) {
        // 页面里可能残留登录页（token 写入前已经渲染过），把表单填好。
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function () {
            if (!reloadIfStuckOnLogin(token)) fillLoginForm();
          });
        } else if (!reloadIfStuckOnLogin(token)) {
          fillLoginForm();
        }
        setTimeout(function () {
          if (!reloadIfStuckOnLogin(token)) fillLoginForm();
        }, 1200);
      }
    }
  } catch (e) {
    say('异常（已忽略）：' + e);
  }
})();
