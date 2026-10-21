import { getDatabase, ref, onValue, set, remove, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const db = getDatabase();

// --- 1. HELPER FUNCTIONS ---

// Brief highlight so you can see which slide just moved / was duplicated (animation lives in style.css)
function flash(box) {
    box.classList.remove('part-flash');
    void box.offsetWidth; // restart the animation if it is already running
    box.classList.add('part-flash');
    setTimeout(() => box.classList.remove('part-flash'), 700);
}

function createPartElement(nameValue = "", lyricsValue = "") {
    const div = document.createElement('div');
    div.className = 'part-box';
    // Static markup only. The song's own text is assigned through .value below and is never spliced
    // into HTML, so quotes, "<", "&" or "</textarea>" in a title/lyric can't corrupt the slide.
    div.innerHTML = `
        <div class="drag-handle" title="Drag to reorder">☰</div>
        <div class="part-controls">
            <input type="text" class="part-name" list="section-types" placeholder="Section">
            <div class="control-row">
                <button type="button" class="icon-btn move-up" title="Move up">👆</button>
                <button type="button" class="icon-btn move-down" title="Move down">👇</button>
                <button type="button" class="icon-btn dup" title="Duplicate slide">📑</button>
                <button type="button" class="icon-btn del" title="Delete slide">X</button>
            </div>
        </div>
        <div class="preview-container"><div class="lyrics-wrapper"><textarea class="part-lyrics slide-input" placeholder="Type the lyrics for this slide…"></textarea></div></div>`;

    div.querySelector('.part-name').value = nameValue;
    div.querySelector('.part-lyrics').value = lyricsValue;

    div.querySelector('.move-up').addEventListener('click', (e) => window.moveUp(e.currentTarget));
    div.querySelector('.move-down').addEventListener('click', (e) => window.moveDown(e.currentTarget));
    div.querySelector('.dup').addEventListener('click', (e) => window.duplicatePart(e.currentTarget));
    div.querySelector('.del').addEventListener('click', () => div.remove());

    addDragEvents(div);
    return div;
}

// Adds a slide to the editor. Only the "+ Add New Slide" button asks for focus + scroll.
function appendPart(nameValue = "", lyricsValue = "", focus = false) {
    const box = createPartElement(nameValue, lyricsValue);
    document.getElementById('parts-container').appendChild(box);
    if (focus) {
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        box.querySelector('.part-name').focus({ preventScroll: true });
    }
    return box;
}

function populateEditor(data) {
    document.getElementById('edit-title').value = data.title || "";
    document.getElementById('edit-author').value = data.author || "";
    document.getElementById('overwrite').checked = true;
    document.getElementById('statusMsg').innerText = ""; // don't carry the last song's "Saved!" over
    document.getElementById('parts-container').innerHTML = '';

    if (data.parts && data.parts.length > 0) {
        data.parts.forEach(part => appendPart(part.name, part.lyrics));
    } else {
        appendPart();
    }
}

// --- 2. MAIN WINDOW FUNCTIONS ---
let currentEditingId = null;
let unsubscribeSongList = null; // so "Sync Drive" re-subscribes instead of stacking listeners

window.createNewSong = () => {
    currentEditingId = null;
    document.getElementById('edit-title').value = "";
    document.getElementById('edit-author').value = "";
    document.getElementById('overwrite').checked = false;
    document.getElementById('parts-container').innerHTML = '';
    document.getElementById('statusMsg').innerText = "";
    document.querySelectorAll('#editor-song-list .song-item').forEach(i => i.classList.remove('active'));
    appendPart();
    document.getElementById('edit-title').focus();
};

// Draws the archive list (styled by .song-item / .status-dot in style.css)
function renderSongList(snapshot) {
    const listContainer = document.getElementById('editor-song-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    const data = snapshot.val();

    if (data && Object.keys(data).length > 0) {
        // 1. Convert the Firebase object into an array so we can sort it
        const songArray = Object.keys(data).map(key => {
            return { id: key, ...data[key] };
        });

        // 2. THE ADVANCED SORTING ENGINE
        songArray.sort((a, b) => {
            // Priority 1: Published (Live) songs always go to the very top
            if (a.isLive && !b.isLive) return -1;
            if (!a.isLive && b.isLive) return 1;

            // Priority 2: If both are Live, or both are Archive, sort by newest modified
            const timeA = a.timestamp || 0;
            const timeB = b.timestamp || 0;
            return timeB - timeA; // Highest timestamp (newest) floats to the top
        });

        // 3. Render the newly sorted list
        songArray.forEach(song => {
            const songId = song.id;
            const title = song.title || "Untitled Song";

            const div = document.createElement('div');
            // The list is rebuilt on every database change (e.g. right after you save),
            // so keep the open song highlighted.
            div.className = 'song-item' + (songId === currentEditingId ? ' active' : '');
            div.dataset.search = (song.title || "").toLowerCase();

            const dot = document.createElement('span');
            dot.className = 'status-dot' + (song.isLive ? ' live' : '');
            dot.title = song.isLive ? 'Live' : 'Not live';

            const name = document.createElement('span');
            name.className = 'song-name';
            name.textContent = title;   // text, never HTML
            name.title = title;

            div.append(dot, name);

            div.onclick = () => {
                document.querySelectorAll('#editor-song-list .song-item').forEach(el => el.classList.remove('active'));
                div.classList.add('active');
                currentEditingId = songId;
                populateEditor(song);
            };

            listContainer.appendChild(div);
        });
    } else {
        const empty = document.createElement('div');
        empty.className = 'lib-empty';
        empty.textContent = 'No songs in the archive yet. Click New to write one.';
        listContainer.appendChild(empty);
    }

    // keep an active search filter applied after a rebuild
    if (window.filterEditorList) window.filterEditorList();
}

window.loadEditorSongList = () => {
    const loader = document.getElementById('editorListLoader');

    if(loader) loader.style.display = 'block';

    // Calling this again (Sync Drive) used to add another listener each time; replace the old one.
    if (unsubscribeSongList) { unsubscribeSongList(); unsubscribeSongList = null; }

    // Listen to the master archive
    const archiveRef = ref(db, 'song_archive');
    unsubscribeSongList = onValue(archiveRef, (snapshot) => {
        renderSongList(snapshot);
        if(loader) loader.style.display = 'none';
    }, (error) => {
        const listContainer = document.getElementById('editor-song-list');
        if (listContainer) {
            listContainer.innerHTML = '';
            const msg = document.createElement('div');
            msg.className = 'lib-empty error';
            msg.textContent = "Couldn't load the archive: " + error.message;
            listContainer.appendChild(msg);
        }
        if(loader) loader.style.display = 'none';
    });
};

window.filterEditorList = () => {
    const input = document.getElementById('editorSearch');
    if (!input) return;
    const term = input.value.toLowerCase();
    const items = document.querySelectorAll('#editor-song-list .song-item');
    items.forEach(item => {
        const text = item.dataset.search || item.innerText.toLowerCase();

        // 🎯 THE FIX: Using '' (empty string) instead of 'block'
        // This flawlessly restores your original CSS layout without breaking it!
        item.style.display = text.includes(term) ? '' : 'none';
    });
};

window.addPart = function(nameValue = "", lyricsValue = "") {
    appendPart(nameValue, lyricsValue, true);
};

// --- 3. UI INTERACTION HELPERS ---
window.duplicatePart = function(btn) {
    const originalBox = btn.closest('.part-box');
    const newBox = createPartElement(originalBox.querySelector('.part-name').value, originalBox.querySelector('.part-lyrics').value);
    if (originalBox.nextElementSibling) originalBox.parentNode.insertBefore(newBox, originalBox.nextElementSibling);
    else originalBox.parentNode.appendChild(newBox);
    flash(newBox);
};

window.moveUp = function(btn) {
    const box = btn.closest('.part-box');
    if (box.previousElementSibling) { box.parentNode.insertBefore(box, box.previousElementSibling); flash(box); }
};

window.moveDown = function(btn) {
    const box = btn.closest('.part-box');
    if (box.nextElementSibling) { box.parentNode.insertBefore(box.nextElementSibling, box); flash(box); }
};

// --- 4. DRAG AND DROP LOGIC ---
let draggedItem = null;
function addDragEvents(item) {
    item.draggable = false;
    const handle = item.querySelector('.drag-handle');
    handle.addEventListener('mousedown', () => { item.draggable = true; });
    handle.addEventListener('mouseup', () => { item.draggable = false; });
    item.addEventListener('dragstart', function(e) { draggedItem = item; setTimeout(() => item.classList.add('dragging'), 0); });
    item.addEventListener('dragend', function() { setTimeout(() => item.classList.remove('dragging'), 0); draggedItem = null; item.draggable = false; });
}

const partsContainer = document.getElementById('parts-container');
if(partsContainer) {
    partsContainer.addEventListener('dragover', function(e) {
        e.preventDefault();
        const afterElement = [...this.querySelectorAll('.part-box:not(.dragging)')].reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = e.clientY - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
            else return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
        if (draggedItem) afterElement == null ? this.appendChild(draggedItem) : this.insertBefore(draggedItem, afterElement);
    });
}

// --- 5. SAVE FUNCTION (MASTER LIBRARY) ---
window.saveToDrive = async function() {
    const title = document.getElementById('edit-title').value.trim();
    const author = document.getElementById('edit-author').value.trim();
    const msg = document.getElementById('statusMsg');
    const btnText = document.getElementById('btnText');
    const spinner = document.getElementById('spinner');
    const overwrite = document.getElementById('overwrite');
    const saveBtn = btnText.closest('button');

    if (!title) {
        msg.innerText = "⚠️ Please enter a Song Title";
        msg.className = "status-error";
        return;
    }

    const parts = [];
    document.querySelectorAll('.part-box').forEach(box => {
        parts.push({ name: box.querySelector('.part-name').value || "Slide", lyrics: box.querySelector('.part-lyrics').value });
    });

    // Firebase keys can't contain . # $ [ ] or "/" (a "/" would silently nest the song, e.g. "AC/DC")
    const safeKey = title.replace(/[.#$\[\]\/]/g, "_");

    // Remember the button's normal label so it always goes back to it (it used to turn into "Save Song")
    if (!btnText.dataset.label) btnText.dataset.label = btnText.innerText;
    const idleLabel = btnText.dataset.label;

    btnText.innerText = "Saving Master Copy...";
    if(spinner) spinner.style.display = "inline-block";
    if(saveBtn) saveBtn.disabled = true; // no double-saves while a write is in flight
    msg.innerText = "";

    try {
        // The "Overwrite if file exists" box used to be ignored. Now an untick really protects an existing song.
        if (safeKey !== currentEditingId && overwrite && !overwrite.checked) {
            const clash = await get(ref(db, 'song_archive/' + safeKey));
            if (clash.exists()) {
                msg.innerText = '⚠️ A song with this title already exists. Tick "Overwrite if file exists" to replace it.';
                msg.className = "status-error";
                return; // the finally block restores the button
            }
        }

        // 🎯 THE FIX: Precisely preserve the Live Status AND the Arrangement Order!
        let isLive = false;
        let order = Date.now();
        const sourceId = currentEditingId || safeKey; // overwriting an existing song keeps its live status too
        const snap = await get(ref(db, 'song_archive/' + sourceId));
        if (snap.exists()) {
            isLive = snap.val().isLive || false;
            order = snap.val().order !== undefined ? snap.val().order : Date.now();
        }

        const songData = { title, author, parts, timestamp: Date.now(), isLive, order };

        // Save to master node
        await set(ref(db, 'song_archive/' + safeKey), songData);

        // Cleanup if the title (ID) was changed so we don't get duplicates
        if (currentEditingId && currentEditingId !== safeKey) {
            await remove(ref(db, 'song_archive/' + currentEditingId));
        }

        currentEditingId = safeKey;

        msg.innerText = "✅ Song Saved to Library!";
        msg.className = "status-success";

    } catch (error) {
        msg.innerText = "❌ Error: " + error.message;
        msg.className = "status-error";
    } finally {
        btnText.innerText = idleLabel;
        if(spinner) spinner.style.display = "none";
        if(saveBtn) saveBtn.disabled = false;
    }
};

// Start the list
window.loadEditorSongList();
