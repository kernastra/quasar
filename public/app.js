(() => {
  'use strict';

  // ─── DOM refs ──────────────────────────────────────────────────────────────
  const urlInput        = document.getElementById('urlInput');
  const extractBtn      = document.getElementById('extractBtn');
  const clearBtn        = document.getElementById('clearBtn');
  const errorMsg        = document.getElementById('errorMsg');
  const loadingState    = document.getElementById('loadingState');
  const loadingUrl      = document.getElementById('loadingUrl');
  const resultsSection  = document.getElementById('resultsSection');
  const imageGrid       = document.getElementById('imageGrid');
  const imageCount      = document.getElementById('imageCount');
  const selectedCount   = document.getElementById('selectedCount');
  const emptyState      = document.getElementById('emptyState');
  const actionGroup     = document.getElementById('actionGroup');
  const selectAllBtn    = document.getElementById('selectAllBtn');
  const deselectAllBtn  = document.getElementById('deselectAllBtn');
  const downloadBtn     = document.getElementById('downloadSelectedBtn');
  const viewGridBtn     = document.getElementById('viewGrid');
  const viewListBtn     = document.getElementById('viewList');
  const filterBtns      = document.querySelectorAll('.filter-btn');

  // Lightbox
  const lightbox        = document.getElementById('lightbox');
  const lightboxImg     = document.getElementById('lightboxImg');
  const lightboxDims    = document.getElementById('lightboxDims');
  const lightboxDL      = document.getElementById('lightboxDownload');
  const lightboxClose   = document.getElementById('lightboxClose');
  const lightboxPrev    = document.getElementById('lightboxPrev');
  const lightboxNext    = document.getElementById('lightboxNext');
  const lightboxBG      = document.getElementById('lightboxBackdrop');

  // Toast
  const downloadToast   = document.getElementById('downloadToast');
  const toastMsg        = document.getElementById('toastMsg');

  // ─── State ─────────────────────────────────────────────────────────────────
  let allImages      = [];   // { url, filename, ext, width, height, sizeClass }
  let selected       = new Set();
  let lightboxIndex  = 0;
  let currentFilter  = 'all';
  let currentView    = 'grid';

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function show(el)  { el.hidden = false; }
  function hide(el)  { el.hidden = true;  }

  function filenameFromUrl(url) {
    try {
      const p = new URL(url).pathname;
      const name = p.split('/').pop() || 'image';
      return decodeURIComponent(name).slice(0, 60) || 'image';
    } catch {
      return 'image';
    }
  }

  function extFromUrl(url) {
    try {
      const p = new URL(url).pathname.toLowerCase().split('?')[0];
      const m = p.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|avif|ico)$/);
      return m ? m[1].replace('jpeg', 'jpg') : '?';
    } catch {
      return '?';
    }
  }

  function proxyUrl(url) {
    return `/api/proxy?url=${encodeURIComponent(url)}`;
  }

  function setError(msg) {
    errorMsg.textContent = msg;
    show(errorMsg);
  }

  function clearError() { hide(errorMsg); }

  // ─── URL input handlers ────────────────────────────────────────────────────
  urlInput.addEventListener('input', () => {
    clearBtn.hidden = urlInput.value === '';
  });

  clearBtn.addEventListener('click', () => {
    urlInput.value = '';
    urlInput.focus();
    clearBtn.hidden = true;
    clearError();
  });

  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') extractBtn.click();
  });

  // ─── Extract ───────────────────────────────────────────────────────────────
  let activeSSE = null;

  extractBtn.addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (!url) { setError('Please enter a URL.'); return; }

    // Close any existing stream
    if (activeSSE) { activeSSE.close(); activeSSE = null; }

    clearError();
    hide(resultsSection);
    show(loadingState);
    loadingUrl.textContent = url.length > 60 ? url.slice(0, 60) + '…' : url;
    extractBtn.disabled = true;

    const sse = new EventSource(`/api/extract?url=${encodeURIComponent(url)}`);
    activeSSE = sse;

    sse.addEventListener('status', e => {
      const { message } = JSON.parse(e.data);
      loadingUrl.textContent = message;
    });

    sse.addEventListener('result', e => {
      sse.close();
      activeSSE = null;
      hide(loadingState);
      extractBtn.disabled = false;

      const data = JSON.parse(e.data);

      if (!data.images || data.images.length === 0) {
        allImages = [];
        selected.clear();
        renderGrid();
        show(resultsSection);
        show(emptyState);
        hide(imageGrid);
        hide(actionGroup);
        updateCountDisplay();
        return;
      }

      allImages = data.images.map(imgUrl => ({
        url: imgUrl,
        filename: filenameFromUrl(imgUrl),
        ext: extFromUrl(imgUrl),
        width: null,
        height: null,
        sizeClass: 'unknown',
      }));

      selected.clear();
      renderGrid();
      show(resultsSection);
      hide(emptyState);
      show(imageGrid);
      updateCountDisplay();
    });

    sse.addEventListener('error', e => {
      sse.close();
      activeSSE = null;
      hide(loadingState);
      extractBtn.disabled = false;
      try {
        const { error } = JSON.parse(e.data);
        setError(error);
      } catch {
        setError('Network error — could not reach the server.');
      }
    });

    sse.onerror = () => {
      if (sse.readyState === EventSource.CLOSED) return;
      sse.close();
      activeSSE = null;
      hide(loadingState);
      extractBtn.disabled = false;
      setError('Connection lost. Please try again.');
    };
  });

  // ─── Render grid ───────────────────────────────────────────────────────────
  function renderGrid() {
    imageGrid.innerHTML = '';

    allImages.forEach((img, i) => {
      const card = document.createElement('div');
      card.className = 'image-card';
      card.dataset.index = i;
      if (selected.has(i)) card.classList.add('selected');

      card.innerHTML = `
        <div class="card-checkbox">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#1e272e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="2 6 5 9 10 3"/>
          </svg>
        </div>
        <button class="card-preview-btn" title="Preview" data-index="${i}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
        <img
          class="card-thumb loading"
          src="${proxyUrl(img.url)}"
          alt="${img.filename}"
          loading="lazy"
          data-index="${i}"
        />
        <div class="card-info">
          <span class="card-filename" title="${img.filename}">${img.filename}</span>
          <div class="card-meta">
            <span class="card-dims" data-index="${i}">Loading…</span>
            <span class="card-type">${img.ext}</span>
          </div>
        </div>
      `;

      // Toggle selection on card click (not on preview button)
      card.addEventListener('click', e => {
        if (e.target.closest('.card-preview-btn')) return;
        toggleSelect(i);
      });

      imageGrid.appendChild(card);

      // Load image to get dimensions
      const imgEl = card.querySelector('.card-thumb');
      imgEl.addEventListener('load', () => {
        imgEl.classList.remove('loading');
        const w = imgEl.naturalWidth;
        const h = imgEl.naturalHeight;

        // Discard tiny images (icons, tracking pixels, etc.)
        if (w < 100 || h < 100) {
          card.remove();
          allImages[i].sizeClass = 'filtered';
          updateCountDisplay();
          return;
        }

        allImages[i].width  = w;
        allImages[i].height = h;
        allImages[i].sizeClass = getSizeClass(w, h);

        const dimsEl = card.querySelector('.card-dims');
        if (dimsEl) dimsEl.textContent = `${w} × ${h}`;

        applyFilter(currentFilter);
      });

      imgEl.addEventListener('error', () => {
        // Remove cards that fail to load entirely
        card.remove();
        allImages[i].sizeClass = 'error';
        updateCountDisplay();
      });
    });

    // Wire up preview buttons after render
    imageGrid.querySelectorAll('.card-preview-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openLightbox(parseInt(btn.dataset.index));
      });
    });

    imageCount.innerHTML = `<span>${allImages.length}</span> image${allImages.length !== 1 ? 's' : ''} found`;
    applyFilter(currentFilter);
  }

  function getSizeClass(w, h) {
    const mp = w * h;
    if (mp > 500000)  return 'large';   // > 500k px
    if (mp > 50000)   return 'medium';  // > 50k px
    return 'small';
  }

  // ─── Selection ─────────────────────────────────────────────────────────────
  function toggleSelect(index) {
    if (selected.has(index)) {
      selected.delete(index);
    } else {
      selected.add(index);
    }
    const card = imageGrid.querySelector(`.image-card[data-index="${index}"]`);
    if (card) card.classList.toggle('selected', selected.has(index));
    updateCountDisplay();
  }

  selectAllBtn.addEventListener('click', () => {
    allImages.forEach((_, i) => {
      const card = imageGrid.querySelector(`.image-card[data-index="${i}"]`);
      if (card && !card.classList.contains('filtered-out')) {
        selected.add(i);
        card.classList.add('selected');
      }
    });
    updateCountDisplay();
  });

  deselectAllBtn.addEventListener('click', () => {
    selected.clear();
    imageGrid.querySelectorAll('.image-card').forEach(c => c.classList.remove('selected'));
    updateCountDisplay();
  });

  function updateCountDisplay() {
    const visibleCards = imageGrid.querySelectorAll('.image-card').length;

    if (visibleCards === 0) {
      imageCount.innerHTML = 'No images found';
      hide(selectedCount);
      hide(actionGroup);
      return;
    }

    imageCount.innerHTML = `<span>${visibleCards}</span> image${visibleCards !== 1 ? 's' : ''} found`;

    if (selected.size > 0) {
      selectedCount.textContent = `${selected.size} selected`;
      show(selectedCount);
      show(actionGroup);
      downloadBtn.disabled = false;
    } else {
      hide(selectedCount);
      hide(actionGroup);
    }
  }

  // ─── Filter ────────────────────────────────────────────────────────────────
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      applyFilter(currentFilter);
    });
  });

  function applyFilter(filter) {
    imageGrid.querySelectorAll('.image-card').forEach(card => {
      const i   = parseInt(card.dataset.index);
      const img = allImages[i];
      const show = filter === 'all' || img.sizeClass === filter;
      card.classList.toggle('filtered-out', !show);
    });
  }

  // ─── View toggle ───────────────────────────────────────────────────────────
  viewGridBtn.addEventListener('click', () => {
    currentView = 'grid';
    imageGrid.classList.remove('list-view');
    viewGridBtn.classList.add('active');
    viewListBtn.classList.remove('active');
  });

  viewListBtn.addEventListener('click', () => {
    currentView = 'list';
    imageGrid.classList.add('list-view');
    viewListBtn.classList.add('active');
    viewGridBtn.classList.remove('active');
  });

  // ─── Download selected ─────────────────────────────────────────────────────
  downloadBtn.addEventListener('click', async () => {
    if (selected.size === 0) return;
    const indices = Array.from(selected);

    show(downloadToast);
    toastMsg.textContent = `Downloading ${indices.length} image${indices.length !== 1 ? 's' : ''}…`;

    let done = 0;
    for (const i of indices) {
      const img = allImages[i];
      try {
        const resp = await fetch(proxyUrl(img.url));
        if (!resp.ok) throw new Error('bad response');

        const blob = await resp.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = img.filename || `image-${i}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);

        done++;
        toastMsg.textContent = `Downloading… ${done}/${indices.length}`;

        // Small delay between downloads to avoid browser blocking
        if (done < indices.length) await sleep(350);
      } catch {
        // Skip failed images silently
        done++;
      }
    }

    toastMsg.textContent = `Done! Downloaded ${done} image${done !== 1 ? 's' : ''}.`;
    await sleep(2000);
    hide(downloadToast);
  });

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ─── Lightbox ──────────────────────────────────────────────────────────────
  function visibleIndices() {
    return allImages
      .map((_, i) => i)
      .filter(i => {
        const card = imageGrid.querySelector(`.image-card[data-index="${i}"]`);
        return card && !card.classList.contains('filtered-out');
      });
  }

  function openLightbox(index) {
    lightboxIndex = index;
    renderLightbox();
    show(lightbox);
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    hide(lightbox);
    document.body.style.overflow = '';
    lightboxImg.src = '';
  }

  function renderLightbox() {
    const img = allImages[lightboxIndex];
    if (!img) return;

    lightboxImg.src = '';
    lightboxDims.textContent = 'Loading…';
    lightboxImg.src = proxyUrl(img.url);
    lightboxImg.alt = img.filename;
    lightboxDL.href = proxyUrl(img.url);
    lightboxDL.download = img.filename;

    lightboxImg.onload = () => {
      const w = lightboxImg.naturalWidth;
      const h = lightboxImg.naturalHeight;
      lightboxDims.textContent = w && h ? `${w} × ${h} px` : img.filename;
    };

    lightboxImg.onerror = () => {
      lightboxDims.textContent = 'Image unavailable';
    };

    const visible = visibleIndices();
    lightboxPrev.style.display = visible.length > 1 ? '' : 'none';
    lightboxNext.style.display = visible.length > 1 ? '' : 'none';
  }

  function lightboxNavigate(direction) {
    const visible = visibleIndices();
    const pos = visible.indexOf(lightboxIndex);
    if (pos === -1) return;
    const nextPos = (pos + direction + visible.length) % visible.length;
    lightboxIndex = visible[nextPos];
    renderLightbox();
  }

  lightboxClose.addEventListener('click', closeLightbox);
  lightboxBG.addEventListener('click', closeLightbox);
  lightboxPrev.addEventListener('click', () => lightboxNavigate(-1));
  lightboxNext.addEventListener('click', () => lightboxNavigate(1));

  document.addEventListener('keydown', e => {
    if (lightbox.hidden) return;
    if (e.key === 'Escape')      closeLightbox();
    if (e.key === 'ArrowLeft')   lightboxNavigate(-1);
    if (e.key === 'ArrowRight')  lightboxNavigate(1);
  });

  // Prevent lightbox content click from closing it
  document.querySelector('.lightbox-content').addEventListener('click', e => e.stopPropagation());

})();
