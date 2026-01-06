
(() => {
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = {
    manifest: null,
    puzzle: null,
    flatCards: [],
    groupMeta: [],          // [{groupId, groupName, groupColor}]
    selection: new Set(),
    foundGroupIds: new Set(),
    mistakes: 0,
    triesMax: 4,
    groupSize: null,
    isAnimating: false,
    shuffleNonce: 0,
    puzzleId: null
  };

  // ---------- UTIL ----------
  const parseParams = () => {
    const p = new URLSearchParams(location.search);
    return {
      puzzle: p.get('puzzle'),
      tries: p.get('tries'),
      custom: p.get('custom')
    };
  };

  const showToast = (msg, duration = 2500) => {
    let container = qs('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    container.appendChild(toast);
    
    // Trigger reflow to enable transition
    toast.offsetHeight;
    toast.classList.add('show');

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  };

  const toIntOrInf = (val, fallback = 4) => {
    if (!val) return fallback;
    const s = String(val).toLowerCase();
    if (s.startsWith('inf')) return Infinity;
    const num = parseInt(s, 10);
    return Number.isFinite(num) ? num : fallback;
  };

  const shuffleInPlace = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const resetProgress = () => {
    state.selection.clear();
    state.foundGroupIds.clear();
    state.mistakes = 0;
    renderFoundRows();
    renderGrid();
    updateStatus();
  };

  // ---------- DATA LOAD ----------
  async function loadManifest() {
    const res = await fetch('puzzles/manifest.json');
    if (!res.ok) throw new Error('Unable to load manifest');
    const data = await res.json();

    // Fetch details for each puzzle ID found in manifest
    const ids = (data.puzzles || []).map(p => (typeof p === 'string' ? p : p.id));
    const items = await Promise.all(ids.map(async (id) => {
      try {
        const r = await fetch(`puzzles/${id}.json`);
        if (!r.ok) return null;
        const p = await r.json();
        return { id, title: p.title, date: p.date, author: p.author };
      } catch { return null; }
    }));

    state.manifest = { puzzles: items.filter(Boolean) };
  }

  async function loadPuzzle(puzzleId) {
    const res = await fetch(`puzzles/${puzzleId}.json`);
    if (!res.ok) throw new Error('Unable to load puzzle');
    const puzzle = await res.json();
    state.puzzle = puzzle;
    state.puzzleId = puzzle.id;
    if (puzzle.groupSize) {
      state.groupSize = parseInt(puzzle.groupSize, 10);
    } else {
      state.groupSize = puzzle.groups?.[0]?.items?.length || 4;
    }
    flattenCards();
  }

  function flattenCards() {
    const cards = [];
    state.groupMeta = [];
    // Auto-assign colors (Yellow, Green, Blue, Purple, Pink, Cyan - Darker shades for contrast)
    const palette = ['#854d0e', '#15803d', '#1d4ed8', '#7e22ce', '#be185d', '#0e7490'];

    state.puzzle.groups.forEach((group, gIdx) => {
      const groupId = `g${gIdx}`;
      const groupName = group.name || `Group ${gIdx + 1}`;
      const groupColor = palette[gIdx % palette.length];
      state.groupMeta.push({ groupId, groupName, groupColor });

      (group.items || []).forEach((item, iIdx) => {
        const itemId = `${groupId}-i${iIdx}`;
        cards.push({
          id: itemId,
          groupId,
          groupName,
          groupColor,
          captionTop: item.captionTop || null,
          content: item.content || []
        });
      });
    });
    state.flatCards = cards;
  }

  // ---------- MATH RENDERING ----------
  function renderTextWithMath(text, { displayAllowed = true } = {}) {
    const container = document.createElement('div');
    container.className = 'line';

    const parts = [];
    let i = 0;
    while (i < text.length) {
      const nextDisplay = displayAllowed ? text.indexOf('$$', i) : -1;
      const nextInline = text.indexOf('$', i);
      const nextEscaped = text.indexOf('\\$', i);

      const indices = [nextDisplay, nextInline, nextEscaped].filter(x => x !== -1);
      if (indices.length === 0) {
        parts.push(text.slice(i));
        break;
      }
      const minIdx = Math.min(...indices);

      if (minIdx > i) parts.push(text.slice(i, minIdx));

      if (minIdx === nextEscaped) {
        parts.push('$');
        i = minIdx + 2;
      } else if (minIdx === nextDisplay) {
        const end = text.indexOf('$$', minIdx + 2);
        if (end === -1) { parts.push(text.slice(minIdx)); break; }
        parts.push({ type: 'display', tex: text.slice(minIdx + 2, end).trim() });
        i = end + 2;
      } else { // nextInline
        const end = text.indexOf('$', minIdx + 1);
        if (end === -1) { parts.push(text.slice(minIdx)); break; }
        parts.push({ type: 'inline', tex: text.slice(minIdx + 1, end).trim() });
        i = end + 1;
      }
    }

    parts.forEach(part => {
      if (typeof part === 'string') {
        container.appendChild(document.createTextNode(part));
      } else if (part.type === 'inline') {
        const span = document.createElement('span');
        if (window.katex?.render) {
          try { window.katex.render(part.tex, span, { throwOnError: false, displayMode: false }); }
          catch { span.textContent = part.tex; span.className = 'inline-math'; }
        } else { span.textContent = part.tex; span.className = 'inline-math'; }
        container.appendChild(span);
      } else if (part.type === 'display') {
        const block = document.createElement('div');
        block.className = 'display-math';
        if (window.katex?.render) {
          try { window.katex.render(part.tex, block, { throwOnError: false, displayMode: true }); }
          catch { block.textContent = part.tex; block.classList.add('inline-math'); }
        } else { block.textContent = part.tex; block.classList.add('inline-math'); }
        container.appendChild(block);
      }
    });

    return container;
  }

  function renderCaptionWithMath(text) {
    const el = renderTextWithMath(text, { displayAllowed: false });
    el.className = 'caption';
    return el;
  }

  // ---------- RENDER ----------
  function setColumns() {
    const cols = state.groupSize;
    qs('#grid').style.setProperty('--cols', cols);
    qs('#foundRows').style.setProperty('--cols', cols);
  }

  function buildCardElement(card, { locked = false } = {}) {
    const btn = document.createElement('button');
    btn.className = 'card' + (locked ? ' card--locked' : '');
    btn.setAttribute('role', 'button');
    btn.setAttribute('data-card-id', card.id);
    btn.setAttribute('data-group-id', card.groupId);
    btn.setAttribute('aria-pressed', locked ? 'false' : (state.selection.has(card.id) ? 'true' : 'false'));

    if (card.captionTop) btn.appendChild(renderCaptionWithMath(card.captionTop));

    const lines = document.createElement('div');
    lines.className = 'lines';
    card.content.forEach(lineText => {
      lines.appendChild(renderTextWithMath(lineText));
    });
    btn.appendChild(lines);

    if (!locked) {
      btn.addEventListener('click', () => toggleSelect(card.id));
      btn.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') {
          evt.preventDefault();
          toggleSelect(card.id);
        }
      });
    }
    return btn;
  }

  function renderGrid() {
    const grid = qs('#grid');
    grid.innerHTML = '';
    setColumns();

    const activeCards = state.flatCards.filter(c => !state.foundGroupIds.has(c.groupId));
    const cards = shuffleInPlace([...activeCards]); // always shuffle

    cards.forEach(card => grid.appendChild(buildCardElement(card)));

    updateGameControls();
  }

  function renderFoundRows(animateLast = false) {
    const container = qs('#foundRows');
    container.innerHTML = '';
    setColumns();

    // Render rows in the order they were solved (using foundGroupIds insertion order)
    [...state.foundGroupIds].forEach((groupId, idx, arr) => {
      const group = state.groupMeta.find(g => g.groupId === groupId);
      const row = document.createElement('div');
      row.className = 'found-row';
      
      row.style.backgroundColor = group.groupColor;

      if (animateLast && idx === arr.length - 1) {
        row.classList.add('slide-in');
      }

      const title = document.createElement('div');
      title.className = 'found-row-title';
      title.appendChild(renderTextWithMath(group.groupName, { displayAllowed: false }));
      row.appendChild(title);

      const cardsContainer = document.createElement('div');
      cardsContainer.className = 'found-row-cards';

      const items = state.flatCards.filter(c => c.groupId === groupId);
      items.forEach(card => {
        const btn = buildCardElement(card, { locked: true });
        btn.classList.add('found-card');
        cardsContainer.appendChild(btn);
      });

      row.appendChild(cardsContainer);
      container.appendChild(row);
    });
  }

  function renderPuzzleMeta() {
    const meta = qs('#puzzleMeta');
    if (!state.puzzle || !meta) return;
    const { title, date, author } = state.puzzle;
    const parts = [];
    if (title) parts.push(title);
    if (date) parts.push(date);
    if (author) parts.push(`by ${author}`);
    meta.textContent = parts.join(' • ');
  }

  function updateStatus() {
    const status = qs('#statusText');
    const remaining = state.triesMax === Infinity ? '<span class="infinite">∞</span>' : Math.max(0, state.triesMax - state.mistakes);
    const groupsTotal = state.groupMeta.length;
    const groupsFound = state.foundGroupIds.size;
    status.innerHTML = `Mistakes left: ${remaining} • Groups: ${groupsFound}/${groupsTotal}`;
  }

  function isGameOver() {
    return state.triesMax !== Infinity && state.mistakes >= state.triesMax;
  }

  function updateGameControls() {
    const over = isGameOver();
    qs('#submitGroup').disabled = state.isAnimating || over || (state.selection.size !== state.groupSize);
    qs('#clearSelection').disabled = state.isAnimating || over || state.selection.size === 0;
    qs('#shuffleRemaining').disabled = state.isAnimating || over;
  }

  function toggleSelect(cardId) {
    const activeCards = state.flatCards.filter(c => !state.foundGroupIds.has(c.groupId));
    const activeIds = new Set(activeCards.map(c => c.id));
    if (!activeIds.has(cardId)) return;

    if (isGameOver()) return;

    if (state.isAnimating) return;
    if (state.selection.has(cardId)) {
      state.selection.delete(cardId);
    } else {
      if (state.selection.size >= state.groupSize) return;
      state.selection.add(cardId);
    }
    reflectSelection();
  }

  function reflectSelection() {
    qsa('.card').forEach(el => {
      const id = el.getAttribute('data-card-id');
      const locked = el.classList.contains('card--locked');
      el.setAttribute('aria-pressed', locked ? 'false' : (state.selection.has(id) ? 'true' : 'false'));
    });
    updateGameControls();
  }

  function submitGroup() {
    if (isGameOver()) return;
    if (state.isAnimating) return;
    if (state.selection.size !== state.groupSize) return;
    const selectedIds = [...state.selection];
    const selectedCards = selectedIds.map(id => state.flatCards.find(c => c.id === id));
    const allGroup = selectedCards[0].groupId;
    const isValid = selectedCards.every(c => c.groupId === allGroup);

    state.isAnimating = true;
    updateGameControls();

    const selectedEls = qsa('.card[aria-pressed="true"]');
    selectedEls.forEach(el => el.classList.add(isValid ? 'pop' : 'shake'));

    setTimeout(() => {
      if (isValid) {
        state.foundGroupIds.add(allGroup);
        state.selection.clear();

        // Re-render found rows and remaining grid
        renderFoundRows(true);
        renderGrid();
        updateStatus();

        if (state.foundGroupIds.size === state.groupMeta.length) {
          setTimeout(() => showToast('You found all groups! 🎉', 4000), 100);
        }
      } else {
        selectedEls.forEach(el => el.classList.remove('shake'));
        state.mistakes++;
        
        // Check for "One Away"
        const counts = {};
        selectedCards.forEach(c => counts[c.groupId] = (counts[c.groupId] || 0) + 1);
        const isOneAway = Object.values(counts).some(c => c === state.groupSize - 1);
        if (isOneAway) showToast('One away...');

        updateStatus();
        if (state.triesMax !== Infinity && state.mistakes >= state.triesMax) {
          showToast('Out of mistakes. Game over.', 4000);
        }
      }
      state.isAnimating = false;
      updateGameControls();
    }, isValid ? 300 : 500);
  }

  function clearSelection() {
    state.selection.clear();
    reflectSelection();
  }


  // ---------- INIT ----------
  async function init() {
    const params = parseParams();

    // Check for custom puzzle via URL param first
    if (params.custom) {
      try {
        const binString = atob(params.custom);
        const bytes = Uint8Array.from(binString, (m) => m.codePointAt(0));
        const json = new TextDecoder().decode(bytes);
        const puzzle = JSON.parse(json);

        state.puzzle = puzzle;
        state.puzzleId = puzzle.id || 'custom';
        state.triesMax = toIntOrInf(params.tries, 4);
        if (puzzle.groupSize) {
          state.groupSize = parseInt(puzzle.groupSize, 10);
        } else {
          state.groupSize = puzzle.groups?.[0]?.items?.length || 4;
        }
        flattenCards();

        qs('#homeView').hidden = true;
        qs('#gameView').hidden = false;
        qs('#backToHome').hidden = false;
        
        setupGameListeners();
        renderFoundRows();
        renderGrid();
        updateStatus();
        renderPuzzleMeta();
        return;
      } catch (e) {
        showToast('Failed to load custom puzzle: ' + e.message, 4000);
      }
    }

    try { await loadManifest(); } catch {}

    if (!params.puzzle) {
      renderHome();
      return;
    }

    state.triesMax = toIntOrInf(params.tries, 4);

    try { await loadPuzzle(params.puzzle); }
    catch (err) { showToast('Failed to load puzzle: ' + err.message, 4000); renderHome(); return; }

    qs('#homeView').hidden = true;
    qs('#gameView').hidden = false;
    qs('#backToHome').hidden = false;

    setupGameListeners();

    renderFoundRows();
    renderGrid();
    updateStatus();
    renderPuzzleMeta();
  }

  function setupGameListeners() {
    qs('#submitGroup').addEventListener('click', submitGroup);
    qs('#clearSelection').addEventListener('click', clearSelection);
    qs('#resetGame').addEventListener('click', () => {
      const ok = confirm('Reset progress for this puzzle?');
      if (ok) resetProgress();
    });

    qs('#backToHome').addEventListener('click', () => {
      const url = new URL(location.href);
      url.search = '';
      location.href = url.toString();
    });

    // Shuffle Remaining with animation
    qs('#shuffleRemaining').addEventListener('click', () => {
      const grid = qs('#grid');
      clearSelection(); // optional, keeps UX clear
      grid.classList.add('fade-out');
      state.shuffleNonce++;
      setTimeout(() => {
        renderGrid();               // reshuffle remaining cards (renderGrid always shuffles)
        grid.classList.remove('fade-out');
        grid.classList.add('fade-in');
        setTimeout(() => grid.classList.remove('fade-in'), 300);
      }, 300);
    });
  }

  function renderHome() {
    qs('#homeView').hidden = false;
    qs('#gameView').hidden = true;
    qs('#backToHome').hidden = true;

    const select = qs('#puzzleSelect');
    select.innerHTML = '';

    if (!state.manifest || !state.manifest.puzzles || state.manifest.puzzles.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = 'No puzzles found';
      select.appendChild(opt);
      select.disabled = true;
      qs('#configForm button').disabled = true;
    } else {
      state.manifest.puzzles.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.title} (${p.date} - ${p.author})`;
        select.appendChild(opt);
      });
    }

    qs('#configForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const tries = qs('#tries').value || '4';
      const puzzleId = select.value;
      const url = new URL(location.href);
      url.searchParams.set('puzzle', puzzleId);
      url.searchParams.set('tries', tries);
      location.href = url.toString();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
