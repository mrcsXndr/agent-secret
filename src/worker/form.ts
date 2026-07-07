// Self-contained web form served at GET /. All encryption happens HERE, in the
// browser: a random AES-256-GCM key is generated, the secret is encrypted, and
// only the ciphertext is POSTed to /. The key never leaves this page — it is
// baked into the copy block the human hands their agent. The server is
// zero-knowledge by construction. No external assets: all CSS/JS/SVG is inline.

export const FORM_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent-secret — hand a secret to your AI agent, safely</title>
<style>
  :root{
    --bg:#07070b; --bg2:#0e0e16; --card:#12121c; --card2:#171724;
    --line:#ffffff14; --line2:#ffffff22;
    --txt:#f5f5f8; --muted:#9a9aab; --faint:#6a6a78;
    --accent:#7c6cff; --accent2:#a58bff; --accentInk:#fff;
    --good:#34d399; --bad:#fb7185;
    --radius:16px;
  }
  @media (prefers-color-scheme:light){
    :root{ --bg:#f4f4f8; --bg2:#ececf3; --card:#ffffff; --card2:#f7f7fb;
      --line:#0000000f; --line2:#00000018; --txt:#16161d; --muted:#5a5a68; --faint:#8a8a98; }
  }
  *{box-sizing:border-box}
  html,body{margin:0}
  body{
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    color:var(--txt); line-height:1.5; min-height:100vh;
    background:
      radial-gradient(60rem 40rem at 50% -10%, #7c6cff26, transparent 60%),
      radial-gradient(50rem 40rem at 90% 110%, #a58bff1f, transparent 55%),
      linear-gradient(var(--bg),var(--bg2));
    display:flex; align-items:flex-start; justify-content:center;
    padding:clamp(1rem,4vw,3.5rem) 1rem;
  }
  .wrap{width:100%; max-width:32rem}
  .brand{display:flex; align-items:center; gap:.7rem; margin-bottom:.35rem}
  .mark{
    width:2.35rem; height:2.35rem; flex:0 0 auto; border-radius:11px;
    display:grid; place-items:center; color:#fff;
    background:linear-gradient(140deg,var(--accent),var(--accent2));
    box-shadow:0 6px 20px #7c6cff40, inset 0 1px 0 #ffffff40;
  }
  .brand h1{font-size:1.28rem; font-weight:750; letter-spacing:-.01em; margin:0}
  .tag{color:var(--muted); margin:.15rem 0 1.4rem; font-size:.95rem}
  .tag em{color:var(--accent2); font-style:normal; font-weight:600}
  .card{
    background:linear-gradient(var(--card),var(--card2));
    border:1px solid var(--line); border-radius:var(--radius);
    padding:1.35rem 1.35rem 1.5rem; box-shadow:0 24px 60px #00000040;
  }
  label{display:block; font-weight:600; font-size:.82rem; margin:0 0 .4rem; color:var(--txt)}
  .fld{margin-bottom:1rem}
  .hintlabel{color:var(--faint); font-weight:500}
  input,textarea,select{
    width:100%; padding:.7rem .8rem; font:inherit; color:var(--txt);
    background:var(--bg2); border:1px solid var(--line2); border-radius:10px;
    outline:none; transition:border-color .15s, box-shadow .15s;
  }
  input::placeholder,textarea::placeholder{color:var(--faint)}
  input:focus,textarea:focus,select:focus{border-color:var(--accent); box-shadow:0 0 0 3px #7c6cff33}
  textarea{min-height:5rem; resize:vertical; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.9rem}
  select{appearance:none; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239a9aab' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right .8rem center; padding-right:2.4rem; cursor:pointer}
  .btn{
    width:100%; padding:.8rem; font:inherit; font-weight:700; cursor:pointer;
    color:var(--accentInk); border:0; border-radius:11px;
    background:linear-gradient(140deg,var(--accent),var(--accent2));
    box-shadow:0 8px 22px #7c6cff45, inset 0 1px 0 #ffffff45;
    transition:transform .08s, filter .15s, opacity .15s;
  }
  .btn:hover{filter:brightness(1.06)} .btn:active{transform:translateY(1px)}
  .btn[disabled]{opacity:.6; cursor:progress}
  .trust{display:flex; gap:1rem; flex-wrap:wrap; justify-content:center; margin-top:1.05rem; color:var(--muted); font-size:.78rem}
  .trust span{display:inline-flex; align-items:center; gap:.35rem}
  .err{color:var(--bad); font-size:.85rem; margin-top:.9rem; min-height:1px}
  /* result */
  #result{display:none; animation:rise .35s ease both}
  @keyframes rise{from{opacity:0; transform:translateY(10px)}to{opacity:1; transform:none}}
  .rlabel{font-size:.78rem; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); font-weight:700; margin-bottom:.55rem; display:flex; align-items:center; gap:.4rem}
  .rlabel .lbl{display:inline-flex; align-items:center; gap:.4rem; flex:1; min-width:0}
  .rlabel .zk{color:var(--accent2); font-weight:700}
  .blockbox{background:var(--bg2); border:1px solid var(--line2); border-radius:12px}
  .blockbox pre{
    margin:0; padding:1rem; overflow-x:auto;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.8rem;
    line-height:1.6; color:var(--txt); white-space:pre; tab-size:2;
  }
  .copyblock{
    flex:0 0 auto; display:inline-flex; align-items:center; gap:.35rem; text-transform:none; letter-spacing:0;
    padding:.4rem .7rem; font-size:.78rem; font-weight:700; cursor:pointer; color:var(--accentInk);
    background:linear-gradient(140deg,var(--accent),var(--accent2)); border:0; border-radius:9px;
    box-shadow:0 6px 16px #7c6cff40; transition:.15s;
  }
  .copyblock:hover{filter:brightness(1.07)}
  .copyblock.done{background:linear-gradient(140deg,#34d399,#10b981); box-shadow:0 6px 16px #34d39940}
  .meta{color:var(--muted); font-size:.82rem; margin:.9rem 0 1.2rem; text-align:center}
  .meta b{color:var(--txt); font-weight:600}
  .again{width:100%; padding:.7rem; font:inherit; font-weight:650; cursor:pointer; color:var(--muted); background:transparent; border:1px solid var(--line2); border-radius:11px; transition:.15s}
  .again:hover{color:var(--txt); border-color:var(--accent)}
  .foot{text-align:center; color:var(--faint); font-size:.75rem; margin-top:1.3rem}
  .foot a{color:var(--muted); text-decoration:none} .foot a:hover{color:var(--accent2)}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">
    <div class="mark" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l7 4v6c0 4.4-3 7.4-7 8.9C8 19.4 5 16.4 5 12V6l7-4z"/><path d="M9 12l2 2 4-4"/></svg>
    </div>
    <h1>agent-secret</h1>
  </div>
  <p class="tag">Encrypt a secret <em>in your browser</em>, get a one-shot instruction to paste to your AI agent. The server never sees it.</p>

  <div class="card">
    <form id="f">
      <div class="fld">
        <label for="value">Secret value</label>
        <textarea id="value" required placeholder="sk-..." autocomplete="off" spellcheck="false"></textarea>
      </div>
      <div class="fld">
        <label for="name">Name <span class="hintlabel">— optional, e.g. OPENAI_API_KEY</span></label>
        <input id="name" placeholder="OPENAI_API_KEY" autocomplete="off" spellcheck="false">
      </div>
      <div class="fld">
        <label for="ttl">Expires in</label>
        <select id="ttl">
          <option value="300">5 minutes</option>
          <option value="600" selected>10 minutes</option>
          <option value="3600">1 hour</option>
          <option value="86400">24 hours</option>
        </select>
      </div>
      <button class="btn" id="submit" type="submit">Encrypt &amp; create link</button>
      <div class="err" id="err"></div>
    </form>

    <div id="result">
      <div class="rlabel">
        <span class="lbl">Paste this to your agent <span class="zk">· E2E encrypted</span></span>
        <button class="copyblock" id="copyBlock" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>
          <span>Copy</span>
        </button>
      </div>
      <div class="blockbox">
        <pre id="block"></pre>
      </div>
      <p class="meta">&#128293; Single-use — burns on first fetch &nbsp;·&nbsp; &#9201; Expires <b id="exp"></b></p>
      <button class="again" id="again" type="button">Share another secret</button>
    </div>

    <div class="trust" id="trust">
      <span>&#128274; Encrypted in your browser</span>
      <span>&#128064; Server can't read it</span>
      <span>&#128293; Single-use</span>
    </div>
  </div>

  <p class="foot"><a href="https://github.com/mrcsXndr/agent-secret" target="_blank" rel="noopener">github.com/mrcsXndr/agent-secret</a></p>
</div>

<script>
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var form = $('f'), result = $('result'), trust = $('trust'), submit = $('submit'), err = $('err');

  function b64(buf){
    var u = new Uint8Array(buf), s = '';
    for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  }
  function b64url(buf){ return b64(buf).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,''); }

  // The whole handoff is ONE short link: /<code>#<key>. The key rides in the
  // URL fragment — never sent to the server (curl and fetch drop it) — so the
  // link IS the secret until claimed. Terse on purpose: agents are smart.
  function buildBlock(origin, code, key, name){
    var url = origin + '/' + code + '#' + key;
    var head = name ? name + ' — ' : '';
    return head + 'one-time secret (agent-secret). Single GET burns it; then AES-256-GCM decrypt: '
      + 'response {ct,iv} base64, key = URL #fragment (base64url), ct = ciphertext+16-byte tag, plaintext = the value.\\n'
      + url;
  }

  function copyBtn(btn, getText){
    btn.addEventListener('click', function(){
      navigator.clipboard.writeText(getText()).then(function(){
        var lbl = btn.querySelector('span'); var prev = lbl.textContent;
        btn.classList.add('done'); lbl.textContent = 'Copied';
        setTimeout(function(){ btn.classList.remove('done'); lbl.textContent = prev; }, 1500);
      });
    });
  }
  copyBtn($('copyBlock'), function(){ return $('block').textContent; });

  $('again').addEventListener('click', function(){
    result.style.display = 'none';
    form.style.display = ''; trust.style.display = '';
    $('name').value = '';
    $('value').focus();
  });

  form.addEventListener('submit', async function(e){
    e.preventDefault();
    err.textContent = '';
    var name = $('name').value.trim();
    var value = $('value').value;
    if (!value) { err.textContent = 'Enter a secret value.'; return; }

    submit.disabled = true; submit.textContent = 'Encrypting…';
    try {
      // Encrypt client-side. The key is generated here and never sent anywhere.
      var rawKey = crypto.getRandomValues(new Uint8Array(32));
      var key = await crypto.subtle.importKey('raw', rawKey, { name:'AES-GCM' }, false, ['encrypt']);
      var iv = crypto.getRandomValues(new Uint8Array(12));
      var plaintext = new TextEncoder().encode(value); // raw value; the name stays plaintext in the block
      var ctBuf = await crypto.subtle.encrypt({ name:'AES-GCM', iv:iv }, key, plaintext);

      var res = await fetch('/', {
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ ct: b64(ctBuf), iv: b64(iv), ttl: Number($('ttl').value) })
      });
      var data = await res.json();
      if (!res.ok) { err.textContent = data.message || data.error || ('HTTP ' + res.status); return; }

      $('exp').textContent = new Date(data.expiresAt).toLocaleString();
      $('block').textContent = buildBlock(location.origin, data.code, b64url(rawKey), name);
      form.style.display = 'none'; trust.style.display = 'none';
      result.style.display = 'block';
      $('value').value = '';
    } catch (ex) {
      err.textContent = String(ex);
    } finally {
      submit.disabled = false; submit.textContent = 'Encrypt & create link';
    }
  });
})();
</script>
</body>
</html>`;
