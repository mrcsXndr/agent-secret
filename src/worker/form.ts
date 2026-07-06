// Tiny self-contained web form served at GET / — for humans who prefer a
// browser over the CLI. Posts to /secret and shows the claim code.

export const FORM_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent-secret — share a secret with your AI agent</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.3rem; } p.sub { opacity: .75; margin-top: -.5rem; }
  label { display: block; margin: 1rem 0 .25rem; font-weight: 600; font-size: .9rem; }
  input, textarea, select, button { width: 100%; box-sizing: border-box; padding: .55rem; font: inherit; border: 1px solid #8884; border-radius: 6px; background: transparent; color: inherit; }
  textarea { min-height: 5rem; font-family: ui-monospace, monospace; }
  button { margin-top: 1.25rem; cursor: pointer; font-weight: 700; background: #2563eb; color: #fff; border: 0; }
  #result { display: none; margin-top: 1.5rem; padding: 1rem; border: 1px solid #8884; border-radius: 8px; }
  #code { font-family: ui-monospace, monospace; font-size: 1.6rem; font-weight: 700; letter-spacing: .08em; }
  .hint { font-size: .85rem; opacity: .75; }
  .err { color: #dc2626; margin-top: 1rem; }
</style>
</head>
<body>
<h1>agent-secret</h1>
<p class="sub">Paste the <em>claim code</em> into your agent chat — never the secret itself.</p>
<form id="f">
  <label for="value">Secret value</label>
  <textarea id="value" required placeholder="sk-..." autocomplete="off" spellcheck="false"></textarea>
  <label for="name">Name (optional — e.g. OPENAI_API_KEY)</label>
  <input id="name" autocomplete="off" spellcheck="false">
  <label for="ttl">Expires in</label>
  <select id="ttl">
    <option value="300">5 minutes</option>
    <option value="600" selected>10 minutes</option>
    <option value="3600">1 hour</option>
    <option value="86400">24 hours</option>
  </select>
  <label for="pass">Passphrase (optional second factor)</label>
  <input id="pass" autocomplete="off">
  <button type="submit">Create claim code</button>
  <div class="err" id="err"></div>
</form>
<div id="result">
  <div>Claim code: <span id="code"></span></div>
  <p class="hint">Single-use; burns on first claim. Expires <span id="exp"></span>.</p>
  <p class="hint">Tell your agent: <code id="tell"></code></p>
</div>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('err'); err.textContent = '';
  const name = document.getElementById('name').value.trim();
  const body = {
    value: document.getElementById('value').value,
    ttl: Number(document.getElementById('ttl').value),
  };
  if (name) body.name = name;
  const pass = document.getElementById('pass').value;
  if (pass) body.passphrase = pass;
  try {
    const res = await fetch('/secret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.message || data.error || ('HTTP ' + res.status); return; }
    document.getElementById('code').textContent = data.code;
    document.getElementById('exp').textContent = new Date(data.expiresAt).toLocaleString();
    document.getElementById('tell').textContent = 'Claim secret ' + data.code + ' with agent-secret and save it to .env' + (name ? ' as ' + name : '');
    document.getElementById('result').style.display = 'block';
    document.getElementById('value').value = '';
    document.getElementById('pass').value = '';
  } catch (ex) { err.textContent = String(ex); }
});
</script>
</body>
</html>`;
