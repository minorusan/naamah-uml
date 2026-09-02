// Naamah/comment-layer — the conversation UI, injected by the daemon into the served page.
//
// WHY IT IS NOT IN naamah.js. A built page is a single self-contained file you can email, and it must
// stay that way: no server, no fetch, no live anything. Comments need all three. So the static page
// keeps its promise and the DAEMON adds this layer to the copy it serves — the same graph, plus a
// conversation, only where there is something to talk to.
//
// Everything here goes through the daemon's JSON file. Clicking a card and typing does one POST; the
// SSE stream tells the page the file changed; the page re-reads it. The page holds no comment state of
// its own, so two people on two phones see the same thread, and a reload loses nothing.

export const COMMENT_LAYER = `
<style>
.nm-cbar{position:fixed;right:0;top:0;bottom:0;width:min(380px,92vw);z-index:9000;
  background:var(--surface-2,#1b1e24);border-left:1px solid var(--line,#2b2f38);
  display:flex;flex-direction:column;transform:translateX(100%);transition:transform .18s ease;
  font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink,#e6e8ec)}
.nm-cbar.open{transform:none}
.nm-chead{padding:11px 14px;border-bottom:1px solid var(--line,#2b2f38);display:flex;align-items:center;gap:9px}
.nm-chead b{font-weight:650;font-size:12.5px}
.nm-chead .nm-sp{margin-left:auto}
.nm-x{background:none;border:0;color:inherit;opacity:.6;cursor:pointer;font-size:16px;line-height:1;padding:2px 4px}
.nm-x:hover{opacity:1}
.nm-clist{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px}
.nm-th{border:1px solid var(--line,#2b2f38);border-radius:8px;padding:9px 10px;background:var(--surface-3,#20242b)}
.nm-th.res{opacity:.5}
.nm-tgt{font-size:11px;opacity:.65;margin-bottom:6px;word-break:break-all}
.nm-msg{margin:5px 0;padding-left:8px;border-left:2px solid var(--line,#333)}
.nm-msg.ag{border-left-color:var(--wire-hot,#ff8f6b)}
.nm-who{font-size:10.5px;opacity:.6}
.nm-txt{white-space:pre-wrap;word-break:break-word}
.nm-row{display:flex;gap:6px;margin-top:7px}
.nm-row input,.nm-row textarea,.nm-foot input,.nm-foot textarea{flex:1;min-width:0;background:var(--surface-1,#14161a);
  color:inherit;border:1px solid var(--line,#2b2f38);border-radius:6px;padding:6px 8px;font:inherit;resize:vertical}
.nm-b{background:var(--wire-hot,#ff8f6b);color:#14161a;border:0;border-radius:6px;padding:6px 11px;
  font:650 12px/1 ui-monospace,monospace;cursor:pointer}
.nm-b.gh{background:none;color:inherit;border:1px solid var(--line,#2b2f38);font-weight:400}
.nm-foot{padding:10px 12px;border-top:1px solid var(--line,#2b2f38);display:flex;flex-direction:column;gap:6px}
.nm-tab{position:fixed;right:14px;bottom:14px;z-index:8999}
.nm-sel{outline:2px solid var(--wire-hot,#ff8f6b) !important;outline-offset:2px}
.nm-dot{position:absolute;top:-5px;right:-5px;min-width:15px;height:15px;border-radius:8px;
  background:var(--wire-hot,#ff8f6b);color:#14161a;font:650 10px/15px ui-monospace,monospace;text-align:center}
.nm-toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9100;
  background:var(--surface-3,#20242b);border:1px solid var(--line,#2b2f38);border-radius:7px;
  padding:8px 13px;font:12px ui-monospace,monospace;color:var(--ink,#e6e8ec)}
</style>
<div class="nm-cbar" id="nmBar">
  <div class="nm-chead"><b>Comments</b><span class="nm-sp"></span>
    <button class="nm-b gh" id="nmRefresh" title="Re-read the file">reload</button>
    <button class="nm-x" id="nmClose" aria-label="Close">&times;</button></div>
  <div class="nm-clist" id="nmList"></div>
  <div class="nm-foot">
    <div class="nm-tgt" id="nmTarget">target: the page</div>
    <input id="nmWho" placeholder="your name" autocomplete="off">
    <textarea id="nmText" rows="3" placeholder="Click a card to attach a comment to it, then write here…"></textarea>
    <div class="nm-row"><button class="nm-b" id="nmSend">Comment</button>
      <button class="nm-b gh" id="nmClear">clear target</button></div>
  </div>
</div>
<button class="nm-b nm-tab" id="nmTab" style="position:fixed">Comments<span class="nm-dot" id="nmDot" hidden>0</span></button>
<script>
(function(){
  var META = /*__NAAMAH_META__*/{};
  var bar = document.getElementById('nmBar');
  var list = document.getElementById('nmList');
  var who = document.getElementById('nmWho');
  var text = document.getElementById('nmText');
  var tgtLabel = document.getElementById('nmTarget');
  var dot = document.getElementById('nmDot');
  var target = { kind: 'page', id: null, row: null, label: null };
  var selected = null;

  // The name is a per-viewer convenience, so it lives in this browser and nowhere else.
  try { who.value = localStorage.getItem('naamah.who') || ''; } catch (e) {}
  who.addEventListener('change', function(){ try { localStorage.setItem('naamah.who', who.value); } catch (e) {} });

  function toast(msg){
    var d = document.createElement('div');
    d.className = 'nm-toast'; d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(function(){ d.remove(); }, 2600);
  }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>]/g, function(c){
    return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'; }); }

  function setTarget(t, el){
    target = t;
    if (selected) selected.classList.remove('nm-sel');
    selected = el || null;
    if (selected) selected.classList.add('nm-sel');
    tgtLabel.textContent = 'target: ' + (t.kind === 'page' ? 'the page'
      : t.kind + ' ' + (t.id || '') + (t.row != null ? ' · row ' + t.row : ''));
  }

  /**
   * WHAT DID THEY CLICK. The runtime owns the DOM, so this reads the card's own identity out of the
   * attributes it already sets rather than assuming a structure — a card is found by walking up from
   * whatever was hit, which also makes a click on a member row resolve to that row AND its card.
   */
  function identify(node){
    var el = node;
    while (el && el !== document.body) {
      var id = el.getAttribute && (el.getAttribute('data-id') || el.getAttribute('data-node'));
      if (id) {
        var rowEl = node.closest && node.closest('[data-row]');
        var row = rowEl ? parseInt(rowEl.getAttribute('data-row'), 10) : null;
        return { kind: row != null && !isNaN(row) ? 'row' : 'node', id: id,
                 row: (row != null && !isNaN(row)) ? row : null,
                 label: rowEl ? (rowEl.textContent || '').trim().slice(0, 120) : null, el: el };
      }
      el = el.parentNode;
    }
    return null;
  }

  document.addEventListener('click', function(ev){
    if (bar.contains(ev.target) || ev.target.id === 'nmTab') return;
    var hit = identify(ev.target);
    if (hit) { setTarget({ kind: hit.kind, id: hit.id, row: hit.row, label: hit.label }, hit.el); open(true); }
  }, true);

  function open(x){ bar.classList.toggle('open', x !== false); }
  document.getElementById('nmTab').addEventListener('click', function(){ open(!bar.classList.contains('open')); });
  document.getElementById('nmClose').addEventListener('click', function(){ open(false); });
  document.getElementById('nmClear').addEventListener('click', function(){ setTarget({ kind:'page', id:null, row:null, label:null }, null); });

  function render(doc){
    var threads = (doc && doc.threads) || [];
    var waiting = threads.filter(function(t){
      if (t.resolved) return false;
      var m = t.messages[t.messages.length - 1];
      return !m || !m.agent;
    }).length;
    dot.hidden = waiting === 0; dot.textContent = String(waiting);

    if (!threads.length) { list.innerHTML = '<div class="nm-tgt">No comments yet. Click a card, then write below.</div>'; return; }
    list.innerHTML = threads.map(function(t){
      var tg = t.target || {};
      var where = tg.kind === 'row' && tg.id
        ? esc(tg.id) + ' · row ' + tg.row + (tg.label ? ' (' + esc(tg.label) + ')' : '')
        : esc(tg.id || tg.kind || 'page');
      var msgs = t.messages.map(function(m){
        return '<div class="nm-msg' + (m.agent ? ' ag' : '') + '">'
          + '<div class="nm-who">' + esc(m.by) + (m.agent ? ' · agent' : '') + '</div>'
          + '<div class="nm-txt">' + esc(m.text) + '</div></div>';
      }).join('');
      return '<div class="nm-th' + (t.resolved ? ' res' : '') + '" data-th="' + esc(t.id) + '">'
        + '<div class="nm-tgt">[' + esc(t.id) + '] ' + where + '</div>' + msgs
        + '<div class="nm-row"><input class="nm-rt" placeholder="reply…" autocomplete="off">'
        + '<button class="nm-b gh nm-rb">send</button>'
        + '<button class="nm-b gh nm-res">' + (t.resolved ? 'reopen' : 'resolve') + '</button></div>'
        + '</div>';
    }).join('');
  }

  function reload(){
    fetch('/comments.json', { cache: 'no-store' }).then(function(r){ return r.json(); })
      .then(render).catch(function(){ /* the daemon went away; the page stays usable */ });
  }
  document.getElementById('nmRefresh').addEventListener('click', reload);

  function post(path, body){
    return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body) }).then(function(r){
        return r.json().then(function(j){ if (!r.ok) throw new Error(j.error || r.status); return j; });
      });
  }

  document.getElementById('nmSend').addEventListener('click', function(){
    var body = text.value.trim();
    if (!body) { toast('nothing to send'); return; }
    post('/comments', { by: who.value, text: body, target: target })
      .then(function(){ text.value = ''; reload(); toast('comment saved — ayin has been woken'); })
      .catch(function(e){ toast('failed: ' + e.message); });
  });

  list.addEventListener('click', function(ev){
    var th = ev.target.closest && ev.target.closest('.nm-th');
    if (!th) return;
    var id = th.getAttribute('data-th');
    if (ev.target.classList.contains('nm-rb')) {
      var inp = th.querySelector('.nm-rt');
      var body = (inp.value || '').trim();
      if (!body) { toast('nothing to send'); return; }
      post('/reply', { thread: id, by: who.value, text: body })
        .then(function(){ inp.value = ''; reload(); }).catch(function(e){ toast('failed: ' + e.message); });
    } else if (ev.target.classList.contains('nm-res')) {
      var reopen = ev.target.textContent === 'reopen';
      post('/resolve', { thread: id, resolved: !reopen }).then(reload).catch(function(e){ toast('failed: ' + e.message); });
    }
  });

  // ── the live channel ──────────────────────────────────────────────
  // A design edit reloads the whole page, because the graph, the layout and every card changed. A
  // comment only re-reads the JSON, because reloading would throw away the pan/zoom the reader set.
  try {
    var es = new EventSource('/events');
    es.addEventListener('design', function(){ location.reload(); });
    es.addEventListener('comments', function(){ reload(); });
  } catch (e) { /* no SSE — the reload button still works */ }

  reload();
})();
</script>
`;
