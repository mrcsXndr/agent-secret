// The page served at GET /. All encryption happens HERE, in the browser: a
// random AES-256-GCM key is generated, the secret is encrypted, and only the
// ciphertext is POSTed to /. The key never leaves the page; it rides in the
// link's #fragment. No external assets. The CSP allows exactly FORM_JS and
// FORM_CSS by hash (see app.ts), so they must stay free of {{placeholders}}.
import { SNIPPET_PY, SNIPPET_SH, escapeHtml } from "./agent-docs.js";

export const FORM_JS = `
(function(){
  'use strict';
  var $ = function(id){ return document.getElementById(id); };

  function b64(buf){
    var u = new Uint8Array(buf), s = '';
    for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  }
  function b64url(buf){ return b64(buf).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,''); }

  // Encryption. Everything in this function runs in your tab; the key it makes is never sent.
  async function encrypt(value){
    var rawKey = crypto.getRandomValues(new Uint8Array(32));                 // fresh 256-bit key
    var key = await crypto.subtle.importKey('raw', rawKey, { name:'AES-GCM' }, false, ['encrypt']);
    var iv = crypto.getRandomValues(new Uint8Array(12));                     // 96-bit nonce
    var ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv:iv }, key, new TextEncoder().encode(value));
    return { ct: b64(ct), iv: b64(iv), key: b64url(rawKey) };                 // ct ends with the 16-byte tag
  }

  // Only ciphertext, nonce and expiry are sent. No key, no name.
  function store(enc, ttl){
    return fetch('/', { method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify({ ct: enc.ct, iv: enc.iv, ttl: ttl }) });
  }

  // The copy block: one short line, then the link on its own last line. The how-to lives at /how.
  function specLine(name, origin){
    return (name ? name + ': one-time' : 'One-time') + ' secret. Read ' + origin + '/how, then claim the link below; it works once.';
  }

  function span(cls, text){ var s = document.createElement('span'); s.className = cls; s.textContent = text; return s; }

  function copyFrom(btn, el){
    btn.addEventListener('click', function(){
      var lbl = btn.querySelector('span') || btn, prev = lbl.textContent;
      function flash(msg){ lbl.textContent = msg; btn.classList.add('done'); setTimeout(function(){ lbl.textContent = prev; btn.classList.remove('done'); }, 1600); }
      navigator.clipboard.writeText(el.textContent).then(function(){ flash('Copied'); }, function(){
        var r = document.createRange(); r.selectNodeContents(el);
        var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
        flash('Selected, press Ctrl+C');
      });
    });
  }

  var form = $('f'), result = $('result'), submit = $('submit'), err = $('err'), block = $('block');
  copyFrom($('copyBlock'), block);
  copyFrom($('copySh'), $('snSh'));
  copyFrom($('copyPy'), $('snPy'));

  form.addEventListener('submit', async function(e){
    e.preventDefault();
    err.textContent = '';
    var value = $('value').value, name = $('name').value.trim();
    var ttlInput = form.querySelector('input[name=ttl]:checked');
    if (!value) { err.textContent = 'Enter a secret.'; return; }

    submit.disabled = true; submit.textContent = 'Encrypting';
    try {
      var enc = await encrypt(value);
      var res = await store(enc, Number(ttlInput.value));
      var data = await res.json();
      if (!res.ok) { err.textContent = data.message || data.error || ('HTTP ' + res.status); return; }

      var link = location.origin + '/' + data.code;
      block.textContent = specLine(name, location.origin) + '\\n';
      block.appendChild(span('srv', link));
      block.appendChild(span('key', '#' + enc.key));
      $('exp').textContent = new Date(data.expiresAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })
        + ' (' + ttlInput.nextElementSibling.textContent + ')';
      $('value').value = '';
      form.hidden = true; result.hidden = false;
      $('copyBlock').focus();
    } catch (ex) {
      err.textContent = 'Could not create the link: ' + (ex && ex.message ? ex.message : String(ex));
    } finally {
      submit.disabled = false; submit.textContent = 'Encrypt and make link';
    }
  });

  $('again').addEventListener('click', function(){
    block.textContent = '';          // drop the key from the page
    result.hidden = true; form.hidden = false;
    $('name').value = '';
    $('value').focus();
  });

  // The sample key in "How it works" is a real one, made in this tab, re-rolled every few seconds.
  var sample = $('sampleKey');
  function roll(){ sample.textContent = '#' + b64url(crypto.getRandomValues(new Uint8Array(32))); }
  roll();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setInterval(roll, 3200);
})();
`;

const GRAIN_LIGHT =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .1 0 0 0 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

// Sealed-envelope palette: blue-black ink on rose onionskin, the key half in
// sealing-wax oxblood. Light only. The display face is a condensed industrial
// grotesque (DIN on Apple, Bahnschrift on Windows), like a stamped vault tag.
export const FORM_CSS = `
:root{
  color-scheme:light;
  --bg:#f4e8e3; --surface:#fcf7f5; --field:#fffdfc; --stub:#f1d3c9;
  --ink:#1b1e2e; --muted:#525061; --faint:#625e6d; --key:#8a2c1f;
  --edge:#1b1e2e29; --edge2:#1b1e2e14; --grain:${GRAIN_LIGHT};
  --display:"DIN Condensed","Bahnschrift","Roboto Condensed","Arial Narrow",sans-serif-condensed,system-ui,sans-serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --mono:ui-monospace,"SF Mono","Cascadia Mono",Menlo,Consolas,monospace;
  --n:11px;
}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%; scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){ html{scroll-behavior:auto} }
body{margin:0; color:var(--ink); background:var(--grain), var(--bg); font:16px/1.6 var(--sans)}
::selection{background:var(--stub); color:var(--ink)}
a{color:var(--ink); text-decoration:underline; text-decoration-color:var(--edge); text-underline-offset:3px}
a:hover{text-decoration-color:currentColor}
code{font-family:var(--mono); font-size:.88em; overflow-wrap:anywhere}
:focus-visible{outline:2px solid var(--key); outline-offset:2px}

.col{max-width:46rem; margin:0 auto; padding:0 16px}
@media (min-width:600px){ .col{padding:0 28px} }

.top{display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:20px 0 0}
.mark{display:inline-flex; align-items:center; gap:.55rem; font:700 1.35rem/1 var(--display); font-stretch:semi-condensed; color:var(--ink); text-decoration:none; letter-spacing:.01em}
.mark svg{flex:none; color:var(--key)}
.top nav{display:flex; gap:1.1rem; font-size:.92rem}
.top nav a{color:var(--muted); text-decoration:none}
.top nav a:hover{color:var(--ink)}
@media (max-width:479px){ .top nav .gh{display:none} }

h1{font:700 clamp(2.6rem,10vw,4.4rem)/.98 var(--display); font-stretch:semi-condensed; letter-spacing:.005em; margin:2.6rem 0 1.1rem; max-width:16ch; text-wrap:balance}
.lede{color:var(--muted); font-size:1.06rem; margin:0 0 1.8rem; max-width:34rem}
h2{font:700 clamp(1.9rem,6vw,2.6rem)/1.05 var(--display); font-stretch:semi-condensed; letter-spacing:.005em; margin:0 0 .8rem}
h3{font:650 1.02rem/1.3 var(--sans); margin:2.4rem 0 .7rem}
section{padding-top:4.5rem}
.tool{padding-top:0}
p{margin:0 0 1rem}

/* The form is a claim slip: punched top corners and a perforation, the same cut as the key stub below. */
.panel{--n:14px; position:relative; background:var(--surface); border-radius:0 0 14px 14px; padding:28px 20px 20px;
  -webkit-mask:radial-gradient(circle at 0 0,#0000 var(--n),#000 calc(var(--n) + .5px)) 0 0/51% 100% no-repeat, radial-gradient(circle at 100% 0,#0000 var(--n),#000 calc(var(--n) + .5px)) 100% 0/51% 100% no-repeat;
  mask:radial-gradient(circle at 0 0,#0000 var(--n),#000 calc(var(--n) + .5px)) 0 0/51% 100% no-repeat, radial-gradient(circle at 100% 0,#0000 var(--n),#000 calc(var(--n) + .5px)) 100% 0/51% 100% no-repeat}
.panel::before{content:""; position:absolute; left:calc(var(--n) + 8px); right:calc(var(--n) + 8px); top:0; height:4px; background:radial-gradient(circle,var(--faint) 1.3px,#0000 1.8px) 0 50%/10px 4px repeat-x}
@media (min-width:600px){ .panel{padding:32px 28px 26px} }
label,legend{display:block; font-weight:600; font-size:.9rem; margin:0 0 .45rem; padding:0}
.opt{font-weight:400; color:var(--faint); margin-left:.3rem}
.fld{margin:0 0 1.15rem}
fieldset{border:0; margin:0 0 1.15rem; padding:0; min-width:0}
textarea,input[type=text]{display:block; width:100%; font:inherit; color:var(--ink); background:var(--field); border:1px solid var(--edge); border-radius:8px; padding:.7rem .8rem}
textarea{font:.95rem/1.5 var(--mono); min-height:5.6rem; resize:vertical}
input[type=text]{font:.95rem/1.5 var(--mono)}
textarea::placeholder,input::placeholder{color:var(--faint)}
textarea:focus,input[type=text]:focus{outline:2px solid var(--key); outline-offset:-1px; border-color:transparent}
.seg{display:grid; grid-template-columns:repeat(4,1fr); gap:4px; padding:4px; background:var(--field); border:1px solid var(--edge); border-radius:10px}
.seg label{position:relative; margin:0; font-weight:500}
.seg input{position:absolute; inset:0; width:100%; height:100%; margin:0; opacity:0; cursor:pointer}
.seg span{display:block; text-align:center; padding:.5rem .2rem; border-radius:7px; color:var(--muted); font-size:.92rem; white-space:nowrap}
.seg label:hover span{color:var(--ink)}
.seg input:checked+span{background:var(--ink); color:var(--bg)}
.seg input:focus-visible+span{outline:2px solid var(--key); outline-offset:1px}
.go{display:block; width:100%; padding:.9rem 1rem; font:600 1rem/1.2 var(--sans); color:var(--bg); background:var(--ink); border:0; border-radius:9px; cursor:pointer; transition:background-color .15s}
.go:hover{background:var(--key)}
.go[disabled]{cursor:progress; background:var(--muted)}
.err{color:#a3241a; font-size:.9rem; margin:.7rem 0 0; min-height:0}
.err:empty{display:none}
.note{color:var(--muted); font-size:.88rem; margin:.9rem 0 0; text-align:center; text-wrap:balance}

.res-head{display:flex; align-items:center; justify-content:space-between; gap:1rem; margin:0 0 .8rem}
.res-head h2{font-size:1.45rem; margin:0}
.copy{display:inline-flex; align-items:center; flex:none; font:600 .9rem/1 var(--sans); padding:.6rem .95rem; border:0; border-radius:8px; background:var(--ink); color:var(--bg); cursor:pointer; transition:background-color .15s}
.copy:hover,.copy.done{background:var(--key)}
.copy.quiet{background:transparent; color:var(--ink); box-shadow:inset 0 0 0 1px var(--edge); padding:.45rem .75rem; font-size:.84rem}
.copy.quiet:hover,.copy.quiet.done{background:var(--stub)}
.block{margin:0; padding:14px 16px; background:var(--field); border-radius:10px; box-shadow:inset 0 0 0 1px var(--edge2); font:.84rem/1.6 var(--mono); color:var(--muted); white-space:pre-wrap; overflow-wrap:anywhere}
.block .srv,.block .key{word-break:break-all}
.block .srv{color:var(--ink); font-weight:600}
.block .key{color:var(--key); font-weight:600; background:var(--stub); border-radius:4px; padding:1px 3px; -webkit-box-decoration-break:clone; box-decoration-break:clone}
.facts{color:var(--muted); font-size:.92rem; margin:1rem 0 1.1rem}
.facts b{color:var(--ink); font-weight:600}
.again{font:inherit; font-size:.92rem; color:var(--ink); background:none; border:0; padding:0; cursor:pointer; text-decoration:underline; text-decoration-color:var(--edge); text-underline-offset:3px}
.again:hover{text-decoration-color:currentColor}

.ticket{display:grid; margin:1.6rem 0 0}
.half{position:relative; padding:20px 20px 22px}
.srv-half{background:var(--surface); border-radius:14px 14px 0 0;
  -webkit-mask:radial-gradient(circle at 0 100%,#0000 var(--n),#000 calc(var(--n) + .5px)) 0 0/51% 100% no-repeat, radial-gradient(circle at 100% 100%,#0000 var(--n),#000 calc(var(--n) + .5px)) 100% 0/51% 100% no-repeat;
  mask:radial-gradient(circle at 0 100%,#0000 var(--n),#000 calc(var(--n) + .5px)) 0 0/51% 100% no-repeat, radial-gradient(circle at 100% 100%,#0000 var(--n),#000 calc(var(--n) + .5px)) 100% 0/51% 100% no-repeat}
.key-half{background:var(--stub); border-radius:0 0 14px 14px;
  -webkit-mask:radial-gradient(circle at 0 0,#0000 var(--n),#000 calc(var(--n) + .5px)) 0 0/51% 100% no-repeat, radial-gradient(circle at 100% 0,#0000 var(--n),#000 calc(var(--n) + .5px)) 100% 0/51% 100% no-repeat;
  mask:radial-gradient(circle at 0 0,#0000 var(--n),#000 calc(var(--n) + .5px)) 0 0/51% 100% no-repeat, radial-gradient(circle at 100% 0,#0000 var(--n),#000 calc(var(--n) + .5px)) 100% 0/51% 100% no-repeat}
.key-half::before{content:""; position:absolute; left:calc(var(--n) + 8px); right:calc(var(--n) + 8px); top:0; height:4px; background:radial-gradient(circle,var(--faint) 1.3px,#0000 1.8px) 0 50%/10px 4px repeat-x}
@media (min-width:720px){
  .ticket{grid-template-columns:1.1fr 1fr}
  .srv-half{border-radius:14px 0 0 14px;
    -webkit-mask:radial-gradient(circle at 100% 0,#0000 var(--n),#000 calc(var(--n) + .5px)) 0 0/100% 51% no-repeat, radial-gradient(circle at 100% 100%,#0000 var(--n),#000 calc(var(--n) + .5px)) 0 100%/100% 51% no-repeat;
    mask:radial-gradient(circle at 100% 0,#0000 var(--n),#000 calc(var(--n) + .5px)) 0 0/100% 51% no-repeat, radial-gradient(circle at 100% 100%,#0000 var(--n),#000 calc(var(--n) + .5px)) 0 100%/100% 51% no-repeat}
  .key-half{border-radius:0 14px 14px 0;
    -webkit-mask:radial-gradient(circle at 0 0,#0000 var(--n),#000 calc(var(--n) + .5px)) 0 0/100% 51% no-repeat, radial-gradient(circle at 0 100%,#0000 var(--n),#000 calc(var(--n) + .5px)) 0 100%/100% 51% no-repeat;
    mask:radial-gradient(circle at 0 0,#0000 var(--n),#000 calc(var(--n) + .5px)) 0 0/100% 51% no-repeat, radial-gradient(circle at 0 100%,#0000 var(--n),#000 calc(var(--n) + .5px)) 0 100%/100% 51% no-repeat}
  .key-half::before{left:0; right:auto; top:calc(var(--n) + 8px); bottom:calc(var(--n) + 8px); width:4px; height:auto; background:radial-gradient(circle,var(--faint) 1.3px,#0000 1.8px) 50% 0/4px 10px repeat-y}
  .half{padding:24px 26px 26px}
}
.t-lbl{font-size:.85rem; font-weight:600; color:var(--muted); margin:0 0 .55rem}
.t-val{font:600 1rem/1.45 var(--mono); color:var(--ink); margin:0 0 .7rem; overflow-wrap:anywhere}
@media (min-width:720px){ .t-val{min-height:2.9em} }
.key-half .t-val{color:var(--key)}
.t-cap{font-size:.92rem; color:var(--muted); margin:0}

ol.trip{list-style:none; counter-reset:s; padding:0; margin:0}
ol.trip li{counter-increment:s; display:grid; grid-template-columns:1.9rem 1fr; gap:.3rem; margin:0 0 .85rem}
ol.trip li::before{content:counter(s); font:700 1.45rem/1.15 var(--display); font-stretch:semi-condensed; font-variant-numeric:lining-nums; color:var(--key)}

table{width:100%; border-collapse:collapse; font-size:.92rem}
caption{caption-side:bottom; text-align:left; color:var(--muted); font-size:.88rem; padding-top:.8rem}
th,td{padding:.6rem .35rem; text-align:left; vertical-align:top}
tr>:first-child{padding-left:0}
thead th{font-size:.82rem; font-weight:600; color:var(--muted); vertical-align:bottom; line-height:1.3}
tbody th{font-weight:500}
tbody tr{border-top:1px solid var(--edge2)}
td.y{font-weight:650}
td.n{color:var(--faint)}
@media (max-width:479px){ table{font-size:.86rem} th,td{padding:.55rem .2rem} tr>:first-child{padding-left:0} }

ul.plain{list-style:none; padding:0; margin:0}
ul.plain li{margin:0 0 1rem}
ul.plain b{font-weight:650}

.codes{display:grid; grid-template-columns:auto 1fr; gap:.55rem 1rem; margin:0}
.codes dt{font:600 .92rem/1.6 var(--mono)}
.codes dd{margin:0; color:var(--muted)}
.code-head{display:flex; align-items:center; justify-content:space-between; gap:1rem; margin:2.2rem 0 .6rem}
.code-head h3{margin:0}
pre.code{margin:0; padding:14px 16px; background:var(--field); border-radius:10px; box-shadow:inset 0 0 0 1px var(--edge2); font:.8rem/1.55 var(--mono); color:var(--ink); overflow-x:auto; tab-size:2}
.small{color:var(--muted); font-size:.9rem; margin-top:.9rem}

.foot{margin:5rem 0 0; padding:0 0 2.5rem; color:var(--muted); font-size:.88rem; text-align:center}
.foot p{margin:0 0 .35rem}
.foot .by{margin-top:1.6rem}
.foot .by a{display:inline-flex; align-items:center; gap:.45rem; color:var(--muted); text-decoration:none}
.foot .by .xndr{display:block; width:auto; height:.78em; color:var(--ink)}
.foot .by a:hover,.foot .by a:hover .xndr{color:var(--key)}
.prose p{max-width:40rem}
`;

const MARK_SVG = `<svg width="24" height="16" viewBox="0 0 24 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 1.5H13A2 2 0 0 0 17 1.5H21A1.5 1.5 0 0 1 22.5 3V13A1.5 1.5 0 0 1 21 14.5H17A2 2 0 0 0 13 14.5H3A1.5 1.5 0 0 1 1.5 13V3A1.5 1.5 0 0 1 3 1.5Z"/><path d="M15 5V11" stroke-dasharray="0 2.6"/></svg>`;
const SRC = "https://github.com/mrcsXndr/agent-secret/blob/main/src/worker";
const OG_ALT = "agent-secret: the link's key half never reaches the server";
// XNDR's own pixel wordmark (xndr.io public/assets/logos), cropped to the letters, in currentColor.
const XNDR_SVG = `<svg class="xndr" width="62" height="14" viewBox="52 44 248 56" fill="currentColor" role="img" aria-label="XNDR"><path d="M52 100V84H60V76H68V68H60V60H52V44H68V60H76V68H84V60H92V44H108V60H100V68H92V76H100V84H108V100H92V84H84V76H76V84H68V100H52Z"/><path d="M116 100V44H132V52H140V60H148V68H156V44H172V100H156V84H148V76H140V68H132V100H116Z"/><path d="M180 100V44H220V52H228V60H236V84H228V92H220V100H180ZM196 92H212V84H220V60H212V52H196V92Z"/><path d="M244 100V44H292V52H300V76H284V84H292V92H300V100H276V92H268V84H260V100H244ZM260 76H276V68H284V52H260V76Z"/></svg>`;

// The FAQ is rendered on the page AND as FAQPage JSON-LD from this one list, so
// the structured data always matches the visible text (a test checks it).
export const FAQ: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: "Can agent-secret read my secret?",
    a: "No. Your browser encrypts the value before anything is sent, and the key stays in the part of the link after the #, which browsers and HTTP clients never transmit. The server stores ciphertext and a nonce. A full copy of its database would not decrypt anything.",
  },
  {
    q: "What if someone opens the link before my agent does?",
    a: "They get the secret, and your agent gets a 410 when it tries. Treat that as a leak: rotate the key and send a new link. Pick the shortest expiry that works, so the window stays small.",
  },
  {
    q: "Will a link preview in Slack or Telegram burn the link?",
    a: "No. Known preview bots, including Slack, Telegram, Discord, WhatsApp and LinkedIn, get a short note instead of the ciphertext and leave the secret in place. A crawler that is not on that list would burn it, though it still could not decrypt it.",
  },
  {
    q: "Which agents can use it?",
    a: "Any agent that can make an HTTP request and run AES-256-GCM. In practice that is anything with a shell and curl plus Node or Python, which covers Claude Code, Codex, Cursor and most self-hosted agents. The protocol is plain text at /how.",
  },
  {
    q: "How long does a link last?",
    a: "Between 5 minutes and 24 hours, chosen when you create it, and only until the first claim. After a claim the server keeps a small tombstone until the original expiry, so a second attempt gets a clear 410 rather than a confusing 404.",
  },
  {
    q: "Is it free, and can I run my own?",
    a: "It is free, needs no account and is MIT licensed. Your own copy is one Cloudflare Worker and one KV namespace, with no server secrets to configure. The README has the three commands.",
  },
];
const FAQ_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
}).replace(/</g, "\\u003c");

// Structured data for search engines. A data block, not a script: browsers never
// execute it, so the hash-pinned script-src does not apply. {{origin}} is filled
// (HTML-escaped) per request, which keeps a hostile Host from closing the tag.
const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": ["SoftwareApplication", "SoftwareSourceCode"],
  name: "agent-secret",
  description:
    "Zero-knowledge one-time secret links for AI agents. Encrypt in the browser, hand the agent one self-destructing link; the server only stores ciphertext.",
  url: "{{origin}}/",
  image: "{{origin}}/og.png",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Any (web browser)",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  license: "https://opensource.org/licenses/MIT",
  codeRepository: "https://github.com/mrcsXndr/agent-secret",
  programmingLanguage: "TypeScript",
  author: { "@type": "Organization", name: "XNDR SLU", url: "https://xndr.io" },
});

// {{origin}}, {{host}} and {{scripthash}} are filled per request in app.ts.
export const FORM_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent-secret · one-time encrypted secret links for AI agents</title>
<meta name="description" content="Encrypt a secret in your browser and hand your AI agent one self-destructing link. The server only stores ciphertext it cannot open. Open source.">
<link rel="canonical" href="{{origin}}/">
<meta name="theme-color" content="#f4e8e3">
<meta property="og:type" content="website">
<meta property="og:site_name" content="agent-secret">
<meta property="og:url" content="{{origin}}/">
<meta property="og:title" content="agent-secret: keep secrets out of your agent's chat">
<meta property="og:description" content="Encrypt in your browser, hand your AI agent one link it can claim once. The server only ever holds ciphertext. Open source.">
<meta property="og:image" content="{{origin}}/og.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${OG_ALT}">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="agent-secret: keep secrets out of your agent's chat">
<meta name="twitter:description" content="Encrypt in your browser, hand your AI agent one link it can claim once. The server only ever holds ciphertext. Open source.">
<meta name="twitter:image" content="{{origin}}/og.png">
<meta name="twitter:image:alt" content="${OG_ALT}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script type="application/ld+json">${JSON_LD}</script>
<script type="application/ld+json">${FAQ_LD}</script>
<style>${FORM_CSS}</style>
</head>
<body>
<div class="col">
<header class="top">
  <a class="mark" href="/">${MARK_SVG}agent-secret</a>
  <nav aria-label="Sections"><a href="#how">How it works</a><a href="#agents">For agents</a><a class="gh" href="https://github.com/mrcsXndr/agent-secret">Source</a></nav>
</header>

<main>
<section class="tool" aria-labelledby="title">
  <h1 id="title">Keep secrets out of your agent's chat.</h1>
  <p class="lede">Encrypt an API key in this tab and hand your agent one link. It lands in the agent's <code>.env</code>, not in the transcript, and the server only ever holds ciphertext it cannot open.</p>

  <div class="panel">
    <form id="f" autocomplete="off">
      <div class="fld">
        <label for="value">Secret</label>
        <textarea id="value" required placeholder="sk-..." spellcheck="false" autocapitalize="off"></textarea>
      </div>
      <div class="fld">
        <label for="name">Variable name<span class="opt">optional</span></label>
        <input id="name" type="text" placeholder="OPENAI_API_KEY" spellcheck="false" autocapitalize="off" pattern="[A-Za-z_][A-Za-z0-9_]*" title="Letters, digits and underscores; not starting with a digit">
      </div>
      <fieldset>
        <legend>Claimable for</legend>
        <div class="seg">
          <label><input type="radio" name="ttl" value="300"><span>5 min</span></label>
          <label><input type="radio" name="ttl" value="600" checked><span>10 min</span></label>
          <label><input type="radio" name="ttl" value="3600"><span>1 hour</span></label>
          <label><input type="radio" name="ttl" value="86400"><span>24 hours</span></label>
        </div>
      </fieldset>
      <button class="go" id="submit" type="submit">Encrypt and make link</button>
      <p class="err" id="err" role="alert"></p>
      <p class="note">Encrypted here before anything is sent. <a href="#how">See exactly how</a></p>
    </form>

    <div id="result" hidden>
      <div class="res-head">
        <h2>Paste this to your agent</h2>
        <button class="copy" id="copyBlock" type="button"><span>Copy</span></button>
      </div>
      <pre class="block" id="block"></pre>
      <p class="facts">Claimable once, until <b id="exp"></b>. Whoever opens the link first gets the secret, so send it only to your agent.</p>
      <button class="again" id="again" type="button">Share another secret</button>
    </div>
  </div>
</section>

<section id="why" class="prose" aria-labelledby="why-t">
  <h2 id="why-t">What happens to a key you paste into an agent chat</h2>
  <p>You paste <code>sk-live-…</code> into the chat, the agent writes it to <code>.env</code>, and the job looks done. The key, though, is now in a lot more places than <code>.env</code>.</p>

  <h3>Where it ends up</h3>
  <p>Most coding agents keep a transcript on disk. Claude Code, for example, writes every session to a JSONL file under <code>~/.claude/projects</code>, and those files sit there for weeks unless someone cleans them up. The key is in that file verbatim: once in the message you sent, and often again in the tool call that wrote it to disk.</p>
  <p>It also went to the model provider as part of the prompt, and it rides along in the context for every turn that follows. Providers keep request logs for a retention period that depends on the provider and your plan. When a long session is compacted, the summary can carry the key into the next one. And if the agent confirms its work with a cheerful "Set OPENAI_API_KEY=sk-live-…", that is one more copy.</p>
  <p>Then there is everything around the chat: terminal scrollback, a screen share, a synced folder where someone saved the transcript, a bug report with the log attached. None of these is a breach on its own. Together they mean a key you meant to put in one file now lives in six, and you can't list them all.</p>

  <h3>What a one-time link changes</h3>
  <p>agent-secret moves the value out of the conversation. You paste the secret into this page, your browser encrypts it with a fresh 256-bit AES key, and the server stores only the ciphertext. What you hand the agent is a link whose last part, after the <code>#</code>, is that key. Browsers, curl and fetch never send the fragment, so the server could not decrypt what it holds even if it wanted to.</p>
  <p>The transcript still gets the link. The difference is what the link is worth afterwards. The first GET returns the ciphertext and replaces the record with a tombstone, so by the time anyone reads that transcript the link answers <code>410</code> and there is nothing behind it. A link nobody claims expires on its own, after anything from five minutes to a day.</p>

  <h3>How your agent claims it</h3>
  <p>The copy block is two lines: a short instruction and the link. The instruction points the agent at <a href="/how">/how</a>, a static plain-text page with the protocol. It never touches a stored secret, so the agent can read it as often as it likes. The agent then splits the link at <code>#</code>, makes one GET for the ciphertext, decrypts locally and writes the value to its environment or a gitignored <code>.env</code>. It should report back by name only: "saved OPENAI_API_KEY". The exact steps, response codes and copyable scripts are under <a href="#agents">For AI agents</a>.</p>

  <h3>The threat model, in plain words</h3>
  <p>Until it is claimed, the link is the secret. Anyone who sees it first can claim it, and your agent then gets a <code>410</code>. That failure is loud on purpose: when the claim fails, rotate the key.</p>
  <p>The server can't read your secret, but it does see when a link was created and claimed, from which IP, and roughly how long the secret is. You also trust that the page you loaded is the page in the repository. Its one script is pinned by hash in the Content-Security-Policy so you can check it, or you can run your own copy. And the agent sees the plaintext, because it has to in order to use the key. This keeps the secret out of the transcript, not out of the agent's machine.</p>
</section>

<section id="how" aria-labelledby="how-t">
  <h2 id="how-t">How it works</h2>
  <p>Every link has two halves. Only the first one ever reaches the server.</p>
  <div class="ticket">
    <div class="half srv-half">
      <p class="t-lbl">Sent to the server</p>
      <p class="t-val">{{host}}/k7f2-9m3q</p>
      <p class="t-cap">A random code. It finds the ciphertext, and the first read burns it.</p>
    </div>
    <div class="half key-half">
      <p class="t-lbl">Never sent</p>
      <p class="t-val" id="sampleKey">#Q2xvc2VkIGJ5IGRlZmF1bHQuIE9wZW4gYnkgY2hvaWNl</p>
      <p class="t-cap">The 256-bit key. Browsers, curl and fetch drop everything after <code>#</code> before the request. This one was just made in your tab.</p>
    </div>
  </div>

  <h3>The whole trip</h3>
  <ol class="trip">
    <li><span>Your browser makes a random 256-bit key and encrypts the secret with AES-256-GCM, using its built-in WebCrypto. <a href="${SRC}/form.ts#L20-L27">Read those lines</a>.</span></li>
    <li><span>It sends the server only the ciphertext, the nonce and the expiry. No key, no name. <a href="${SRC}/form.ts#L29-L32">That request</a>.</span></li>
    <li><span>The server stores them in Cloudflare KV under a random code and returns the code. Your tab puts the key after a <code>#</code> in the link.</span></li>
    <li><span>Your agent GETs the link. The server sees only the code, returns the ciphertext once and overwrites the record with a tombstone in the same request.</span></li>
    <li><span>The agent decrypts locally with the key from the fragment. A second GET gets <code>410</code>. Unclaimed links expire after 5 minutes to 24 hours.</span></li>
  </ol>

  <h3>Who sees what</h3>
  <table>
    <thead><tr><th scope="col"></th><th scope="col">Your tab</th><th scope="col">Server</th><th scope="col">Agent</th><th scope="col">Link previews</th></tr></thead>
    <tbody>
      <tr><th scope="row">The secret</th><td class="y">yes</td><td class="n">no</td><td class="y">yes</td><td class="n">no</td></tr>
      <tr><th scope="row">The key</th><td class="y">yes</td><td class="n">no</td><td class="y">yes</td><td class="n">no</td></tr>
      <tr><th scope="row">Ciphertext</th><td class="y">yes</td><td class="y">yes</td><td class="y">yes</td><td class="n">no</td></tr>
      <tr><th scope="row">Variable name</th><td class="y">yes</td><td class="n">no</td><td class="y">yes</td><td class="n">no</td></tr>
      <tr><th scope="row">IP and timing</th><td class="n">n/a</td><td class="y">yes</td><td class="n">n/a</td><td class="n">n/a</td></tr>
    </tbody>
    <caption>The server also learns the ciphertext length: the secret's length plus 16 bytes. Link previews are the Slack, Telegram, Discord and similar bots that fetch a pasted URL. They are recognised by User-Agent and get a short note instead of the ciphertext, so a preview does not burn the link.</caption>
  </table>

  <h3>What it does not protect against</h3>
  <ul class="plain">
    <li><b>The link is the secret until it is claimed.</b> Anyone who sees the whole link first can claim it. Your agent then gets <code>410</code>, which is your cue to rotate the secret.</li>
    <li><b>Single use is best effort.</b> Workers KV has no compare-and-set, so two claims racing within KV's propagation window (up to about a minute between regions) can both succeed. A Durable Object would make it strict; this version does not use one.</li>
    <li><b>Previews do not burn, and do not warn.</b> A recognised preview bot never consumes the link, so it also cannot tell you someone pasted it somewhere. A bot that is not recognised will burn it, though it still cannot decrypt anything.</li>
    <li><b>You trust the page you load.</b> A compromised server could serve a script that sends the key elsewhere. Compare the script hash below with the source, or run your own copy.</li>
    <li><b>Your agent sees the plaintext.</b> That is the point. This keeps the secret out of the chat transcript, not out of the agent's machine. An agent that prints it puts it back in the transcript.</li>
  </ul>

  <h3>Check it yourself</h3>
  <ul class="plain">
    <li><b>Read the code.</b> View this page's source: one inline script, no external files, no trackers. The server is <a href="${SRC}/app.ts">app.ts</a>, about 200 lines.</li>
    <li><b>Watch the network tab.</b> Create a test secret. The one POST carries <code>ct</code>, <code>iv</code> and <code>ttl</code>, nothing else.</li>
    <li><b>Read the headers.</b> The Content-Security-Policy lets exactly one script run, by hash: <code>sha256-{{scripthash}}</code>. <code>connect-src 'self'</code> means the page cannot talk to any other origin.</li>
    <li><b>Run your own.</b> One Cloudflare Worker and one KV namespace, no server secrets. <a href="https://github.com/mrcsXndr/agent-secret#deploy-your-own-in-3-commands">Deploy your own in three commands</a>.</li>
  </ul>
</section>

<section id="agents" aria-labelledby="agents-t">
  <h2 id="agents-t">For AI agents</h2>
  <p>If you were given a link like <code>{{host}}/k7f2-9m3q#…</code>, this is the whole protocol. Plain-text copy: <a href="/llms.txt">{{host}}/llms.txt</a>.</p>
  <ol class="trip">
    <li><span>Split the link at <code>#</code>. The part before is the URL, the part after is the key. Never send the key anywhere.</span></li>
    <li><span>GET the URL once, with a User-Agent of your own, such as <code>agent-secret-client/1.0</code>. That read burns the secret.</span></li>
    <li><span>Decrypt with AES-256-GCM. Key: base64url-decode the fragment (32 bytes). Nonce: base64-decode <code>iv</code> (12 bytes). Input: base64-decode <code>ct</code>, ciphertext with the 16-byte tag appended. The UTF-8 plaintext is the value, nothing wrapped around it.</span></li>
    <li><span>Write it straight to an environment variable, a gitignored <code>.env</code> or a secret manager.</span></li>
    <li><span>Never print, log or repeat the value. Confirm by name only: "saved OPENAI_API_KEY to .env".</span></li>
  </ol>

  <h3>Responses</h3>
  <dl class="codes">
    <dt>200</dt><dd><code>{"ct","iv"}</code>, both base64. Claimed; the secret is now burned.</dd>
    <dt>410</dt><dd><code>already_claimed</code> or <code>expired</code>. Ask the human to rotate the secret and send a new link.</dd>
    <dt>404</dt><dd><code>not_found</code>: wrong code, or expired and purged.</dd>
    <dt>403</dt><dd>Plain text <code>error code: 1010</code>: Cloudflare refused a library default User-Agent such as Python-urllib before the request reached the service. Nothing was claimed; retry with your own.</dd>
    <dt>429</dt><dd><code>rate_limited</code>. Wait a minute.</dd>
  </dl>

  <div class="code-head"><h3>curl + node</h3><button class="copy quiet" id="copySh" type="button"><span>Copy</span></button></div>
  <pre class="code" id="snSh">${escapeHtml(SNIPPET_SH)}</pre>
  <div class="code-head"><h3>Python</h3><button class="copy quiet" id="copyPy" type="button"><span>Copy</span></button></div>
  <pre class="code" id="snPy">${escapeHtml(SNIPPET_PY)}</pre>
  <p class="small">Both append to <code>.env</code> in the current directory and print only the name. Check that <code>.env</code> is gitignored. After the claim, the link left in the transcript is dead: the server no longer holds the ciphertext.</p>
</section>

<section id="compare" class="prose" aria-labelledby="compare-t">
  <h2 id="compare-t">Where it fits next to the tools you already use</h2>
  <p>agent-secret does one job: it gets a value from you to an agent once, without the value passing through the chat. It is not a place to keep secrets, and it doesn't try to be.</p>
  <h3>Password managers</h3>
  <p>1Password, Bitwarden and the like are where the key should live. Some can feed an agent directly; the 1Password CLI, for instance, injects secrets into a process with <code>op run</code>. If the agent's machine is already signed in, use that. The one-time link covers the gap: the agent runs on a server, in a container or on a colleague's laptop, and setting up a vault there for one key is more work than the key is worth.</p>
  <h3><code>.env</code> files</h3>
  <p>A gitignored <code>.env</code> is usually where the value ends up, and that is fine. The file was never the problem. The problem was how the value travelled to it. A one-time link replaces the copy and paste, not the file.</p>
  <h3>Secret managers and vaults</h3>
  <p>HashiCorp Vault, Doppler, Infisical and the cloud providers' secret managers handle rotation, access policies and audit logs for a team. That is the right home for production credentials. They assume the consumer can already authenticate to them, which an agent you started five minutes ago usually can't. Hand over the first token, or a short-lived one, with a link, and let the secret manager take it from there.</p>
</section>

<section id="faq" class="prose" aria-labelledby="faq-t">
  <h2 id="faq-t">Questions</h2>
${FAQ.map(({ q, a }) => `  <h3>${escapeHtml(q)}</h3>\n  <p>${escapeHtml(a)}</p>`).join("\n")}
</section>
</main>

<footer class="foot">
  <p>Open source under the MIT license. <a href="https://github.com/mrcsXndr/agent-secret">Source on GitHub</a>.</p>
  <p>Found a security issue? <a href="https://github.com/mrcsXndr/agent-secret/security/advisories/new">Report it privately</a>.</p>
  <p class="by"><a href="https://xndr.io">Powered by ${XNDR_SVG}</a></p>
</footer>
</div>
<script>${FORM_JS}</script>
</body>
</html>`;
