import { state } from './state.js';
import { db } from '../firebase-config.js';
import { ref, set, update, remove, push, onValue } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { loadDriveImageToCanvas, removeLocalFile } from './media.js';
import { drawPlaceholder, broadcastFrame, renderVideoToCanvas, renderImageToCanvas, renderTextToCanvas } from './renderer.js';

// One sidebar row. Text goes in via textContent so song titles / file names can never inject HTML.
// Colours per row type (.kind-gallery / .kind-drive / .kind-live) live in style.css.
function makeSongItem(kind, icon, text) {
    const div = document.createElement('div');
    div.className = 'song-item kind-' + kind;
    const ic = document.createElement('span');
    ic.className = 'song-icon';
    ic.textContent = icon;
    const nm = document.createElement('span');
    nm.className = 'song-name';
    nm.textContent = text;
    nm.title = text;
    div.append(ic, nm);
    return div;
}

export function renderHybridSidebar() {
    const list = document.getElementById('song-list');
    if(!list) return;
    list.innerHTML = '';

    // The list is rebuilt on every Firebase update; remember what is open so the highlight survives it.
    const current = window.currentSongData;

    if (state.localMediaState.length > 0) {
        const div = makeSongItem('gallery', '📂', `Local Gallery (${state.localMediaState.length})`);
        if (current && current.type === 'local_set') div.classList.add('active');
        div.onclick = () => { if(window.openLocalMediaGallery) window.openLocalMediaGallery(div); };
        list.appendChild(div);
    }

    state.driveImagesState.forEach(file => {
        const div = makeSongItem('drive', '📷', file.name);
        div.onclick = () => loadDriveImageToCanvas(file.id, file.name, div);
        list.appendChild(div);
    });

    if (Object.keys(state.liveSongsState).length > 0) {
        // A song without a title must not crash the sort (and blank the whole list)
        const titleOf = (k) => state.liveSongsState[k].title || '';
        const sortedKeys = Object.keys(state.liveSongsState).sort((a,b) => {
            const orderA = (state.liveSongsState[a].order !== undefined) ? state.liveSongsState[a].order : 9999;
            const orderB = (state.liveSongsState[b].order !== undefined) ? state.liveSongsState[b].order : 9999;
            if (orderA === orderB) return titleOf(a).localeCompare(titleOf(b));
            return orderA - orderB;
        });

        sortedKeys.forEach(key => {
            const song = state.liveSongsState[key];
            const div = makeSongItem('live', '🎶', song.title || 'Untitled');
            div.dataset.key = key;
            if (current && current.type === 'song' && current.name === song.title) div.classList.add('active');

            const handle = document.createElement('span');
            handle.className = 'live-drag-handle';
            handle.textContent = '☰';
            handle.title = 'Drag to reorder';
            div.prepend(handle);
            
            div.onclick = (e) => {
                if(e.target.classList.contains('live-drag-handle')) return;
                if(window.loadLiveSongFromMemory) window.loadLiveSongFromMemory(song, div);
            };

            addLiveDragEvents(div);
            list.appendChild(div);
        });
    }
}

export function initRemoteVideoSync() {
    onValue(ref(db, 'presentation/video_status'), (snapshot) => {
        const data = snapshot.val();
        if (!data || state.isSeeking) return; 

        const seeker = document.getElementById('video-seeker');
        const timer = document.getElementById('video-time-display');

        if (seeker) seeker.value = data.percent;

        if (timer) {
            const mins = Math.floor(data.time / 60);
            const secs = Math.floor(data.time % 60);
            timer.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
    });
}

export function addLiveDragEvents(item) {
    item.draggable = false;
    const handle = item.querySelector('.live-drag-handle');
    
    handle.addEventListener('mousedown', () => { item.draggable = true; });
    handle.addEventListener('mouseup', () => { item.draggable = false; });
    item.addEventListener('dragstart', function(e) { 
        state.draggedLiveItem = item; 
        setTimeout(() => item.classList.add('dragging'), 0); 
    });
    item.addEventListener('dragend', function() { 
        setTimeout(() => item.classList.remove('dragging'), 0); 
        state.draggedLiveItem = null; 
        item.draggable = false; 
        saveLiveOrder(); 
    });
}

setTimeout(() => {
    const liveListContainer = document.getElementById('song-list');
    if(liveListContainer) {
        liveListContainer.addEventListener('dragover', function(e) {
            e.preventDefault();
            const afterElement = getLiveDragAfterElement(liveListContainer, e.clientY);
            if (state.draggedLiveItem) {
                if (afterElement == null) liveListContainer.appendChild(state.draggedLiveItem);
                else liveListContainer.insertBefore(state.draggedLiveItem, afterElement);
            }
        });
    }
}, 1000);

export function getLiveDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.song-item:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
        else return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

export function saveLiveOrder() {
    const items = document.querySelectorAll('#song-list .song-item');
    const updates = {};
    items.forEach((item, index) => {
        const key = item.dataset.key;
        // 🎯 THE FIX: Point to song_archive instead of live_library!
        if(key) updates['song_archive/' + key + '/order'] = index;
    });
    update(ref(db), updates).then(() => {
        if(window.showNotification) window.showNotification("Order Updated 🔄");
    }).catch(e => console.error(e));
}

export const launchAudience = () => {
    const btn = document.getElementById('btnLaunch');
    if (state.audienceWindow && !state.audienceWindow.closed) { state.audienceWindow.focus(); return; }
    
    state.audienceWindow = window.open("", "AudienceWindow", "width=1920,height=1080");
    if (!state.audienceWindow) { alert("Popup Blocked!"); return; }
    
    state.audienceWindow.document.write(getAudienceTemplate());
    btn.disabled = true; 
    btn.innerHTML = "🚀 Audience Active";
    const check = setInterval(() => {
        if(!state.audienceWindow || state.audienceWindow.closed) { 
            clearInterval(check); 
            state.audienceWindow = null; 
            btn.disabled = false; 
            btn.innerHTML = "🚀 Launch Audience View"; 
        }
    }, 1000);
    setTimeout(() => {
        if (state.audienceWindow && !state.audienceWindow.closed) {
            if (state.isBlackout) state.audienceWindow.updateDisplay('offline');
            else { 
                const d = state.canvas.toDataURL('image/webp', 0.95); 
                state.audienceWindow.updateDisplay('image', d); 
            }
        }
    }, 800);
};

// Small DOM helpers so text from the database is always inserted as text (never parsed as HTML)
function makeCardLabel(text) {
    const label = document.createElement('div');
    label.className = 'card-label';
    label.textContent = text ?? '';
    return label;
}
function makeCardButton(cls, text, onClick) {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
}

export const renderLyricsGrid = () => {
    const grid = document.getElementById('lyrics-grid');
    grid.innerHTML = '';
    if(!window.currentSongData) return;
    
    const searchContainer = document.getElementById('gallery-search-container');
    if (searchContainer) searchContainer.style.display = 'none'; 
    
    if (window.currentSongData.type === 'local_set') {
        if (searchContainer) {
            searchContainer.style.display = 'block';
            document.getElementById('gallery-search').value = ''; 
        }

        window.currentSongData.parts.forEach((part, index) => {
            const card = document.createElement('div');
            card.className = 'lyric-card is-local'; card.id = `part-${index}`;
            
            card.draggable = true;
            card.dataset.firebaseKey = part.firebaseKey;
            
            card.addEventListener('dragstart', () => { 
                state.draggedGalleryItem = card; 
                setTimeout(() => card.classList.add('dragging-gallery'), 0); 
            });
            card.addEventListener('dragend', () => { 
                card.classList.remove('dragging-gallery'); 
                state.draggedGalleryItem = null; 
                if(window.saveGalleryOrder) window.saveGalleryOrder();
            });
            
            // Preview (all styling lives in style.css: .card-preview img/video, .note-preview)
            const preview = document.createElement('div');
            preview.className = 'card-preview';
            if (part.type === 'note') {
                const note = document.createElement('div');
                note.className = 'note-preview';
                note.textContent = part.src;
                preview.appendChild(note);
            } else if (part.type === 'video_local') {
                const v = document.createElement('video');
                v.src = part.src; v.muted = true;
                preview.appendChild(v);
            } else {
                const img = document.createElement('img');
                img.alt = '';
                if (part.type === 'youtube') { img.src = `https://img.youtube.com/vi/${encodeURIComponent(part.src)}/0.jpg`; img.className = 'cover'; }
                else img.src = part.src;
                preview.appendChild(img);
            }

            card.append(makeCardButton('delete-btn', '×', (e) => removeLocalFile(part.firebaseKey, e)));
            if (part.type !== 'youtube' && part.type !== 'note') {
                card.append(makeCardButton('card-btn setbg', '🌌 SET BG', (e) => setMediaAsBackground(index, e)));
            }
            if (part.type === 'note') {
                card.append(makeCardButton('card-btn edit', '✏️ EDIT', (e) => { e.stopPropagation(); openNoteEditor(part.firebaseKey); }));
            }
            card.append(makeCardLabel(part.name), preview);
                
            card.onclick = () => { if(window.goLive) window.goLive(index); };
            grid.appendChild(card);
        });
    } else if (window.currentSongData.parts) {
        window.currentSongData.parts.forEach((part, index) => {
            const card = document.createElement('div');
            card.className = 'lyric-card'; card.id = `part-${index}`;
            const preview = document.createElement('div');
            preview.className = 'card-preview';
            preview.textContent = part.lyrics ?? '';
            card.append(makeCardLabel(part.name), preview);
            card.onclick = () => { if(window.goLive) window.goLive(index); };
            grid.appendChild(card);
        });
    }
};

export const setMediaAsBackground = (index, e) => {
    if (e) e.stopPropagation(); 
    
    const item = window.currentSongData.parts[index];
    if (!item || !item.firebaseKey) {
        alert("This file is missing its database key. Please re-upload it.");
        return;
    }

    const isVideo = item.type === 'video_local';
    const typeStr = isVideo ? 'video' : 'image';
    
    state.textSettings.bgMedia = { type: typeStr, key: item.firebaseKey, src: item.src };
    state.textSettings.bgImage = null; 
    state.textSettings.color = 'white'; 
    
    document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
    savePrefs();
    
    set(ref(db, 'presentation/background'), {
        state: 'play',
        type: typeStr,
        src: 'db_key:' + item.firebaseKey
    });
    
    if(window.showNotification) window.showNotification("Background Applied! 🌌");
    
    if(state.currentPartIndex >= 0 && window.goLive) window.goLive(state.currentPartIndex);
    else {
        state.ctx.clearRect(0,0,1920,1080);
        broadcastFrame('all');
    }
};
window.setMediaAsBackground = setMediaAsBackground;

export const goLive = async (index) => {
    if(!window.currentSongData) return;
    if (state.isBlackout && window.updateStatus) window.updateStatus('online'); 
    
    state.currentPartIndex = index;
    set(ref(db, 'presentation/currentSlide'), state.currentPartIndex + 1);
    
    document.getElementById('video-controls').style.display = 'none';
    if(state.videoSyncTimer) clearInterval(state.videoSyncTimer);
    document.querySelectorAll('.lyric-card').forEach(c => c.classList.remove('active'));
    
    const activeCard = document.getElementById(`part-${index}`);
    if(activeCard) { 
        activeCard.classList.add('active');
        activeCard.scrollIntoView({ behavior: 'smooth', block: 'center' }); 
    }

    const item = window.currentSongData.type === 'local_set' ? window.currentSongData.parts[index] : window.currentSongData;
    const src = window.currentSongData.type === 'local_set' ? item.src : window.currentSongData.src;
    const type = window.currentSongData.type === 'local_set' ? item.type : window.currentSongData.type;

    // --- REVERT BACKGROUND ISOLATION LOGIC ---
    if (type !== 'note' && state.tempNoteBgActive) {
        if (state.textSettings.bgMedia) {
            set(ref(db, 'presentation/background'), { state: 'play', type: state.textSettings.bgMedia.type, src: 'db_key:' + state.textSettings.bgMedia.key });
        } else {
            set(ref(db, 'presentation/background'), { state: 'stop' });
        }
        state.tempNoteBgActive = false;
        state.ctx.clearRect(0,0,1920,1080); // Force local refresh
    }

    if (type === 'youtube') {
        document.getElementById('video-controls').style.display = 'flex';
        if (state.audienceWindow && !state.audienceWindow.closed && state.audienceWindow.updateDisplay) {
            state.audienceWindow.updateDisplay('youtube', src);
            startVideoSync();
        }
        set(ref(db, 'presentation/video'), { state: 'play', type: 'youtube', src: src, time: 0 });
        drawPlaceholder("YouTube Video Playing", item.name || "YouTube");
        broadcastFrame('firebase');
        return;
    }

    if (type && type.includes('video')) {
        document.getElementById('video-controls').style.display = 'flex';
        
        let fastLocalSrc = src;
        let remoteCommandSrc = src;
        let isPermanentDB = false;

        if (src.startsWith('data:video')) {
            try {
                const res = await fetch(src);
                fastLocalSrc = URL.createObjectURL(await res.blob());
            } catch(e) { console.warn("Blob conversion failed", e); }
            
            if (item.firebaseKey) {
                remoteCommandSrc = 'db_key:' + item.firebaseKey;
                isPermanentDB = true;
            }
        } else if (src.startsWith('blob:')) {
            remoteCommandSrc = 'canvas_only';
        }

        if (state.audienceWindow && !state.audienceWindow.closed) { 
            state.audienceWindow.updateDisplay('video', fastLocalSrc);
            startVideoSync(); 
        }
        
        set(ref(db, 'presentation/video'), { state: 'play', type: 'video', src: remoteCommandSrc, time: 0 });
        
        if (isPermanentDB) {
            drawPlaceholder("Video Playing", "Playing natively on Audience Screen");
            broadcastFrame('firebase');
            renderVideoToCanvas(fastLocalSrc, false); 
        } else {
            renderVideoToCanvas(fastLocalSrc, true); 
        }
        return;
    }

    set(ref(db, 'presentation/video'), { state: 'stop' });
    if(state.videoRenderLoop) cancelAnimationFrame(state.videoRenderLoop);

    if (type === 'note') {
        if (item.bgKey) {
            const bgMedia = state.localMediaState.find(m => m.firebaseKey === item.bgKey);
            if (bgMedia) {
                const isVideo = bgMedia.type === 'video_local';
                const typeStr = isVideo ? 'video' : 'image';
                
                // Set temporary background on Firebase ONLY, do not touch global settings!
                set(ref(db, 'presentation/background'), { state: 'play', type: typeStr, src: 'db_key:' + bgMedia.firebaseKey });
                state.tempNoteBgActive = true;
            }
        } else if (state.tempNoteBgActive) {
            // Note has no background, revert instantly
            if (state.textSettings.bgMedia) {
                set(ref(db, 'presentation/background'), { state: 'play', type: state.textSettings.bgMedia.type, src: 'db_key:' + state.textSettings.bgMedia.key });
            } else {
                set(ref(db, 'presentation/background'), { state: 'stop' });
            }
            state.tempNoteBgActive = false;
        }
        
        renderTextToCanvas(src, item.name, { 
            posX: item.posX, 
            posY: item.posY, 
            fontSize: item.fontSize, 
            bgDim: item.bgDim, 
            isNote: true, 
            isPreview: false,
            tempBgKey: item.bgKey 
        });
        return;
    }

    if (type && type.includes('image')) {
        renderImageToCanvas(src); 
        return;
    }

    const lyricsText = window.currentSongData.parts && window.currentSongData.parts[index] ? window.currentSongData.parts[index].lyrics || "" : "";
    const nameText = window.currentSongData.parts && window.currentSongData.parts[index] ? window.currentSongData.parts[index].name || "" : "";
    renderTextToCanvas(lyricsText, nameText);
};

export const toggleBlackout = () => {
    state.isBlackout = !state.isBlackout;
    updateBlackoutButton();
    
    if(state.isBlackout) { 
        if(window.updateStatus) window.updateStatus('offline');
        set(ref(db, 'presentation/video'), { state: 'stop' });
        remove(ref(db, 'presentation/drawing'));
        
        if(state.videoRenderLoop) cancelAnimationFrame(state.videoRenderLoop);
        if (typeof state.audienceWindow !== 'undefined' && state.audienceWindow && !state.audienceWindow.closed && state.audienceWindow.updateDisplay) {
            state.audienceWindow.updateDisplay('offline');
        }
        state.ctx.fillStyle = 'black'; 
        state.ctx.fillRect(0,0,1920,1080);
        broadcastFrame('firebase');
        
    } else { 
        if(window.updateStatus) window.updateStatus('online');
        if(state.currentPartIndex >= 0 && window.currentSongData && window.currentSongData.parts && window.currentSongData.parts[state.currentPartIndex]) {
            setTimeout(() => window.goLive(state.currentPartIndex), 100);
        } else {
            if (state.textSettings.bgMedia) {
                state.ctx.clearRect(0,0,1920,1080);
            } else if(state.textSettings.bgImage) {
                state.ctx.drawImage(state.textSettings.bgImage, 0, 0, 1920, 1080);
            } else {
                state.ctx.fillStyle = state.textSettings.bg;
                state.ctx.fillRect(0, 0, 1920, 1080);
            }
            broadcastFrame('all');
        }
    }
};

export function updateBlackoutButton() {
    const btn = document.getElementById('btnBlackout');
    if(!btn) return;
    btn.innerText = state.isBlackout ? "🔴 SCREEN IS OFF" : "🟢 SCREEN IS LIVE";
    // Colours come from the theme (.btn.dark / .btn.success in style.css), not inline styles
    btn.classList.toggle('dark', state.isBlackout);
    btn.classList.toggle('success', !state.isBlackout);
}

export function startTimer() { let s=0; setInterval(() => { s++; const el = document.getElementById('timer'); if(el) el.innerText = new Date(s * 1000).toISOString().substr(14, 5); }, 1000); }

export const updateCardSize = (val) => {
    const size = parseInt(val);
    state.textSettings.cardSize = size;
    const label = document.getElementById('card-size-val');
    if (label) label.innerText = size;
    const root = document.documentElement;
    root.style.setProperty('--card-height', `${size}px`);
    const previewFontSize = Math.max(8, Math.floor(size * 0.075));
    root.style.setProperty('--card-font-size', `${previewFontSize}px`);
    savePrefs();
};

export function savePrefs() {
    let safeBgMedia = null;
    if (state.textSettings.bgMedia) {
        safeBgMedia = { 
            type: state.textSettings.bgMedia.type, 
            key: state.textSettings.bgMedia.key 
        };
    }

    const toSave = { 
        size: state.textSettings.size, 
        align: state.textSettings.align, 
        font: state.textSettings.font, 
        color: state.textSettings.color, 
        bg: state.textSettings.bg, 
        cardSize: state.textSettings.cardSize,
        bgMedia: safeBgMedia 
    };
    
    try {
        localStorage.setItem(state.PREFS_KEY, JSON.stringify(toSave));
    } catch(e) {
        console.warn("Storage full! Auto-clearing corrupted memory...", e);
        localStorage.removeItem(state.PREFS_KEY);
        try { localStorage.setItem(state.PREFS_KEY, JSON.stringify(toSave)); } catch(err) {}
    }
}

export const updateFontSize = (val) => { 
    state.textSettings.size = parseInt(val); document.getElementById('size-val').innerText = val; savePrefs();
    if(state.currentPartIndex >= 0 && window.goLive) window.goLive(state.currentPartIndex); 
};

export const setTextAlign = (align) => {
    state.textSettings.align = align; document.getElementById('btnAlignLeft').classList.toggle('active', align === 'left');
    document.getElementById('btnAlignCenter').classList.toggle('active', align === 'center'); savePrefs(); 
    if(state.currentPartIndex >= 0 && window.goLive) window.goLive(state.currentPartIndex);
};

export const updateFont = (font) => { state.textSettings.font = font; savePrefs(); if(state.currentPartIndex >= 0 && window.goLive) window.goLive(state.currentPartIndex); };

export const setBgColor = (color, el) => {
    state.textSettings.bgImage = null; 
    state.textSettings.bgMedia = null; 
    state.textSettings.bg = color;
    document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
    el.classList.add('active'); state.textSettings.color = color === 'white' ? 'black' : 'white'; savePrefs();
    
    set(ref(db, 'presentation/background'), { state: 'stop' });

    if(state.currentPartIndex >= 0 && window.goLive) window.goLive(state.currentPartIndex);
};

export const uploadBgImage = async (input) => {
    alert("Please use the 'Add Local Files' button in your library, then click 'SET BG' on the thumbnail!");
    input.value = "";
};

export const clearBgImage = () => {
    state.textSettings.bgImage = null; 
    state.textSettings.bgMedia = null; 
    state.textSettings.bg = 'black';
    document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
    const blackDot = document.querySelector('.color-dot[onclick*="black"]'); if(blackDot) blackDot.classList.add('active');
    const fileInput = document.getElementById('fileInput'); if(fileInput) fileInput.value = "";
    savePrefs(); 
    
    set(ref(db, 'presentation/background'), { state: 'stop' }); 

    if(state.currentPartIndex >= 0 && window.goLive) window.goLive(state.currentPartIndex);
    else { state.ctx.fillStyle = 'black'; state.ctx.fillRect(0,0,1920,1080); broadcastFrame('all'); }
};

export const loadPrefs = () => {
    const saved = localStorage.getItem(state.PREFS_KEY);
    
    // --- 1. SET THE DEFAULT FALLBACK ---
    let userFont = "'Roboto', sans-serif"; 

    if(saved) {
        try {
            const parsed = JSON.parse(saved);
            if(parsed.size) state.textSettings.size = parsed.size;
            if(parsed.align) state.textSettings.align = parsed.align;
            
            // 2. IF A SAVED FONT EXISTS, OVERWRITE ROBOTO
            if(parsed.font) {
                userFont = parsed.font;
            }
            
            if(parsed.color) state.textSettings.color = parsed.color;
            if(parsed.bg) state.textSettings.bg = parsed.bg;
            if(document.getElementById('size-val')) document.getElementById('size-val').innerText = state.textSettings.size;
            const sizeSlider = document.getElementById('font-size-slider');
            if(sizeSlider) sizeSlider.value = state.textSettings.size;
            
            if(document.getElementById('btnAlignLeft')) document.getElementById('btnAlignLeft').classList.toggle('active', state.textSettings.align === 'left');
            if(document.getElementById('btnAlignCenter')) document.getElementById('btnAlignCenter').classList.toggle('active', state.textSettings.align === 'center');
            if(parsed.cardSize) { updateCardSize(parsed.cardSize); const slider = document.getElementById('card-size-slider'); if(slider) slider.value = parsed.cardSize; }
            
            if(parsed.bgMedia) {
                state.textSettings.bgMedia = parsed.bgMedia;
                set(ref(db, 'presentation/background'), {
                    state: 'play',
                    type: parsed.bgMedia.type,
                    src: 'db_key:' + parsed.bgMedia.key
                });
            }

            // Match the saved colour to a swatch by computed colour ('black', '#000000' and
            // 'rgb(0, 0, 0)' are all the same swatch). No swatch is active while a media background is set.
            const toRgb = (c) => { const t = document.createElement('span'); t.style.color = c; document.body.appendChild(t); const v = getComputedStyle(t).color; t.remove(); return v; };
            const wanted = state.textSettings.bgMedia ? null : toRgb(state.textSettings.bg);
            document.querySelectorAll('.color-dot').forEach(d => {
                d.classList.toggle('active', wanted !== null && getComputedStyle(d).backgroundColor === wanted);
            });
        } catch(e) {}
    }
    
// --- 3. APPLY THE FINAL FONT (Saved or Default) ---
    state.textSettings.font = userFont;
    
    const fontDropdown = document.getElementById('fontFamily');
    if(fontDropdown) {
        // Try to set the dropdown to the user's saved font
        fontDropdown.value = userFont;
        
        // SAFETY CATCH: If the box goes blank (because of an old corrupted memory), force it to Roboto!
        if(!fontDropdown.value) { 
            fontDropdown.value = "'Roboto', sans-serif";
            state.textSettings.font = "'Roboto', sans-serif";
            // Clean up the bad memory
            savePrefs(); 
        }
    }
};

export const navigatePart = (d) => { 
    if(window.currentSongData && window.currentSongData.parts) {
        const nextIdx = state.currentPartIndex + d;
        if (nextIdx >= 0 && nextIdx < window.currentSongData.parts.length) {
            if(window.goLive) window.goLive(nextIdx); 
        }
    } 
};

export const showNotification = (t) => {
    const n = document.getElementById('song-notification-toast');
    if (!n) return;
    n.textContent = t;                       // textContent: file names etc. can never inject HTML
    n.classList.add('show');
    clearTimeout(n._hideTimer);              // a newer toast restarts the timer instead of being cut short
    n._hideTimer = setTimeout(() => n.classList.remove('show'), 3000);
};
export const acknowledgeMessage = () => { set(ref(db, 'presentation/ack'), { timestamp: Date.now(), text: "Acknowledged" }); remove(ref(db, 'presentation/message')); };

export const controlVideo = (action, value) => { 
    if(state.audienceWindow && state.audienceWindow.videoControl) state.audienceWindow.videoControl(action, value);
    const safeTime = value !== undefined ? value : 0; 
    if (action === 'seek' || action === 'play' || action === 'pause' || action === 'stop') {
        update(ref(db, 'presentation/video'), { state: action, time: safeTime });
    }
};

export function startVideoSync() { 
    if(state.videoSyncTimer) clearInterval(state.videoSyncTimer);
    state.videoSyncTimer = setInterval(() => { 
        if(state.audienceWindow && state.audienceWindow.videoControl) { 
            const s = state.audienceWindow.videoControl('status'); 
            if(s && document.getElementById('video-seeker')) document.getElementById('video-seeker').value = s.time; 
        } 
    }, 500);
}

export const switchView = function(mode) {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + mode).classList.add('active');
    
    document.getElementById('view-presenter').style.display = 'none';
    document.getElementById('view-editor').style.display = 'none';
    document.getElementById('view-library').style.display = 'none';

    if(mode === 'presenter') { document.getElementById('view-presenter').style.display = 'flex'; } 
    else if (mode === 'editor') {
        document.getElementById('view-editor').style.display = 'flex';
        if(document.getElementById('editor-song-list').children.length === 0) { if(window.loadEditorSongList) window.loadEditorSongList(); }
    } else if (mode === 'library') {
        document.getElementById('view-library').style.display = 'flex';
        if(window.refreshLibraryDrive) window.refreshLibraryDrive();
    }
};

export const loadLiveSongFromMemory = (s, el) => { 
    document.querySelectorAll('.song-item').forEach(i => i.classList.remove('active')); 
    if(el) el.classList.add('active'); 
    state.currentPartIndex = -1;
    window.currentSongData = { type: 'song', name: s.title, parts: s.parts || [] }; 
    
    const titleLabel = document.getElementById('current-song-title');
    if (titleLabel) titleLabel.innerText = s.title;

    if(window.renderLyricsGrid) window.renderLyricsGrid(); 
};

export const loadLiveSongs = () => {
    if (typeof renderHybridSidebar === 'function') { renderHybridSidebar(); if(window.showNotification) window.showNotification("Library Refreshed"); }
};

export function getAudienceTemplate() {
    return `<!DOCTYPE html><html lang="en"><body><h1>Audience Window Mode</h1></body></html>`;
}

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // don't hijack Ctrl+C / Ctrl+R / Alt shortcuts

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault(); navigatePart(1); return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault(); navigatePart(-1); return;
    }

    if (!window.currentSongData || !window.currentSongData.parts) return;
    
    const keyMap = { 'v': 'verse', 'c': 'chorus', 'b': 'bridge', 'p': 'pre-chorus', 'i': 'intro', 'o': 'outro', 'e': 'outro', 't': 'tag', 'r': 'refrain' };
    const searchType = keyMap[e.key.toLowerCase()];
    const parts = window.currentSongData.parts;

    if (searchType) {
        let matchIndices = [];
        parts.forEach((p, idx) => { if (p.name && p.name.toLowerCase().includes(searchType)) matchIndices.push(idx); });
        if (matchIndices.length > 0) {
            let nextIndex = matchIndices.find(idx => idx > state.currentPartIndex);
            if (nextIndex === undefined) nextIndex = matchIndices[0]; 
            if (window.goLive) window.goLive(nextIndex);
        }
    }

    if (e.key >= '1' && e.key <= '9') {
        let matchIndex = parts.findIndex(p => p.name && p.name.includes(e.key));
        if (matchIndex !== -1 && window.goLive) window.goLive(matchIndex);
    }
});

// ==========================================
// --- GALLERY GRID SEARCH & DRAG ENGINE ---
// ==========================================

export const filterGallery = () => {
    const term = document.getElementById('gallery-search').value.toLowerCase();
    document.querySelectorAll('#lyrics-grid .lyric-card.is-local').forEach(card => {
        const label = card.querySelector('.card-label').innerText.toLowerCase();
        card.style.display = label.includes(term) ? '' : 'none';
    });
};
window.filterGallery = filterGallery;

setTimeout(() => {
    const gridContainer = document.getElementById('lyrics-grid');
    if(gridContainer) {
        gridContainer.addEventListener('dragover', function(e) {
            if (!state.draggedGalleryItem) return;
            e.preventDefault();
            const afterElement = getGalleryDragAfterElement(gridContainer, e.clientX, e.clientY);
            if (afterElement == null) {
                gridContainer.appendChild(state.draggedGalleryItem);
            } else {
                gridContainer.insertBefore(state.draggedGalleryItem, afterElement);
            }
        });
    }
}, 1000);

export function getGalleryDragAfterElement(container, x, y) {
    const draggableElements = [...container.querySelectorAll('.lyric-card.is-local:not(.dragging-gallery)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const centerX = box.left + box.width / 2;
        if (y > box.top - 20 && y < box.bottom + 20) { 
            const offset = x - centerX;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            }
        }
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

export function saveGalleryOrder() {
    const items = document.querySelectorAll('#lyrics-grid .lyric-card.is-local');
    const updates = {};
    items.forEach((item, index) => {
        const key = item.dataset.firebaseKey;
        if(key) updates['permanent_local_media/' + key + '/order'] = index;
    });
    update(ref(db), updates).then(() => {
        if(window.showNotification) window.showNotification("Gallery Order Saved 💾");
    }).catch(e => console.error(e));
}
window.saveGalleryOrder = saveGalleryOrder;


// ==========================================
// --- EDITABLE BIG NOTE ENGINE ---
// ==========================================

export const previewBigNote = () => {
    const name = document.getElementById('note-title').value.trim() || "Preview Title";
    const text = document.getElementById('note-text').value.trim() || "Type your note to preview...";
    const posX = parseInt(document.getElementById('note-x').value);
    const posY = parseInt(document.getElementById('note-y').value);
    const fontSize = parseInt(document.getElementById('note-size').value);
    const bgDim = parseInt(document.getElementById('note-dim').value);
    const bgKey = document.getElementById('note-bg').value;
    
    // Passing tempBgKey purely to the engine. Global state is completely untouched!
    renderTextToCanvas(text, name, { posX: posX, posY: posY, fontSize: fontSize, bgDim: bgDim, isPreview: true, isNote: true, tempBgKey: bgKey });
};
window.previewBigNote = previewBigNote;

export const openNoteEditor = (key = null) => {
    const modal = document.getElementById('note-modal');
    const bgSelect = document.getElementById('note-bg');
    
    if (!modal) {
        alert("The editor interface is missing from your HTML file. Please add the HTML modal first!");
        return;
    }
    
    bgSelect.innerHTML = '<option value="">-- None (Use Global Background) --</option>';
    state.localMediaState.forEach(media => {
        if (media.type === 'image_local' || media.type === 'video_local') {
            const opt = document.createElement('option');
            opt.value = media.firebaseKey;
            opt.text = media.name;
            bgSelect.appendChild(opt);
        }
    });

    if (typeof key === 'string' && key.startsWith('-')) {
        const note = state.localMediaState.find(m => m.firebaseKey === key);
        if (note) {
            document.getElementById('note-modal-title').innerText = "Edit Big Note";
            document.getElementById('note-id').value = key;
            document.getElementById('note-title').value = note.name || "";
            document.getElementById('note-text').value = note.src || "";
            document.getElementById('note-bg').value = note.bgKey || "";
            document.getElementById('note-x').value = note.posX !== undefined ? note.posX : 50;
            document.getElementById('note-y').value = note.posY !== undefined ? note.posY : 50;
            document.getElementById('note-x-val').innerText = document.getElementById('note-x').value;
            document.getElementById('note-y-val').innerText = document.getElementById('note-y').value;
            
            document.getElementById('note-size').value = note.fontSize !== undefined ? note.fontSize : 95;
            document.getElementById('note-dim').value = note.bgDim !== undefined ? note.bgDim : 40;
            document.getElementById('note-size-val').innerText = document.getElementById('note-size').value;
            document.getElementById('note-dim-val').innerText = document.getElementById('note-dim').value;
        }
    } else {
        document.getElementById('note-modal-title').innerText = "Create Big Note";
        document.getElementById('note-id').value = "";
        document.getElementById('note-title').value = "";
        document.getElementById('note-text').value = "";
        document.getElementById('note-bg').value = "";
        document.getElementById('note-x').value = 50;
        document.getElementById('note-y').value = 50;
        document.getElementById('note-x-val').innerText = 50;
        document.getElementById('note-y-val').innerText = 50;
        
        document.getElementById('note-size').value = 95;
        document.getElementById('note-dim').value = 40;
        document.getElementById('note-size-val').innerText = 95;
        document.getElementById('note-dim-val').innerText = 40;
    }
    
    modal.style.display = 'flex';
    setTimeout(previewBigNote, 100);
};
window.openNoteEditor = openNoteEditor;

export const saveBigNote = async () => {
    const key = document.getElementById('note-id').value;
    const name = document.getElementById('note-title').value.trim();
    const text = document.getElementById('note-text').value.trim();
    const bgKey = document.getElementById('note-bg').value;
    const posX = parseInt(document.getElementById('note-x').value);
    const posY = parseInt(document.getElementById('note-y').value);
    const fontSize = parseInt(document.getElementById('note-size').value);
    const bgDim = parseInt(document.getElementById('note-dim').value);

    if (!name || !text) { alert("Title and Note Text are required."); return; }

    if(window.showNotification) window.showNotification("Saving Note... 💾");
    try {
        const payload = {
            name: name,
            type: 'note',
            src: text,
            bgKey: bgKey,
            posX: posX,
            posY: posY,
            fontSize: fontSize,
            bgDim: bgDim,
            timestamp: Date.now()
        };

        if (key) {
            const existing = state.localMediaState.find(m => m.firebaseKey === key);
            if (existing && existing.order !== undefined) payload.order = existing.order;
            await update(ref(db, `permanent_local_media/${key}`), payload);
        } else {
            await push(ref(db, 'permanent_local_media'), payload);
        }
        
        document.getElementById('note-modal').style.display = 'none';
        if(window.showNotification) window.showNotification("✅ Note Saved!");
    } catch (error) {
        console.error("Firebase Write Error:", error);
        alert("Failed to save Note.");
    }
};
window.saveBigNote = saveBigNote;