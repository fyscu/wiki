// 统一登录页（自包含 HTML，无外部资源、无构建步骤）
// 对外只暴露三种方式；账号探测结果恒定，「已有账户」不通过响应差异体现。
function esc(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
}

export function renderLoginPage({ state, methods = ['qr', 'email_code', 'password'], wikiOrigin = 'https://wiki.feiyang.ac.cn' }) {
  const has = m => methods.includes(m)
  const tabs = [
    has('qr') ? '<button type="button" data-tab="qr" class="on">云上飞扬扫码</button>' : '',
    has('email_code') ? '<button type="button" data-tab="email">邮箱验证码</button>' : '',
    has('password') ? '<button type="button" data-tab="password">账户密码</button>' : '',
  ].join('')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>云上飞扬统一登录</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f5f7fb;color:#1f2937;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.card{width:min(440px,92vw);background:#fff;border:1px solid #e5e9f0;border-radius:14px;padding:28px;box-shadow:0 8px 30px rgba(31,41,55,.07)}
h1{font-size:19px;margin:0 0 4px} .sub{color:#6b7280;font-size:13px;margin:0 0 20px}
label{display:block;font-size:13px;color:#374151;margin:12px 0 6px}
input{width:100%;padding:10px 12px;border:1px solid #d7dce5;border-radius:8px;font-size:15px;outline:none}
input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.12)}
button{font:inherit;cursor:pointer}
.primary{width:100%;margin-top:16px;padding:11px;background:#2563eb;color:#fff;border:0;border-radius:8px;font-weight:600}
.primary:disabled{background:#9db4e8;cursor:not-allowed}
.tabs{display:flex;gap:6px;border-bottom:1px solid #e5e9f0;margin:18px 0 4px}
.tabs button{flex:1;padding:9px 4px;background:none;border:0;border-bottom:2px solid transparent;color:#6b7280;font-size:13px}
.tabs button.on{color:#2563eb;border-bottom-color:#2563eb;font-weight:600}
.panel{display:none;padding-top:6px}.panel.on{display:block}
.qr{display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px 0}
.qr img{width:190px;height:190px;border:1px solid #eef1f6;border-radius:8px}
.qr code{font-size:11px;color:#6b7280;word-break:break-all;text-align:center;max-width:100%}
.hint{background:#f3f6fd;color:#374151;border-radius:8px;padding:10px 12px;font-size:13px;margin-top:14px}
.msg{min-height:20px;margin-top:10px;font-size:13px;color:#6b7280}.msg.err{color:#b91c1c}.msg.ok{color:#15803d}
.foot{margin-top:18px;font-size:12px;color:#9ca3af;text-align:center}
.hidden{display:none}
</style></head>
<body><main class="card">
<h1>云上飞扬统一登录</h1>
<p class="sub">用于登录飞扬 Wiki 问答社区</p>

<div id="step1">
  <label for="email">邮箱地址</label>
  <input id="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="name@example.com"/>
  <button id="lookup" class="primary" type="button">继续</button>
  <div id="hint" class="hint"></div>
</div>

<div id="step2" class="hidden">
  <p class="sub" style="margin:0" id="who"></p>
  <div class="tabs" id="tabs">${tabs}</div>

  ${has('qr') ? `<section class="panel on" data-panel="qr"><div class="qr" id="qrbox"><p>点击下方按钮生成登录二维码</p></div><button class="primary" id="qrstart" type="button">生成二维码</button></section>` : ''}

  ${has('email_code') ? `<section class="panel" data-panel="email">
    <button class="primary" id="mailsend" type="button">发送验证码</button>
    <label for="mailcode">6 位验证码</label><input id="mailcode" inputmode="numeric" maxlength="6" autocomplete="one-time-code"/>
    <button class="primary" id="mailconfirm" type="button">验证并登录</button>
  </section>` : ''}

  ${has('password') ? `<section class="panel" data-panel="password">
    <label for="pwaccount">Wiki 邮箱或用户名</label><input id="pwaccount" autocomplete="username"/>
    <label for="pwpass">Wiki 密码</label><input id="pwpass" type="password" autocomplete="current-password"/>
    <button class="primary" id="pwsubmit" type="button">使用账户密码登录</button>
  </section>` : ''}

  <div id="msg" class="msg" role="status"></div>
  <div class="foot"><a href="javascript:void(0)" id="back">换个邮箱</a></div>
</div>
</main>
<script>
const STATE=${JSON.stringify(esc(state))}, WIKI=${JSON.stringify(esc(wikiOrigin))};
let ticket='', mailRequest='', pollTimer=null;
const $=id=>document.getElementById(id);
const msg=(text,kind='')=>{const n=$('msg');n.textContent=text;n.className='msg'+(kind?' '+kind:'')};
async function api(path,body){
  const r=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify(body||{})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.error||'请求未完成，请重试');
  return d;
}
$('lookup').onclick=async()=>{
  const btn=$('lookup');btn.disabled=true;msg('');
  try{
    const d=await api('lookup',{email:$('email').value});
    ticket=d.ticket;
    $('hint').textContent=d.hint;
    $('who').textContent='当前邮箱：'+$('email').value.trim();
    $('step1').classList.add('hidden');$('step2').classList.remove('hidden');
    if(${JSON.stringify(has('qr'))}) startQr();
  }catch(e){$('hint').textContent=e.message}finally{btn.disabled=false}
};
$('back').onclick=()=>{stopPoll();$('step2').classList.add('hidden');$('step1').classList.remove('hidden');ticket='';msg('')};
$('tabs').onclick=e=>{
  const b=e.target.closest('button[data-tab]');if(!b)return;
  document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('on',x===b));
  document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('on',p.dataset.panel===b.dataset.tab));
  msg('');
};
function stopPoll(){if(pollTimer){clearInterval(pollTimer);pollTimer=null}}
async function finish(assertion){
  stopPoll();
  const d=await api('finish',{state:STATE,ticket:ticket,assertion:assertion});
  location.assign(d.redirect);
}
${has('qr') ? `
async function startQr(){
  const box=$('qrbox');box.innerHTML='<p>正在生成…</p>';
  try{
    const d=await api('qr/start',{ticket:ticket});
    const payload=d.qr_payload||'';
    box.innerHTML=d.qr_image?'<img alt="登录二维码" src="'+d.qr_image.replace(/"/g,'&quot;')+'"/>':'<code>'+payload.replace(/</g,'&lt;')+'</code>';
    box.insertAdjacentHTML('beforeend','<p>请用「云上飞扬」小程序扫一扫确认登录</p>');
    stopPoll();
    pollTimer=setInterval(async()=>{
      try{
        const r=await api('qr/poll',{ticket:ticket,session_id:d.session_id,poll_token:d.poll_token});
        if(r.status==='verified'){await finish(r.assertion);return}
        if(['expired','cancelled','consumed','session_not_found'].includes(r.status)){stopPoll();msg('二维码已失效，请重新生成','err')}
        else msg(r.status==='pending'?'等待扫码确认…':'正在确认…');
      }catch(e){stopPoll();msg(e.message,'err')}
    },2000);
  }catch(e){box.innerHTML='<p>二维码生成失败</p>';msg(e.message,'err')}
}
$('qrstart').onclick=startQr;
` : ''}
${has('email_code') ? `
$('mailsend').onclick=async()=>{
  const b=$('mailsend');b.disabled=true;
  try{const d=await api('email/send',{ticket:ticket});mailRequest=d.request_id||'';msg('验证码已发送，请查收邮箱','ok')}
  catch(e){msg(e.message,'err')}finally{b.disabled=false}
};
$('mailconfirm').onclick=async()=>{
  const b=$('mailconfirm');b.disabled=true;
  try{
    const d=await api('email/confirm',{ticket:ticket,request_id:mailRequest,code:$('mailcode').value.trim()});
    if(!mailRequest) throw new Error('请先获取验证码');
    msg('验证通过，正在登录…','ok');await finish(d.assertion);
  }catch(e){msg(e.message,'err')}finally{b.disabled=false}
};
` : ''}
${has('password') ? `
$('pwsubmit').onclick=async()=>{
  const b=$('pwsubmit');b.disabled=true;
  try{
    const d=await api('password',{account:$('pwaccount').value.trim(),pass:$('pwpass').value});
    const token=d.user&&d.user.access_token;
    if(!token) throw new Error('登录失败，请检查账户与密码');
    location.assign(WIKI+'/users/auth-landing/?access_token='+encodeURIComponent(token));
  }catch(e){msg(e.message,'err')}finally{b.disabled=false}
};
` : ''}
</script></body></html>`
}
