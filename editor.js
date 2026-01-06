
(() => {
  const qs = (sel, root = document) => root.querySelector(sel);

  const STORAGE_KEY = 'clusters_editor_draft';

  // ---------- Helpers ----------
  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const da = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${da}`;
  }

  // ---------- Preview Logic ----------
  function buildCardElement(card) {
    const btn = document.createElement('button');
    btn.className = 'card found-card';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-pressed', 'false'); // visual only
    btn.style.cursor = 'default';
    
    if (card.onClick) btn.addEventListener('click', card.onClick);

    if (card.captionTop) btn.appendChild(ClustersUtils.renderCaptionWithMath(card.captionTop));
    const lines = document.createElement('div'); lines.className = 'lines';
    card.content.forEach(lineText => { lines.appendChild(ClustersUtils.renderTextWithMath(lineText)); });
    btn.appendChild(lines);
    return btn;
  }

  function renderPreview(data) {
    const container = qs('#previewContainer');
    container.innerHTML = '';

    if (!data.groups || !Array.isArray(data.groups)) return;

    data.groups.forEach((group, gi) => {
      const groupColor = ClustersUtils.palette[gi % ClustersUtils.palette.length];
      
      const row = document.createElement('div');
      row.className = 'found-row';
      row.style.backgroundColor = groupColor;

      const title = document.createElement('div');
      title.className = 'found-row-title';
      title.appendChild(ClustersUtils.renderTextWithMath(group.name || `Group ${gi + 1}`, { displayAllowed: false }));
      title.title = "Click to edit in JSON";
      title.addEventListener('click', () => jumpToSource(gi));
      row.appendChild(title);

      const cardsContainer = document.createElement('div');
      cardsContainer.className = 'found-row-cards';

      (group.items || []).forEach((item, ii) => {
        const cardData = {
          captionTop: item.captionTop,
          content: item.content || [],
          onClick: () => jumpToSource(gi, ii)
        };
        cardsContainer.appendChild(buildCardElement(cardData));
      });

      row.appendChild(cardsContainer);
      container.appendChild(row);
    });

    setTimeout(ClustersUtils.fitCards, 0);
  }

  // ---------- Editor Logic ----------
  function jumpToSource(gIdx, iIdx) {
    const input = qs('#jsonInput');
    const json = input.value;
    let i = 0;

    // Lightweight JSON scanner helpers
    const skipWs = () => { while (i < json.length && /\s/.test(json[i])) i++; };
    const consumeString = () => {
      if (json[i] !== '"') return;
      i++;
      while (i < json.length) {
        if (json[i] === '"') { i++; return; }
        if (json[i] === '\\') i++;
        i++;
      }
    };
    const consumeValue = () => {
      skipWs();
      const char = json[i];
      if (char === '"') consumeString();
      else if (char === '{') {
        i++;
        while (i < json.length) {
          skipWs(); if (json[i] === '}') { i++; return; }
          consumeString(); skipWs(); if (json[i] === ':') i++; // key
          consumeValue(); skipWs(); if (json[i] === ',') i++; // value
        }
      } else if (char === '[') {
        i++;
        while (i < json.length) {
          skipWs(); if (json[i] === ']') { i++; return; }
          consumeValue(); skipWs(); if (json[i] === ',') i++;
        }
      } else {
        while (i < json.length && !/[,\}\]\s]/.test(json[i])) i++;
      }
    };
    const findKey = (key) => {
      while (i < json.length) {
        skipWs(); if (json[i] === '}') return false;
        const start = i; consumeString();
        const k = JSON.parse(json.slice(start, i));
        skipWs(); if (json[i] === ':') i++;
        if (k === key) return true;
        consumeValue(); skipWs(); if (json[i] === ',') i++;
      }
      return false;
    };

    // Navigate: root -> groups -> [gIdx] -> items -> [iIdx]
    skipWs(); if (json[i] === '{') i++;
    if (!findKey('groups')) return;
    
    skipWs(); if (json[i] === '[') i++;
    for (let k = 0; k < gIdx; k++) {
      skipWs(); if (json[i] === ']') return;
      consumeValue(); skipWs(); if (json[i] === ',') i++;
    }

    skipWs();
    const groupStart = i;
    if (iIdx === undefined) {
      consumeValue();
      input.focus();
      input.setSelectionRange(groupStart, i);
      return;
    }

    if (json[i] === '{') i++;
    if (!findKey('items')) return;
    skipWs(); if (json[i] === '[') i++;
    for (let k = 0; k < iIdx; k++) {
      skipWs(); if (json[i] === ']') return;
      consumeValue(); skipWs(); if (json[i] === ',') i++;
    }

    skipWs();
    const itemStart = i;
    consumeValue();
    input.focus();
    input.setSelectionRange(itemStart, i);
  }

  function updateVisuals() {
    const input = qs('#jsonInput');
    const code = qs('#highlighting-content');
    const gutter = qs('#gutter');
    const text = input.value || '';

    // 1. Syntax Highlight
    // Escape HTML
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Tokenize JSON
    html = html.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
      let cls = 'number';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'key';
        } else {
          cls = 'string';
        }
      } else if (/true|false|null/.test(match)) {
        cls = 'boolean';
      }
      return `<span class="token-${cls}">${match}</span>`;
    });
    code.innerHTML = html + '<br>'; // Ensure last line is visible

    // 2. Line Numbers
    const lineCount = text.split('\n').length;
    gutter.innerHTML = Array.from({length: lineCount}, (_, i) => i + 1).join('<br>');
  }

  function syncScroll() {
    const input = qs('#jsonInput');
    qs('#highlighting').scrollTop = input.scrollTop;
    qs('#highlighting').scrollLeft = input.scrollLeft;
    qs('#gutter').scrollTop = input.scrollTop;
  }

  function update() {
    const input = qs('#jsonInput');
    const status = qs('#status');
    const raw = input.value;

    updateVisuals();
    
    // Save to local storage
    localStorage.setItem(STORAGE_KEY, raw);

    try {
      const data = JSON.parse(raw);
      status.textContent = '✓ Valid JSON';
      status.classList.remove('error');
      renderPreview(data);
    } catch (e) {
      status.innerHTML = '';
      status.classList.add('error');
      
      const msg = document.createElement('span');
      msg.textContent = '⚠ Invalid JSON: ' + e.message;
      status.appendChild(msg);

      let index = -1, line = -1, col = -1;
      
      // V8/Chrome: "at position N"
      const matchPos = e.message.match(/at position (\d+)/);
      if (matchPos) {
        index = parseInt(matchPos[1], 10);
        const upTo = raw.slice(0, index);
        const lines = upTo.split('\n');
        line = lines.length;
        col = lines[lines.length - 1].length + 1;
      } 
      // Firefox: "line L column C"
      else {
        const matchLC = e.message.match(/line (\d+) column (\d+)/);
        if (matchLC) {
          line = parseInt(matchLC[1], 10);
          col = parseInt(matchLC[2], 10);
          const lines = raw.split('\n');
          index = 0;
          for (let i = 0; i < line - 1 && i < lines.length; i++) {
            index += lines[i].length + 1;
          }
          index += col - 1;
        }
      }

      if (index !== -1) {
        const link = document.createElement('a');
        link.href = '#';
        link.textContent = ` (Go to Line ${line}, Col ${col})`;
        link.style.cssText = 'color: inherit; text-decoration: underline; margin-left: 8px; cursor: pointer;';
        link.addEventListener('click', (ev) => {
          ev.preventDefault();
          input.focus();
          input.setSelectionRange(index, index + 1);
        });
        status.appendChild(link);
      }
    }
  }

  function generateSkeleton() {
    const numGroups = parseInt(qs('#genGroups').value || 4, 10);
    const groupSize = parseInt(qs('#genSize').value || 4, 10);
    
    const skeleton = {
      id: `puzzle-${todayISO()}`,
      title: "New Puzzle",
      date: todayISO(),
      author: "Your Name",
      groupSize: groupSize,
      groups: []
    };

    for (let i = 0; i < numGroups; i++) {
      const items = [];
      for (let j = 0; j < groupSize; j++) {
        items.push({ captionTop: "", content: [`Item ${i + 1}.${j + 1}`] });
      }
      skeleton.groups.push({
        name: `Group ${i + 1}`,
        items: items
      });
    }

    qs('#jsonInput').value = JSON.stringify(skeleton, null, 2);
    update();
  }

  function downloadJson() {
    const raw = qs('#jsonInput').value;
    let filename = 'puzzle.json';
    try {
      const data = JSON.parse(raw);
      if (data.id) filename = `${data.id}.json`;
    } catch {}

    const blob = new Blob([raw], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function copyJson() {
    const raw = qs('#jsonInput').value;
    navigator.clipboard.writeText(raw).then(() => {
      const status = qs('#status');
      status.textContent = 'JSON copied to clipboard.';
      status.classList.remove('error');
    }).catch(() => {
      const status = qs('#status');
      status.textContent = 'Failed to copy JSON.';
      status.classList.add('error');
    });
  }

  function shareLink() {
    const raw = qs('#jsonInput').value;
    try {
      // Validate JSON first
      const data = JSON.parse(raw);
      const minified = JSON.stringify(data);
      
      // Encode UTF-8 to Base64 safely
      const binString = Array.from(new TextEncoder().encode(minified), (byte) =>
        String.fromCharCode(byte)
      ).join("");
      const base64 = btoa(binString);

      const url = new URL('index.html', window.location.href);
      url.searchParams.set('custom', base64);
      
      navigator.clipboard.writeText(url.toString()).then(() => {
        const status = qs('#status');
        status.textContent = 'Game link copied to clipboard!';
        status.classList.remove('error');
      });
    } catch (e) {
      const status = qs('#status');
      status.textContent = 'Invalid JSON or encoding error.';
      status.classList.add('error');
    }
  }

  function init() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      qs('#jsonInput').value = saved;
      update();
    } else {
      generateSkeleton();
    }

    qs('#jsonInput').addEventListener('input', update);
    qs('#btnGenerate').addEventListener('click', generateSkeleton);
    qs('#btnDownload').addEventListener('click', downloadJson);
    qs('#btnCopy').addEventListener('click', copyJson);
    qs('#btnShare').addEventListener('click', shareLink);
    qs('#jsonInput').addEventListener('scroll', syncScroll);
    window.addEventListener('resize', () => requestAnimationFrame(ClustersUtils.fitCards));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
