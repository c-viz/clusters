window.ClustersUtils = (() => {
  const palette = ['#854d0e', '#15803d', '#1d4ed8', '#7e22ce', '#be185d', '#0e7490'];

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

  function fitCards() {
    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
      const lines = card.querySelector('.lines');
      const caption = card.querySelector('.caption');

      // Reset to measure natural size
      if (lines) lines.style.transform = '';
      if (caption) caption.style.transform = '';
      
      const cardRect = card.getBoundingClientRect();
      
      // Add some padding buffer (e.g. 8px total)
      const availW = cardRect.width - 8;
      let availH = cardRect.height - 8;

      if (caption) {
        const capScale = Math.min(1, availW / caption.scrollWidth);
        if (capScale < 1) {
          caption.style.transform = `scale(${capScale})`;
        }
        availH -= caption.offsetHeight + 2; // +2 for margin
      }
      
      if (lines) {
        const scaleW = Math.min(1, availW / lines.scrollWidth);
        const scaleH = Math.min(1, Math.max(0, availH) / lines.scrollHeight);
        const scale = Math.min(scaleW, scaleH);
        
        if (scale < 1) {
          lines.style.transform = `scale(${scale})`;
        }
      }
    });
  }

  return {
    palette,
    renderTextWithMath,
    renderCaptionWithMath,
    fitCards
  };
})();
