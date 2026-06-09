import { state } from './state.js';
import { db } from '../firebase-config.js';
import { ref, set, remove, push, get, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { renderHybridSidebar } from './ui.js';

/**
 * Handles local file selection, converts to Base64, and saves to RTDB permanently.
 * Enforces a 7.5MB limit to stay within the Spark 10MB write quota.
 */
export const handleLocalMedia = (input) => {
    if (!input.files) return;

    // 7.5MB raw limit + Base64 overhead (~33%) = ~10MB (Firebase Hard Limit)
    const MAX_SAFE_SIZE = 7.5 * 1024 * 1024; 
    const files = Array.from(input.files);

    files.forEach(file => {
        if (file.size > MAX_SAFE_SIZE) {
            alert(`⚠️ "${file.name}" is too large. RTDB on Spark limits uploads to ~10MB. Please keep raw files under 7.5MB.`);
            return;
        }

        window.showNotification(`Saving ${file.name} permanently... 💾`);

        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64Data = e.target.result;
            const fileType = file.type.startsWith('video/') ? 'video_local' : 'image_local';
            
            try {
                // Save to the permanent cloud node
                const localMediaRef = ref(db, 'permanent_local_media');
                await push(localMediaRef, {
                    name: file.name,
                    type: fileType,
                    src: base64Data, // Stored as Base64 string
                    timestamp: Date.now()
                });
                window.showNotification("✅ Saved successfully!");
            } catch (error) {
                console.error("Firebase Write Error:", error);
                alert("Upload failed. The file might still be too large for the 10MB limit.");
            }
        };
        reader.readAsDataURL(file);
    });
    input.value = ""; 
};

/**
 * Removes a file permanently from the database.
 */
export const removeLocalFile = async (firebaseKey, e) => {
    if (e) e.stopPropagation();
    if (!confirm("Permanently delete this file from the cloud?")) return;

    try {
        await remove(ref(db, `permanent_local_media/${firebaseKey}`));
        window.showNotification("File deleted 🗑️");
    } catch (error) {
        console.error("Delete failed:", error);
    }
};

/**
 * Standard media loading logic (Local Caching)
 */
export async function loadDriveImageToCanvas(id, name, itemElement) {
    document.querySelectorAll('#song-list .song-item').forEach(i => i.classList.remove('active'));
    if(itemElement) itemElement.classList.add('active');
    
    state.currentPartIndex = -1;

    if (name.match(/\.(mp4|webm|mov)$/i)) {
        if(window.showNotification) window.showNotification("Downloading Video...");
        try {
            const r = await fetch(`https://drive.google.com/uc?export=download&id=${id}`);
            const blob = await r.blob();
            state.localMediaState.push({ 
                name: "☁️ " + name, 
                type: 'video_local', 
                src: URL.createObjectURL(blob), 
                filename: name 
            });
            if(window.openLocalMediaGallery) window.openLocalMediaGallery(); 
            renderHybridSidebar();
        } catch(e) { alert("Download Failed"); }
        return;
    }

    const cacheKey = "media_cache_" + id;
    const cachedData = localStorage.getItem(cacheKey);

    if (cachedData) {
        console.log("🚀 Loading from Local Cache:", name);
        processImageData(cachedData, name);
        if(window.showNotification) window.showNotification("Loaded from Cache ⚡");
        return;
    }

    if(window.showNotification) window.showNotification("Downloading Image...");
    try {
        const res = await fetch(state.APPS_SCRIPT_URL + "?action=getContent&id=" + id);
        const json = await res.json();

        if(json.ok && json.data) {
            let base64 = json.data;
            if(!base64.startsWith('data:image')) base64 = "data:image/jpeg;base64," + base64;
            
            try { localStorage.setItem(cacheKey, base64); } catch (e) { console.warn("Cache full or error", e); }
            
            processImageData(base64, name);
            if(window.showNotification) window.showNotification("Image Downloaded 🖼️");
        }
    } catch(e) { 
        console.error(e);
        if(window.showNotification) window.showNotification("Error Loading Image");
    }
}

export function processImageData(base64, name) {
    window.currentSongData = { 
        type: 'image_local', 
        name: name, 
        src: base64,
        parts: [{ name: 'CLOUD IMAGE', lyrics: 'Projected from Google Drive' }]
    };
    if(window.renderLyricsGrid) window.renderLyricsGrid();
}

export const openLocalMediaGallery = (el) => {
    document.querySelectorAll('#song-list .song-item').forEach(i => i.classList.remove('active'));
    if(el) el.classList.add('active');
    
    state.currentPartIndex = -1;
    if(document.getElementById('current-song-title')) {
        document.getElementById('current-song-title').innerText = `Local Gallery (${state.localMediaState.length})`;
    }

    window.currentSongData = { type: 'local_set', title: '📂 Local Media', parts: state.localMediaState };
    if(window.renderLyricsGrid) window.renderLyricsGrid();
};

export const fetchDriveImages = async () => { 
    try { 
        const r = await fetch(state.APPS_SCRIPT_URL + "?action=list&t=" + Date.now());
        const d = await r.json(); 
        if(d.files) { 
            state.driveImagesState = d.files.filter(f => f.name.match(/\.(jpg|png|mp4)$/i)); 
            renderHybridSidebar(); 
        } 
    } catch(e){} 
};

export const addYouTubeLink = async () => {
    const url = prompt("Paste YouTube URL (e.g., https://youtu.be/...)");
    if (!url) return;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    if (match && match[2].length === 11) {
        if(window.showNotification) window.showNotification("Saving YouTube Link... 💾");
        try {
            // THE FIX: Save permanently to Firebase Database instead of temporary memory!
            const localMediaRef = ref(db, 'permanent_local_media');
            await push(localMediaRef, {
                name: "YouTube: " + match[2],
                type: 'youtube',
                src: match[2],
                timestamp: Date.now()
            });
            if(window.showNotification) window.showNotification("✅ YouTube Video Added!");
        } catch (error) {
            console.error("Firebase Write Error:", error);
            alert("Failed to save YouTube link.");
        }
    } else { alert("Invalid YouTube URL"); }
};

// --- LIBRARY & LIVE WORSHIP FUNCTIONS ---

export const filterDriveList = () => {
    const term = document.getElementById('driveSearch').value.toLowerCase();
    const items = document.querySelectorAll('#lib-drive-list > div');
    items.forEach(item => {
        const text = item.dataset.search || item.innerText.toLowerCase();
        item.style.display = text.includes(term) ? 'flex' : 'none';
    });
};

export const refreshLibraryDrive = async () => {
    const driveList = document.getElementById('lib-drive-list');
    driveList.innerHTML = '<div class="loader" style="display:block; margin:20px auto;"></div>';
    
    try {
        const archiveRef = ref(db, 'song_archive');
        const snapshot = await get(archiveRef);
        
        driveList.innerHTML = '';
        if(snapshot.exists()) {
            const data = snapshot.val();
            Object.keys(data).forEach(key => {
                const song = data[key];
                const div = document.createElement('div');
                div.style = "padding:10px; border-bottom:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center; font-size:0.9rem;";
                
                div.dataset.search = (song.title || "").toLowerCase();
                const safeTitle = (song.title || "").replace(/'/g, "\\'");
                
                // THE FIX: Smart buttons based on boolean status
                const btnHtml = song.isLive 
                    ? `<button class="btn danger" style="font-size:0.75rem; padding:6px 10px;" onclick="unpublishSong('${key}')">Unpublish 🔴</button>`
                    : `<button class="btn" style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd; font-size:0.75rem; padding:6px 10px;" onclick="publishToLive('${key}', '${safeTitle}')">Publish 🟢</button>`;
                
                div.innerHTML = `<span style="font-weight:500;">${song.title}</span> ${btnHtml}`;
                driveList.appendChild(div);
            });
        } else {
            driveList.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8;">Archive is empty.</div>';
        }
    } catch(e) { 
        driveList.innerHTML = '<div style="color:red; padding:20px;">Error loading Archive.</div>'; 
        console.error("Archive Load Error:", e);
    }
};

export const publishToLive = async (archiveKey, name) => {
    if(window.showNotification) window.showNotification("Publishing to Live... 🟢");
    try {
        await update(ref(db, 'song_archive/' + archiveKey), {
            isLive: true,
            order: Date.now() // 🎯 THE FIX: Changed from 'liveOrder' to 'order'
        });
        if(window.showNotification) window.showNotification("✅ Published: " + name);
        refreshLibraryDrive(); 
    } catch(e) { 
        alert("Failed to publish: " + e.message); 
    }
};

export const unpublishSong = async (key) => {
    if(window.showNotification) window.showNotification("Unpublishing song... 🔴");
    try {
        // Just flip the switch off!
        await update(ref(db, 'song_archive/' + key), {
            isLive: false
        });
        if(window.showNotification) window.showNotification("✅ Song removed from live list.");
        if (window.refreshLibraryDrive) window.refreshLibraryDrive();
    } catch(e) { 
        alert("Failed to unpublish: " + e.message); 
    }
};