// Tiny self-contained web form served at GET / — for humans who prefer a
// browser over the CLI. Posts to /secret and shows the claim code.
// No external assets: all CSS/JS/SVG is inline so it works on a bare Worker.

export const FORM_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent-secret — share a secret with your AI agent</title>
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
  .wrap{width:100%; max-width:30rem}
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
  details{margin:-.2rem 0 1rem; border-top:1px solid var(--line); padding-top:.9rem}
  summary{cursor:pointer; color:var(--muted); font-size:.85rem; font-weight:600; list-style:none; display:flex; align-items:center; gap:.4rem; user-select:none}
  summary::-webkit-details-marker{display:none}
  summary .chev{transition:transform .15s; color:var(--faint)}
  details[open] summary .chev{transform:rotate(90deg)}
  details .fld{margin-top:.85rem; margin-bottom:.2rem}
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
  .rlabel{font-size:.78rem; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); font-weight:700; margin-bottom:.55rem}
  .coderow{display:flex; align-items:center; gap:.6rem; background:var(--bg2); border:1px solid var(--line2); border-radius:12px; padding:.7rem .7rem .7rem 1rem}
  #code{flex:1; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:1.75rem; font-weight:750; letter-spacing:.06em; color:var(--txt)}
  .copy{flex:0 0 auto; display:inline-flex; align-items:center; gap:.35rem; padding:.5rem .7rem; font-size:.82rem; font-weight:650; cursor:pointer; color:var(--txt); background:var(--card2); border:1px solid var(--line2); border-radius:9px; transition:.15s}
  .copy:hover{border-color:var(--accent); color:var(--accent2)}
  .copy.done{color:var(--good); border-color:#34d39955}
  .meta{color:var(--muted); font-size:.82rem; margin:.75rem 0 1.25rem}
  .meta b{color:var(--txt); font-weight:600}
  .tellbox{background:var(--bg2); border:1px solid var(--line2); border-radius:12px; padding:.9rem 1rem}
  .tellbox .rlabel{margin-bottom:.5rem}
  .tellrow{display:flex; align-items:flex-start; gap:.6rem}
  #tell{flex:1; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.86rem; color:var(--txt); word-break:break-word}
  .again{margin-top:1.15rem; width:100%; padding:.7rem; font:inherit; font-weight:650; cursor:pointer; color:var(--muted); background:transparent; border:1px solid var(--line2); border-radius:11px; transition:.15s}
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
  <p class="tag">Paste the <em>claim code</em> into your agent chat — never the secret itself.</p>

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
      <details>
        <summary><span class="chev">&#9656;</span> Advanced</summary>
        <div class="fld">
          <label for="pass">Passphrase <span class="hintlabel">— optional; you rarely need this</span></label>
          <input id="pass" type="password" placeholder="Extra factor at claim time" autocomplete="new-password">
        </div>
      </details>
      <button class="btn" id="submit" type="submit">Create claim code</button>
      <div class="err" id="err"></div>
    </form>

    <div id="result">
      <div class="rlabel">Claim code</div>
      <div class="coderow">
        <span id="code"></span>
        <button class="copy" id="copyCode" type="button" aria-label="Copy claim code">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>
          <span>Copy</span>
        </button>
      </div>
      <p class="meta">&#128293; Single-use — burns on first claim &nbsp;·&nbsp; &#9201; Expires <b id="exp"></b></p>

      <div class="tellbox">
        <div class="tellrow">
          <div style="flex:1">
            <div class="rlabel">Tell your agent</div>
            <div id="tell"></div>
          </div>
          <button class="copy" id="copyTell" type="button" aria-label="Copy instruction">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>
            <span>Copy</span>
          </button>
        </div>
      </div>

      <button class="again" id="again" type="button">Share another secret</button>
    </div>

    <div class="trust" id="trust">
      <span>&#128274; Encrypted at rest</span>
      <span>&#128293; Single-use</span>
      <span>&#9201; Auto-expires</span>
    </div>
  </div>

  <p class="foot"><a href="https://github.com/mrcsXndr/agent-secret" target="_blank" rel="noopener">github.com/mrcsXndr/agent-secret</a></p>
</div>

<script>
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var form = $('f'), result = $('result'), trust = $('trust'), submit = $('submit'), err = $('err');

  function copyBtn(btn, getText){
    btn.addEventListener('click', function(){
      navigator.clipboard.writeText(getText()).then(function(){
        var lbl = btn.querySelector('span'); var prev = lbl.textContent;
        btn.classList.add('done'); lbl.textContent = 'Copied';
        setTimeout(function(){ btn.classList.remove('done'); lbl.textContent = prev; }, 1400);
      });
    });
  }
  copyBtn($('copyCode'), function(){ return $('code').textContent; });
  copyBtn($('copyTell'), function(){ return $('tell').textContent; });

  $('again').addEventListener('click', function(){
    result.style.display = 'none';
    form.style.display = ''; trust.style.display = '';
    $('value').focus();
  });

  form.addEventListener('submit', async function(e){
    e.preventDefault();
    err.textContent = '';
    var name = $('name').value.trim();
    var body = { value: $('value').value, ttl: Number($('ttl').value) };
    if (name) body.name = name;
    var pass = $('pass').value;
    if (pass) body.passphrase = pass;

    submit.disabled = true; submit.textContent = 'Creating…';
    try {
      var res = await fetch('/secret', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
      var data = await res.json();
      if (!res.ok) { err.textContent = data.message || data.error || ('HTTP ' + res.status); return; }
      $('code').textContent = data.code;
      $('exp').textContent = new Date(data.expiresAt).toLocaleString();
      $('tell').textContent = 'Claim secret ' + data.code + ' with agent-secret and save it to .env' + (name ? ' as ' + name : '');
      form.style.display = 'none'; trust.style.display = 'none';
      result.style.display = 'block';
      $('value').value = ''; $('pass').value = '';
    } catch (ex) {
      err.textContent = String(ex);
    } finally {
      submit.disabled = false; submit.textContent = 'Create claim code';
    }
  });
})();
</script>
</body>
</html>`;
