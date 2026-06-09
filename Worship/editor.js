import { getDatabase, ref, onValue, set, remove, get, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const db = getDatabase();

// --- 1. HELPER FUNCTIONS ---
function createPartElement(nameValue = "", lyricsValue = "") {
    const div = document.createElement('div');
    div.className = 'part-box';
    div.innerHTML = `
        <div class="drag-handle" title="Drag to reorder">☰</div>
        <div class="part-controls">
            <input type="text" class="part-name" list="section-types" placeholder="Section" value="${nameValue}">
            <div class="control-row">
                <button class="icon-btn" onclick="moveUp(this)">👆</button>
                <button class="icon-btn" onclick="moveDown(this)">👇</button>
                <button class="icon-btn" style="color:#059669;" onclick="duplicatePart(this)">📑</button>
                <button class="icon-btn" style="color:#ef4444;" onclick="this.closest('.part-box').remove()">X</button>
            </div>
        </div>
        <div class="preview-container"><div class="lyrics-wrapper"><textarea class="part-lyrics slide-input">${lyricsValue}</textarea></div></div>`;
    addDragEvents(div);
    return div;
}

function populateEditor(data) { 
    document.getElementById('edit-title').value = data.title || "";
    document.getElementById('edit-author').value = data.author || "";
    document.getElementById('overwrite').checked = true;
    document.getElementById('parts-container').innerHTML = '';
    
    if (data.parts && data.parts.length > 0) {
        data.parts.forEach(part => window.addPart(part.name, part.lyrics));
    } else {
        window.addPart();
    }
}

// --- 2. MAIN WINDOW FUNCTIONS ---
let currentEditingId = null; 

window.createNewSong = () => {
    currentEditingId = null; 
    document.getElementById('edit-title').value = "";
    document.getElementById('edit-author').value = "";
    document.getElementById('overwrite').checked = false;
    document.getElementById('parts-container').innerHTML = '';
    document.getElementById('statusMsg').innerText = "";
    document.querySelectorAll('#editor-song-list .song-item').forEach(i => i.classList.remove('active'));
    window.addPart();
};

window.loadEditorSongList = () => {
    const loader = document.getElementById('editorListLoader');
    const listContainer = document.getElementById('editor-song-list');
    
    if(loader) loader.style.display = 'block';
    
    // Listen to the master archive
    const archiveRef = ref(db, 'song_archive');
    onValue(archiveRef, (snapshot) => {
        if(!listContainer) return;
        listContainer.innerHTML = '';
        const data = snapshot.val();
        
        if (data) {
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
                const songId = song.id; // Extract the ID we saved earlier
                const div = document.createElement('div');
                div.className = 'song-item'; 
                
                // Add a visual green dot if the song is currently live!
                const liveStatus = song.isLive ? '🟢 ' : '';
                div.innerText = liveStatus + (song.title || "Untitled Song");
                div.dataset.search = (song.title || "").toLowerCase();
                
                div.onclick = () => {
                    document.querySelectorAll('#editor-song-list .song-item').forEach(el => el.classList.remove('active'));
                    div.classList.add('active');
                    currentEditingId = songId; 
                    populateEditor(song); 
                };
                
                listContainer.appendChild(div);
            });
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
    document.getElementById('parts-container').appendChild(createPartElement(nameValue, lyricsValue));
};

// --- 3. UI INTERACTION HELPERS ---
window.duplicatePart = function(btn) {
    const originalBox = btn.closest('.part-box');
    const newBox = createPartElement(originalBox.querySelector('.part-name').value, originalBox.querySelector('.part-lyrics').value);
    if (originalBox.nextElementSibling) originalBox.parentNode.insertBefore(newBox, originalBox.nextElementSibling);
    else originalBox.parentNode.appendChild(newBox);
};

window.moveUp = function(btn) { 
    const box = btn.closest('.part-box'); 
    if (box.previousElementSibling) box.parentNode.insertBefore(box, box.previousElementSibling); 
};

window.moveDown = function(btn) { 
    const box = btn.closest('.part-box'); 
    if (box.nextElementSibling) box.parentNode.insertBefore(box.nextElementSibling, box); 
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

    if (!title) { 
        msg.innerText = "⚠️ Please enter a Song Title"; 
        msg.className = "status-error"; 
        return;
    }

    const parts = [];
    document.querySelectorAll('.part-box').forEach(box => {
        parts.push({ name: box.querySelector('.part-name').value || "Slide", lyrics: box.querySelector('.part-lyrics').value });
    });

    const safeKey = title.replace(/[.#$\[\]]/g, "_"); 

    btnText.innerText = "Saving Master Copy...";
    if(spinner) spinner.style.display = "inline-block"; 
    msg.innerText = "";

    try {
        // 🎯 THE FIX: Precisely preserve the Live Status AND the Arrangement Order!
        let isLive = false;
        let order = Date.now(); 
        if (currentEditingId) {
            const snap = await get(ref(db, 'song_archive/' + currentEditingId));
            if (snap.exists()) {
                isLive = snap.val().isLive || false;
                order = snap.val().order !== undefined ? snap.val().order : Date.now();
            }
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
        btnText.innerText = "Save Song"; 

    } catch (error) { 
        btnText.innerText = "Save Song";
        msg.innerText = "❌ Error: " + error.message; 
        msg.className = "status-error"; 
    }
    if(spinner) spinner.style.display = "none";
};

// Start the list
window.loadEditorSongList();